import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the agent works.
 *
 * In `npm run dev` that is this repo: CLAUDE.md, lib/, tools/ and films/ are
 * all right here. The packaged app cannot work inside its own bundle (it is
 * read-only and replaced on every update), so it keeps a workspace in the
 * user's Application Support folder and refreshes the agent's rules and tools
 * there on every launch. The films themselves are never overwritten.
 */
export interface Workspace {
  /** Agent cwd. Holds CLAUDE.md, .claude/skills, lib/, tools/, assets/, films/, out/. */
  root: string;
  /** `<root>/films` — one folder per film. */
  filmsDir: string;
  /** `<root>/out` — renders, contact sheets, critique images. */
  outDir: string;
  /** `<root>/.mailbox` — per-film chat threads. */
  mailboxDir: string;
  /** `<root>/.trash` — deleted films, kept so a misclick is recoverable. */
  trashDir: string;
  /** True when the workspace sits outside the repo (packaged app). */
  relocated: boolean;
}

export const WORKSPACE_ENV = "MOTION_STUDIO_WORKSPACE";

/** Per-user workspace location used by the packaged app. */
export function defaultWorkspaceDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Motion Studio", "workspace");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Motion Studio", "workspace");
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(base, "motion-studio", "workspace");
}

/** The workspace for a server rooted at `repoRoot`, honouring the env override. */
export function resolveWorkspace(repoRoot: string): Workspace {
  const override = process.env[WORKSPACE_ENV]?.trim();
  const root = override ? path.resolve(override) : path.resolve(repoRoot);
  return {
    root,
    filmsDir: path.join(root, "films"),
    outDir: path.join(root, "out"),
    mailboxDir: path.join(root, ".mailbox"),
    trashDir: path.join(root, ".trash"),
    relocated: root !== path.resolve(repoRoot),
  };
}

/**
 * Refreshed on every launch so an app update ships new rules, skills and
 * tools. These are the app's, not the designer's: edits made to them inside
 * the workspace do not survive an update.
 */
const AGENT_ASSETS = ["CLAUDE.md", ".claude/skills", "prompts", "lib", "tools", "assets", "films/_template"] as const;

/** Copied once, when the workspace is first created — a working film to look at and to learn from. */
const FIRST_RUN_FILMS = ["sample-morph"] as const;

/** Minimal package.json so the `npm run …` names in CLAUDE.md mean the same thing in the workspace. */
function workspaceManifest(): string {
  return `${JSON.stringify(
    {
      name: "motion-studio-workspace",
      private: true,
      type: "module",
      scripts: {
        new: "node tools/new.mjs",
        stills: "node tools/render.mjs --stills beats",
        render: "node tools/render.mjs",
        draft: "node tools/render.mjs --draft",
        sound: "node tools/sound.mjs",
        critique: "bash tools/critique.sh",
        check: "bash tools/determinism.sh",
      },
    },
    null,
    2,
  )}\n`;
}

/** Populate a relocated workspace from the app bundle (`sourceRoot` holds the seed files). */
export function seedWorkspace(sourceRoot: string, ws: Workspace): void {
  const firstRun = !fs.existsSync(ws.filmsDir);
  for (const dir of [ws.filmsDir, ws.outDir, ws.mailboxDir]) fs.mkdirSync(dir, { recursive: true });

  for (const asset of AGENT_ASSETS) {
    const from = path.join(sourceRoot, asset);
    if (!fs.existsSync(from)) continue;
    const to = path.join(ws.root, asset);
    // Replaced, not merged: a file dropped from the app must not linger in the workspace.
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }

  if (firstRun) {
    for (const film of FIRST_RUN_FILMS) {
      const from = path.join(sourceRoot, "films", film);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(ws.filmsDir, film), { recursive: true });
    }
  }

  fs.writeFileSync(path.join(ws.root, "package.json"), workspaceManifest());
}
