import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import type { RenderJob } from "../src/types/common";
import { json, readJsonBody } from "./http";
import { resolveWorkspace, type Workspace } from "./workspace";

/**
 * The render queue at `/__render`.
 *
 * tools/render.mjs POSTs its own arguments here when it runs under the studio
 * (MOTION_STUDIO_URL is set for the agent), so every render the agent starts
 * shows up in the app with progress and a cancel button. One job runs at a
 * time — a render already uses every core ffmpeg can get.
 *
 * The response streams the worker's events (one JSON object per line) back to
 * render.mjs until the job ends. If render.mjs goes away — the agent's turn was
 * cancelled — the job is cancelled with it.
 */

export interface WorkerCommand {
  command: string;
  args: string[];
}

export interface RenderOptions {
  /** How to start a render worker. Defaults to `electron dist-electron/render-worker.cjs` for the dev server. */
  workerCommand?: () => WorkerCommand;
}

/** How long a finished job stays listed, so the app can say "done" before it disappears. */
const KEEP_FINISHED_MS = 60_000;
const BROADCAST_THROTTLE_MS = 250;
const FLAGS_WITH_VALUE = ["format", "fps", "sub", "from", "to", "stills", "codec"];

interface Running {
  job: RenderJob;
  args: string[];
  /** Streams of render.mjs clients waiting on this job. */
  listeners: Set<(line: string) => void>;
  child: ChildProcess | null;
  cancelled: boolean;
}

/** What a designer would call this render, from render.mjs's flags. */
function describe(args: string[]): Pick<RenderJob, "label" | "mode"> {
  const value = (flag: string) => {
    const i = args.indexOf(`--${flag}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--stills")) {
    const spec = value("stills");
    return { mode: "stills", label: !spec || spec === "beats" || spec.startsWith("--") ? "비트 스틸" : spec === "bars" ? "마디 스틸" : "스틸" };
  }
  const codec = value("codec");
  const kind = codec === "prores" ? "ProRes" : codec === "webm" ? "WebM" : codec === "gif" ? "GIF" : args.includes("--draft") ? "초안" : "최종 렌더";
  const from = value("from");
  const to = value("to");
  return { mode: "video", label: from || to ? `${kind} · ${from ?? 0}–${to ?? "끝"}초` : kind };
}

function defaultWorkerCommand(root: string): WorkerCommand {
  const require = createRequire(path.join(root, "package.json"));
  // In Node, the `electron` package exports the path of its binary.
  const electron = require("electron") as unknown as string;
  return { command: electron, args: [path.join(root, "dist-electron", "render-worker.cjs")] };
}

export function renderPlugin(options: RenderOptions = {}): Plugin {
  let ws: Workspace;
  let repoRoot = "";
  const jobs: Running[] = [];
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): RenderJob[] => jobs.map((r) => ({ ...r.job }));

  function broadcast(server: ViteDevServer, now = false): void {
    const send = () => {
      broadcastTimer = null;
      server.ws.send({ type: "custom", event: "render:update", data: { jobs: snapshot() } });
    };
    if (now) {
      if (broadcastTimer) clearTimeout(broadcastTimer);
      return send();
    }
    broadcastTimer ??= setTimeout(send, BROADCAST_THROTTLE_MS);
  }

  function finish(server: ViteDevServer, run: Running, status: RenderJob["status"], error?: string): void {
    run.job.status = status;
    run.job.finishedAt = Date.now();
    if (error) run.job.error = error;
    run.child = null;
    const tail = status === "done" ? { type: "done" } : { type: "error", message: error ?? (status === "cancelled" ? "렌더를 취소했습니다" : "렌더 실패") };
    for (const listener of run.listeners) listener(JSON.stringify(tail));
    run.listeners.clear();
    broadcast(server, true);
    setTimeout(() => {
      const i = jobs.indexOf(run);
      if (i !== -1 && jobs[i].job.status !== "queued" && jobs[i].job.status !== "running") jobs.splice(i, 1);
      broadcast(server, true);
    }, KEEP_FINISHED_MS);
    startNext(server);
  }

  function startNext(server: ViteDevServer): void {
    if (jobs.some((r) => r.job.status === "running")) return;
    const run = jobs.find((r) => r.job.status === "queued");
    if (!run) return;

    let command: WorkerCommand;
    try {
      command = (options.workerCommand ?? (() => defaultWorkerCommand(repoRoot)))();
    } catch (err) {
      return finish(server, run, "error", `렌더 엔진을 찾지 못했습니다: ${(err as Error).message}`);
    }
    if (!options.workerCommand && !fs.existsSync(command.args[0])) {
      return finish(server, run, "error", "렌더 엔진이 아직 빌드되지 않았습니다 (npm run build:electron)");
    }

    run.job.status = "running";
    run.job.startedAt = Date.now();
    broadcast(server, true);

    const child = spawn(command.command, [...command.args, ...run.args], { cwd: ws.root, stdio: ["ignore", "pipe", "pipe"] });
    run.child = child;
    let pending = "";
    let stderr = "";
    let failure: string | undefined;
    let succeeded = false;

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          continue; // Electron's own startup chatter
        }
        // done/error are sent by finish(), once, whatever ended the job.
        if (event.type === "done") {
          succeeded = true;
          continue;
        }
        if (event.type === "error") {
          failure = String(event.message);
          continue;
        }
        if (event.type === "start") {
          run.job.format = String(event.format);
          run.job.done = 0;
          run.job.total = Number(event.total) || 0;
        } else if (event.type === "progress") {
          run.job.format = String(event.format);
          run.job.done = Number(event.done);
          run.job.total = Number(event.total);
        } else if (event.type === "file" && typeof event.path === "string") {
          run.job.files.push(path.relative(ws.root, event.path).split(path.sep).join("/"));
        }
        for (const listener of run.listeners) listener(line);
        broadcast(server);
      }
    });
    child.stderr!.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    child.on("error", (err) => {
      failure = `렌더 엔진을 시작하지 못했습니다: ${err.message}`;
    });
    child.on("close", (code) => {
      if (run.cancelled) return finish(server, run, "cancelled");
      if (succeeded && code === 0) return finish(server, run, "done");
      if (!failure) console.error(`[render] worker exited ${code}\n${stderr}`);
      finish(server, run, "error", failure ?? `렌더 엔진이 비정상 종료했습니다 (${code})`);
    });
  }

  function cancel(server: ViteDevServer, run: Running): void {
    if (run.job.status === "queued") {
      run.cancelled = true;
      finish(server, run, "cancelled");
    } else if (run.job.status === "running") {
      run.cancelled = true;
      run.child?.kill("SIGTERM");
    }
  }

  return {
    name: "motion-render",

    configResolved(config) {
      repoRoot = config.root;
      ws = resolveWorkspace(config.root);
    },

    configureServer(server) {
      // The agent's render.mjs finds the queue through this; the packaged app's
      // server sets the same variable once it knows its port.
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (address && typeof address === "object") process.env.MOTION_STUDIO_URL = `http://localhost:${address.port}`;
      });
      process.on("exit", () => {
        for (const run of jobs) run.child?.kill("SIGKILL");
      });

      server.middlewares.use("/__render/cancel", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const { id } = await readJsonBody(req);
        const run = jobs.find((r) => r.job.id === id);
        if (!run) return json(res, 404, { error: "no such job" });
        cancel(server, run);
        json(res, 200, { ok: true });
      });

      server.middlewares.use("/__render", async (req, res) => {
        if (req.method === "GET") return json(res, 200, { jobs: snapshot() });
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

        const body = await readJsonBody(req);
        const args = Array.isArray(body.args) ? body.args.filter((a): a is string => typeof a === "string") : [];
        const filmArg = args.find((a, i) => !a.startsWith("--") && !(i > 0 && FLAGS_WITH_VALUE.includes(args[i - 1].slice(2))));
        const filmDir = filmArg ? path.resolve(ws.root, filmArg) : "";
        const slug = path.basename(filmDir.replace(/[/\\]index\.html$/, ""));
        if (!filmArg || !(filmDir + path.sep).startsWith(ws.filmsDir + path.sep) || !fs.existsSync(filmDir)) {
          return json(res, 400, { error: "films/<이름> 안의 필름만 렌더할 수 있습니다" });
        }

        const run: Running = {
          job: { id: crypto.randomUUID(), film: slug, ...describe(args), status: "queued", format: null, done: 0, total: 0, createdAt: Date.now(), files: [] },
          args,
          listeners: new Set(),
          child: null,
          cancelled: false,
        };

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        const write = (line: string) => res.write(line + "\n");
        run.listeners.add((line) => {
          write(line);
          const type = (JSON.parse(line) as { type?: string }).type;
          if (type === "done" || type === "error") res.end();
        });
        // render.mjs gone before the job ended: nobody is waiting for the result.
        res.on("close", () => {
          if (!res.writableEnded && (run.job.status === "queued" || run.job.status === "running")) cancel(server, run);
        });

        const ahead = jobs.filter((r) => r.job.status === "queued" || r.job.status === "running").length;
        jobs.push(run);
        if (ahead > 0) write(JSON.stringify({ type: "queued", ahead }));
        broadcast(server, true);
        startNext(server);
      });
    },
  };
}
