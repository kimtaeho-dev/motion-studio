import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import type { ExportJob, ExportKind, ExportStep } from "../src/types/common";
import { json, readJsonBody } from "./http";
import { cancelRenderJob, enqueueRender } from "./render";
import { resolveWorkspace, type Workspace } from "./workspace";

/**
 * "내보내기": collect a film's deliverables into one folder under ~/Downloads.
 *
 * Every file is checked before it is copied: a render older than the film's
 * code, its film.json or lib/, or at the wrong size (a half-size draft sitting
 * where the full render goes), is made again — through the render queue, so
 * it shows up in the app like any other render. MP4s get their sound mixed
 * by tools/sound.mjs.
 */

export interface ExportOptions {
  /** Show the finished folder in Finder. Only the packaged app has one. */
  reveal?: (dir: string) => void;
}

const KINDS: ExportKind[] = ["mp4", "gif", "prores", "webm", "png"];

/** Where each kind lives in out/<film>/<format>/, and what it is called in the export. */
const OUTPUT: Record<Exclude<ExportKind, "png">, { file: string; ext: string; codec: string | null; label: string }> = {
  mp4: { file: "final.mp4", ext: "mp4", codec: null, label: "MP4 (소리 포함)" },
  gif: { file: "preview.gif", ext: "gif", codec: "gif", label: "GIF" },
  prores: { file: "master.mov", ext: "mov", codec: "prores", label: "ProRes 4444" },
  webm: { file: "alpha.webm", ext: "webm", codec: "webm", label: "WebM" },
};

/** "새 런칭 릴: 1차" → "새 런칭 릴 1차" — a title, kept readable, made safe as a file name. */
function safeName(title: string): string {
  return title.replace(/[\u0000-\u001f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "film";
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Newest change to anything a render depends on. */
function sourceTime(ws: Workspace, slug: string): number {
  const filmDir = path.join(ws.filmsDir, slug);
  const lib = path.join(ws.root, "lib");
  const files = [path.join(filmDir, "index.html"), path.join(filmDir, "film.json")];
  if (fs.existsSync(lib)) for (const f of fs.readdirSync(lib)) files.push(path.join(lib, f));
  return Math.max(...files.map(mtime));
}

/** Frame size of a video, from ffmpeg's banner (ffprobe is not shipped). */
function videoSize(file: string): [number, number] | null {
  const r = spawnSync(process.env.MOTION_FFMPEG?.trim() || "ffmpeg", ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Video: .*?, (\d{2,5})x(\d{2,5})/.exec(r.stderr ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

interface FilmMeta {
  title: string;
  dur: number;
  formats: Record<string, [number, number]>;
}

function readMeta(ws: Workspace, slug: string): FilmMeta {
  const data = JSON.parse(fs.readFileSync(path.join(ws.filmsDir, slug, "film.json"), "utf8")) as Partial<FilmMeta>;
  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : slug,
    dur: typeof data.dur === "number" ? data.dur : 1,
    formats: data.formats && typeof data.formats === "object" ? data.formats : { "1x1": [1080, 1080] },
  };
}

export function exportPlugin(options: ExportOptions = {}): Plugin {
  let ws: Workspace;
  let current: { job: ExportJob; cancelled: boolean; renderId: string | null; child: ChildProcess | null } | null = null;

  const push = (server: ViteDevServer) => server.ws.send({ type: "custom", event: "export:update", data: { job: current?.job ?? null } });

  /** Runs tools/sound.mjs for one format — the agent's own tool, so the mix is the same one it checks. */
  function mixSound(slug: string, format: string): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn("node", [path.join("tools", "sound.mjs"), path.join("films", slug), "--format", format], {
        cwd: ws.root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (current) current.child = child;
      let stderr = "";
      child.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
      child.on("error", (err) => resolve(`사운드를 입히지 못했습니다: ${err.message}`));
      child.on("close", (code) => resolve(code === 0 ? null : `사운드를 입히지 못했습니다\n${stderr.trim()}`));
    });
  }

  async function render(args: string[]): Promise<string | null> {
    if (!enqueueRender) return "렌더 큐가 준비되지 않았습니다";
    const { id, done } = enqueueRender(args);
    if (current) current.renderId = id;
    const result = await done;
    if (current) current.renderId = null;
    return result.ok ? null : (result.error ?? "렌더 실패");
  }

  async function run(server: ViteDevServer, slug: string, formats: string[], kinds: ExportKind[], zip: boolean): Promise<void> {
    const job = current!.job;
    const filmArg = path.join("films", slug);
    const meta = readMeta(ws, slug);
    const since = sourceTime(ws, slug);
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const folder = `${safeName(meta.title)} ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}`;
    const dest = path.join(os.homedir(), "Downloads", "Motion Studio", folder);

    // One step per file, so the dialog can say exactly where it is.
    type Plan = ExportStep & { run: () => Promise<string | null> };
    const plan: Plan[] = [];
    const copyTo = (from: string, name: string) => {
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(from, path.join(dest, name));
    };

    for (const format of formats) {
      const outDir = path.join(ws.outDir, slug, format);
      const size = meta.formats[format];
      const fresh = (file: string, video: boolean) => {
        if (mtime(file) <= since) return false;
        if (!video || !size) return true;
        const actual = videoSize(file);
        return !!actual && actual[0] === size[0] && actual[1] === size[1];
      };
      const base = `${safeName(meta.title)}-${format}`;

      for (const kind of kinds) {
        if (kind === "png") {
          plan.push({
            label: `포스터·컨택트 시트 · ${format}`,
            status: "pending",
            run: async () => {
              const contact = path.join(outDir, "contact-beats.png");
              if (!fresh(contact, false)) {
                const failed = await render([filmArg, "--format", format, "--stills", "beats"]);
                if (failed) return failed;
              }
              copyTo(contact, `${base}-contact.png`);
              // The agent picks the poster frame (CLAUDE.md, 전달); without one, a third of the way in.
              let poster = path.join(outDir, "poster.png");
              if (!fresh(poster, false)) {
                const t = Math.round(meta.dur * 0.33 * 100) / 100;
                const failed = await render([filmArg, "--format", format, "--stills", String(t), "--no-contact"]);
                if (failed) return failed;
                poster = path.join(outDir, "stills", `t${t.toFixed(2).padStart(6, "0")}.png`);
              }
              copyTo(poster, `${base}-poster.png`);
              return null;
            },
          });
          continue;
        }
        const spec = OUTPUT[kind];
        plan.push({
          label: `${spec.label} · ${format}`,
          status: "pending",
          run: async () => {
            const file = path.join(outDir, spec.file);
            if (kind === "mp4") {
              // final.mp4 is silent.mp4 plus sound: both must be current.
              const silent = path.join(outDir, "silent.mp4");
              if (!fresh(silent, true)) {
                const failed = await render([filmArg, "--format", format]);
                if (failed) return failed;
              }
              if (mtime(file) < mtime(path.join(outDir, "silent.mp4")) || !fresh(file, true)) {
                const failed = await mixSound(slug, format);
                if (failed) return failed;
              }
            } else if (!fresh(file, true)) {
              const failed = await render([filmArg, "--format", format, "--codec", spec.codec!]);
              if (failed) return failed;
            }
            copyTo(file, `${base}.${spec.ext}`);
            return null;
          },
        });
      }
    }

    job.steps = plan.map(({ label, status }) => ({ label, status }));
    push(server);

    for (const [i, step] of plan.entries()) {
      if (current?.cancelled) break;
      job.steps[i].status = "running";
      push(server);
      let failed: string | null;
      try {
        failed = await step.run();
      } catch (err) {
        failed = String((err as Error).message ?? err);
      }
      if (current?.cancelled) {
        job.steps[i].status = "pending";
        break;
      }
      job.steps[i].status = failed ? "error" : "done";
      if (failed) {
        job.status = "error";
        job.error = failed;
        push(server);
        return;
      }
      push(server);
    }

    if (current?.cancelled) {
      job.status = "cancelled";
      push(server);
      return;
    }

    if (zip && fs.existsSync(dest)) {
      // ditto is macOS's own archiver: no dependency, keeps Korean file names
      // intact. Without --norsrc/--noextattr it adds "._" files that show up as
      // junk when the zip is opened anywhere but a Mac.
      const archive = `${dest}.zip`;
      const r = spawnSync("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--noqtn", "--keepParent", dest, archive]);
      if (r.status === 0) job.zip = archive;
    }
    job.dest = dest;
    job.status = "done";
    push(server);
  }

  return {
    name: "motion-export",

    configResolved(config) {
      ws = resolveWorkspace(config.root);
    },

    configureServer(server) {
      server.middlewares.use("/__export/cancel", (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (current && current.job.status === "running") {
          current.cancelled = true;
          if (current.renderId) cancelRenderJob?.(current.renderId);
          current.child?.kill("SIGTERM");
        }
        json(res, 200, { ok: true });
      });

      server.middlewares.use("/__export/reveal", (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const dest = current?.job.dest;
        if (!dest || !options.reveal) return json(res, 200, { ok: false });
        options.reveal(dest);
        json(res, 200, { ok: true });
      });

      server.middlewares.use("/__export", async (req, res) => {
        if (req.method === "GET") return json(res, 200, { job: current?.job ?? null, canReveal: !!options.reveal });
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (current?.job.status === "running") return json(res, 409, { error: "다른 내보내기가 진행 중이에요" });

        const body = await readJsonBody(req);
        const slug = typeof body.film === "string" ? body.film : "";
        if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !fs.existsSync(path.join(ws.filmsDir, slug, "film.json"))) {
          return json(res, 404, { error: "film not found" });
        }
        const meta = readMeta(ws, slug);
        const formats = Array.isArray(body.formats) ? body.formats.filter((f): f is string => typeof f === "string" && f in meta.formats) : [];
        const kinds = Array.isArray(body.kinds) ? KINDS.filter((k) => (body.kinds as unknown[]).includes(k)) : [];
        if (!formats.length || !kinds.length) return json(res, 400, { error: "포맷과 형식을 하나 이상 골라 주세요" });

        current = {
          job: { id: crypto.randomUUID(), film: slug, title: meta.title, status: "running", steps: [], startedAt: Date.now() },
          cancelled: false,
          renderId: null,
          child: null,
        };
        push(server);
        void run(server, slug, formats, kinds, body.zip === true).catch((err) => {
          if (!current) return;
          current.job.status = "error";
          current.job.error = String((err as Error).message ?? err);
          push(server);
        });
        json(res, 202, { job: current.job });
      });
    },
  };
}
