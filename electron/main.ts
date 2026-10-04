import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { startStudioServer, type StudioServer } from "./server";
import { WORKSPACE_ENV, defaultWorkspaceDir, resolveWorkspace, seedWorkspace } from "../server/workspace";
import { cancelLogin, installClaudeCode, readSetupStatus, startLogin, submitLoginCode } from "./setup";
import { runRenderWorker } from "./render-worker";

/**
 * Packaged entry point.
 *
 * The app carries its own Node runtime, so the designer no longer needs one
 * installed. Read-only bundle contents are seeded into a per-user workspace on
 * every launch (agent assets refreshed, existing films never touched), and the
 * studio server is started against that workspace before the window opens.
 */

/**
 * Files the workspace is seeded from. Packaged, they ship unpacked under
 * `resources/seed`; unpackaged (`electron .`), `getAppPath()` is the repo itself.
 */
function seedRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "seed") : app.getAppPath();
}

/** The built frontend: `resources/dist` when packaged, `<repo>/dist` otherwise. */
function distRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "dist") : path.join(app.getAppPath(), "dist");
}

let studio: StudioServer | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "Motion Studio",
    backgroundColor: "#0b0b0c",
    show: false,
    webPreferences: {
      // The page is our own bundle served from localhost; it needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => (mainWindow = null));

  // Anything aimed at another site opens in the real browser, not in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  void mainWindow.loadURL(url);
}

/**
 * The setup window, if one is open. Sign-in can now be reached from two places
 * — startup, and a session that expired while the app was running — and the
 * window registers IPC handlers by name, so a second one must never open.
 */
let setupWindow: Promise<boolean> | null = null;

/**
 * Blocks startup until the agent is installed and signed in, walking the
 * designer through both in-app. Resolves false when the window is closed
 * without finishing, which means the app should not start.
 */
function ensureSetup(): Promise<boolean> {
  if (readSetupStatus().ready) return Promise.resolve(true);
  if (setupWindow) return setupWindow;

  setupWindow = openSetupWindow();
  return setupWindow.finally(() => {
    setupWindow = null;
  });
}

function openSetupWindow(): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 480,
      resizable: false,
      title: "Motion Studio",
      backgroundColor: "#0b0b0c",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let finished = false;

    ipcMain.handle("setup:status", () => readSetupStatus());
    ipcMain.handle("setup:install", async () => {
      try {
        await installClaudeCode((line) => win.webContents.send("setup:progress", line));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
    ipcMain.handle("setup:login-start", () =>
      startLogin((line) => win.webContents.send("setup:progress", line)),
    );
    ipcMain.handle("setup:login-code", (_event, code: string) => submitLoginCode(code));
    ipcMain.handle("setup:open-url", async (_event, target: string) => {
      await shell.openExternal(target);
      return { ok: true };
    });
    ipcMain.handle("setup:finish", () => {
      finished = true;
      win.close();
    });

    win.on("closed", () => {
      cancelLogin();
      for (const channel of [
        "setup:status",
        "setup:install",
        "setup:login-start",
        "setup:login-code",
        "setup:open-url",
        "setup:finish",
      ]) {
        ipcMain.removeHandler(channel);
      }
      resolve(finished);
    });

    win.once("ready-to-show", () => win.show());
    void win.loadFile(path.join(__dirname, "onboarding.html"));
  });
}

/** How this app starts a render worker: its own executable in worker mode. */
function workerCommand(): { command: string; args: string[] } {
  return { command: process.execPath, args: app.isPackaged ? ["--render-worker"] : [app.getAppPath(), "--render-worker"] };
}

/**
 * ffmpeg for renders: the copy shipped in the bundle, else one the
 * user already has. A Finder-launched app gets a bare PATH, so the usual
 * install locations are looked up directly.
 */
function findFfmpeg(): string | null {
  const candidates = [
    process.env.MOTION_FFMPEG?.trim(),
    path.join(process.resourcesPath, "bin", "ffmpeg"),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ];
  return candidates.find((c): c is string => !!c && fs.existsSync(c)) ?? null;
}

/**
 * The designer's Mac has no Node and no ffmpeg, but CLAUDE.md's tools are
 * `node tools/….mjs` and call `ffmpeg`. A `.bin/` in the workspace provides
 * both — `node` is this executable in Node mode — and goes first on the PATH
 * every child process (the agent included) inherits.
 */
function prepareAgentTools(workspaceRoot: string): void {
  const bin = path.join(workspaceRoot, ".bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`, { mode: 0o755 });

  const ffmpeg = findFfmpeg();
  const link = path.join(bin, "ffmpeg");
  fs.rmSync(link, { force: true });
  if (ffmpeg) {
    fs.symlinkSync(ffmpeg, link);
    process.env.MOTION_FFMPEG = ffmpeg;
  } else {
    console.error("[motion-studio] ffmpeg not found: renders will fail until one is installed");
  }

  process.env.PATH = [bin, process.env.PATH].filter(Boolean).join(path.delimiter);
  const worker = workerCommand();
  process.env.MOTION_RENDER_CMD = JSON.stringify([worker.command, ...worker.args]);
}

async function boot(): Promise<void> {
  const workspaceRoot = process.env[WORKSPACE_ENV]?.trim() || defaultWorkspaceDir();
  const workspace = resolveWorkspace(workspaceRoot);

  seedWorkspace(seedRoot(), workspace);
  prepareAgentTools(workspace.root);

  if (!(await ensureSetup())) {
    app.quit();
    return;
  }

  studio = await startStudioServer({
    distDir: distRoot(),
    workspaceRoot: workspace.root,
    workerCommand,
    reveal: (dir) => shell.showItemInFolder(dir),
    // A session that expires while the app is open reopens the same setup
    // window the first run uses — it already handles "installed but signed
    // out". Unlike at startup, closing it without signing in is not fatal:
    // the studio stays open and the request can be retried later.
    onSignInRequested: () => {
      void ensureSetup().then((ok) => {
        if (ok) mainWindow?.focus();
      });
    },
  });

  createWindow(studio.url);
}

/**
 * The same executable doubles as the render worker: the studio server starts
 * it with `--render-worker <render.mjs args>` for every render job, so a
 * packaged app needs no second binary and no browser download.
 */
const workerFlag = process.argv.indexOf("--render-worker");
if (workerFlag !== -1) {
  runRenderWorker(process.argv.slice(workerFlag + 1));
} else {
  startStudio();
}

function startStudio(): void {
  // A second launch focuses the window that already exists rather than starting
  // a second server against the same workspace.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(boot).catch((err) => {
      console.error("[motion-studio] failed to start:", err);
      app.quit();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && studio) createWindow(studio.url);
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("before-quit", () => {
      void studio?.close();
      studio = null;
    });
  }
}
