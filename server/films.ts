import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Plugin, ViteDevServer } from "vite";
import { FILM_STAGES, type ChatAttachment, type FilmChange, type FilmFile, type FilmFiles, type FilmOutput, type FilmQuality, type FilmStage, type FilmSummary } from "../src/types/common";
import { inside, json, readJsonBody, saveBody, sendFile } from "./http";
import { resolveWorkspace, type Workspace } from "./workspace";

/** Workspace folders the film pages and the app read directly, served as-is. */
const STATIC_PREFIXES = ["films", "lib", "assets", "out"] as const;

/** Reference videos can be large; anything past this is almost certainly the wrong file. */
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const UPLOAD_KINDS: Record<string, ChatAttachment["kind"]> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image", ".svg": "image",
  ".mp4": "video", ".mov": "video", ".webm": "video", ".m4v": "video",
  ".wav": "audio", ".mp3": "audio", ".m4a": "audio", ".aac": "audio", ".aif": "audio", ".aiff": "audio", ".flac": "audio",
};

/** Folder names the agent and the tools rely on — a film slug must be a plain lowercase name. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Canvas sizes offered when a film is created. The agent can add others in film.json. */
const FORMAT_SIZES: Record<string, [number, number]> = {
  "1x1": [1080, 1080],
  "9x16": [1080, 1920],
  "16x9": [1920, 1080],
  "4x5": [1080, 1350],
};

const QUALITIES: FilmQuality[] = ["fast", "standard", "launch"];

/** Mirrors the docs a film folder holds (CLAUDE.md, "작업 순서"). */
const DOCS = { brief: "brief.md", shotlist: "shotlist.md", review: "review_log.md", style: "refs/style_guide.md" } as const;

export interface NewFilm {
  name: string;
  formats: string[];
  dur: number;
  quality: FilmQuality;
}

/** "새 런칭 영상 2" → "2", "Launch Reel!" → "launch-reel"; empty when nothing ASCII survives. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Keeps the name readable (Korean included) but safe as a single path segment. */
function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f/\\:*?"<>|]+/g, "-").trim();
  return base && base !== "." && base !== ".." ? base : "upload";
}

/** `dir/name`, or `dir/name-2.ext`, … when taken. */
function freePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem}-${i}${ext}`);
  return candidate;
}

/** Same lightweight scrub the Lottie app applies: the file is served back to the app's own origin. */
function sanitizeSvg(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "");
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    try {
      newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
    } catch {
      // vanished mid-scan: the agent is writing; the next push will have it
    }
  }
  return newest;
}

function readFilm(ws: Workspace, slug: string): FilmSummary {
  const dir = path.join(ws.filmsDir, slug);
  const summary: FilmSummary = { slug, title: slug, formats: [], updatedAt: newestMtime(dir) };
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")) as Record<string, unknown>;
    if (typeof data.title === "string" && data.title.trim()) summary.title = data.title.trim();
    if (typeof data.dur === "number") summary.dur = data.dur;
    if (typeof data.bpm === "number") summary.bpm = data.bpm;
    if (data.formats && typeof data.formats === "object") summary.formats = Object.keys(data.formats);
  } catch (err) {
    summary.error = fs.existsSync(path.join(dir, "film.json")) ? "film.json을 읽을 수 없어요" : "film.json이 없어요";
    if (!(err instanceof SyntaxError) && fs.existsSync(path.join(dir, "film.json"))) console.error("[films]", err);
  }
  return summary;
}

/** Folders under films/ that are films: not `_template`, not hidden, and holding an index.html. */
export function listFilms(ws: Workspace): FilmSummary[] {
  if (!fs.existsSync(ws.filmsDir)) return [];
  return fs
    .readdirSync(ws.filmsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SLUG.test(e.name) && fs.existsSync(path.join(ws.filmsDir, e.name, "index.html")))
    .map((e) => readFilm(ws, e.name))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function createFilm(ws: Workspace, { name, formats, dur, quality }: NewFilm): string {
  const template = path.join(ws.filmsDir, "_template");
  if (!fs.existsSync(template)) throw new Error("films/_template이 없습니다");
  const base = slugify(name) || "film";
  let slug = base;
  for (let i = 2; fs.existsSync(path.join(ws.filmsDir, slug)); i++) slug = `${base}-${i}`;

  const dir = path.join(ws.filmsDir, slug);
  fs.cpSync(template, dir, { recursive: true });
  // film.json gets a JSON-escaped title; the HTML and markdown take it as text.
  const escaped: Record<string, string> = {
    "film.json": JSON.stringify(name).slice(1, -1),
    "index.html": name.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!),
    "brief.md": name,
  };
  for (const [file, value] of Object.entries(escaped)) {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) fs.writeFileSync(full, fs.readFileSync(full, "utf8").replaceAll("__NAME__", value));
  }
  for (const sub of ["refs", "audio"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  // The template is a working 8-second loop; stretch its scene times to the
  // chosen length so it still loops cleanly until the agent rewrites it.
  const jsonFile = path.join(dir, "film.json");
  const film = JSON.parse(fs.readFileSync(jsonFile, "utf8")) as Record<string, unknown>;
  const scale = dur / (typeof film.dur === "number" && film.dur > 0 ? film.dur : dur);
  film.dur = dur;
  film.formats = Object.fromEntries(formats.map((f) => [f, FORMAT_SIZES[f]]));
  for (const entry of Object.values((film.timeline ?? {}) as Record<string, { t: number }>)) {
    entry.t = Math.round(entry.t * scale * 1000) / 1000;
  }
  fs.writeFileSync(jsonFile, JSON.stringify(film, null, 2) + "\n");
  writeState(ws, slug, { stage: "brief", quality });
  return slug;
}

function statePath(ws: Workspace, slug: string): string {
  return path.join(ws.filmsDir, slug, "state.json");
}

function readState(ws: Workspace, slug: string): Record<string, unknown> {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(ws, slug), "utf8"));
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeState(ws: Workspace, slug: string, patch: Record<string, unknown>): void {
  fs.writeFileSync(statePath(ws, slug), JSON.stringify({ ...readState(ws, slug), ...patch }, null, 2) + "\n");
}

function fileInfo(ws: Workspace, file: string): FilmFile | undefined {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return undefined;
    const rel = path.relative(ws.root, file).split(path.sep).map(encodeURIComponent).join("/");
    // The mtime doubles as a cache-buster: the agent rewrites these in place.
    return { url: `/${rel}?v=${Math.round(stat.mtimeMs)}`, mtime: stat.mtimeMs };
  } catch {
    return undefined;
  }
}

function readOutputs(ws: Workspace, slug: string): FilmOutput[] {
  const base = path.join(ws.outDir, slug);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(base, e.name);
      const critiqueDir = path.join(dir, "critique");
      const critique = fs.existsSync(critiqueDir)
        ? fs
            .readdirSync(critiqueDir)
            .filter((f) => /\.png$/i.test(f))
            .sort()
            .flatMap((f) => {
              const info = fileInfo(ws, path.join(critiqueDir, f));
              return info ? [{ ...info, name: f.replace(/\.png$/i, "") }] : [];
            })
        : [];
      return {
        format: e.name,
        final: fileInfo(ws, path.join(dir, "final.mp4")),
        silent: fileInfo(ws, path.join(dir, "silent.mp4")),
        poster: fileInfo(ws, path.join(dir, "poster.png")),
        contact: fileInfo(ws, path.join(dir, "contact-beats.png")),
        critique,
      };
    });
}

/**
 * The furthest step the files show. Until the agent writes `stage` into
 * state.json itself (CLAUDE.md, 작업 순서), the evidence is what each step
 * leaves behind: a shotlist, a contact sheet, a render, a review log, a final.
 */
function inferStage(docs: FilmFiles["docs"], outputs: FilmOutput[], state: Record<string, unknown>): FilmStage {
  const evidence: FilmStage =
    outputs.some((o) => o.final) ? "deliver"
    : docs.review ? "critique"
    : outputs.some((o) => o.silent) ? "draft"
    : outputs.some((o) => o.contact) ? "stills"
    : docs.shotlist ? "shotlist"
    : "brief";
  const recorded = FILM_STAGES.find((s) => s === state.stage);
  if (!recorded) return evidence;
  return FILM_STAGES.indexOf(recorded) > FILM_STAGES.indexOf(evidence) ? recorded : evidence;
}

function readFilmFiles(ws: Workspace, slug: string): FilmFiles {
  const dir = path.join(ws.filmsDir, slug);
  const docs: FilmFiles["docs"] = {};
  for (const [key, file] of Object.entries(DOCS) as [keyof typeof DOCS, string][]) {
    const info = fileInfo(ws, path.join(dir, file));
    if (info) docs[key] = info;
  }
  const outputs = readOutputs(ws, slug);
  const state = readState(ws, slug);
  const quality = QUALITIES.find((q) => q === state.quality) ?? "standard";
  return { docs, outputs, stage: inferStage(docs, outputs, state), quality };
}

/** Rewrites only `title`, keeping every other key (and their order) as the agent left them. */
function renameFilm(ws: Workspace, slug: string, title: string): void {
  const file = path.join(ws.filmsDir, slug, "film.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  data.title = title;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** Moved aside rather than deleted: a designer's film is days of work. */
function trashFilm(ws: Workspace, slug: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(ws.trashDir, `${slug}-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(path.join(ws.filmsDir, slug), path.join(dest, "film"));
  const out = path.join(ws.outDir, slug);
  if (fs.existsSync(out)) fs.renameSync(out, path.join(dest, "out"));
}

/** What a change inside `films/<slug>/` means for an open player. */
function classify(rest: string): FilmChange["kind"] {
  if (rest === "film.json") return "json";
  if (/\.(html|js|mjs|css)$/i.test(rest) && !rest.startsWith("refs/")) return "code";
  return "doc";
}

/**
 * Serves `/__films` (list, create, rename, delete, upload), the workspace
 * folders film pages load from, and pushes `films:update` / `film:changed` as
 * the agent writes files.
 */
export function filmsPlugin(): Plugin {
  let ws: Workspace;
  let watcher: FSWatcher | null = null;

  function startWatching(server: ViteDevServer): void {
    const pendingChanges = new Map<string, FilmChange>();
    let changeTimer: ReturnType<typeof setTimeout> | null = null;
    let listTimer: ReturnType<typeof setTimeout> | null = null;

    // The agent writes in bursts (code, then film.json, then a shotlist); one
    // push per film per burst is plenty, and "code" outranks the rest since a
    // reload picks up everything. Renders are keyed apart: the player ignores
    // them, but the review panel must not lose them to a code change.
    const RANK = { out: 0, doc: 0, json: 1, code: 2 } as const;
    const queueChange = (change: FilmChange) => {
      const key = change.kind === "out" ? `${change.slug}:out` : change.slug;
      const prev = pendingChanges.get(key);
      if (!prev || RANK[change.kind] > RANK[prev.kind]) pendingChanges.set(key, change);
      changeTimer ??= setTimeout(() => {
        changeTimer = null;
        for (const c of pendingChanges.values()) server.ws.send({ type: "custom", event: "film:changed", data: c });
        pendingChanges.clear();
      }, 120);
    };
    const queueList = () => {
      listTimer ??= setTimeout(() => {
        listTimer = null;
        server.ws.send({ type: "custom", event: "films:update", data: { films: listFilms(ws) } });
      }, 200);
    };

    const libDir = path.join(ws.root, "lib");
    fs.mkdirSync(ws.outDir, { recursive: true });
    watcher = chokidar.watch([ws.filmsDir, libDir, ws.outDir], {
      ignoreInitial: true,
      ignored: (p) =>
        (path.basename(p).startsWith(".") && p !== ws.filmsDir) ||
        // Per-frame stills: thousands of files per render, none of them listed.
        (p.startsWith(ws.outDir + path.sep) && path.basename(p) === "stills"),
      awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
    });
    const onEvent = (event: string, file: string) => {
      if (file.startsWith(ws.outDir + path.sep)) {
        // A render writes thousands of stills; only what the app lists matters.
        const rel = path.relative(ws.outDir, file).split(path.sep);
        const name = rel[rel.length - 1];
        if (SLUG.test(rel[0]) && (rel.length <= 3 || rel[2] === "critique") && /\.(mp4|png)$/i.test(name)) {
          queueChange({ slug: rel[0], kind: "out" });
        }
        return;
      }
      if (file.startsWith(libDir + path.sep)) {
        // stage.js / motion.js changed: every open film has to reload.
        queueChange({ slug: "*", kind: "code" });
        return;
      }
      const rel = path.relative(ws.filmsDir, file).split(path.sep);
      const slug = rel[0];
      if (!slug || !SLUG.test(slug)) return;
      const rest = rel.slice(1).join("/");
      if (!rest || rest === "film.json" || rest === "index.html" || event === "addDir" || event === "unlinkDir") queueList();
      if (rest) queueChange({ slug, kind: classify(rest) });
    };
    watcher.on("all", onEvent);
    process.on("exit", () => void watcher?.close());
  }

  return {
    name: "motion-films",

    configResolved(config) {
      ws = resolveWorkspace(config.root);
    },

    configureServer(server) {
      fs.mkdirSync(ws.filmsDir, { recursive: true });
      startWatching(server);

      server.middlewares.use("/__films/upload", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const url = new URL(req.url ?? "", "http://localhost");
        const slug = url.searchParams.get("film") ?? "";
        const name = safeFilename(url.searchParams.get("name") ?? "");
        const kind = UPLOAD_KINDS[path.extname(name).toLowerCase()];
        if (!SLUG.test(slug) || !fs.existsSync(path.join(ws.filmsDir, slug))) return json(res, 404, { error: "film not found" });
        if (!kind) return json(res, 400, { error: "unsupported file type" });

        const dir = path.join(ws.filmsDir, slug, kind === "audio" ? "audio" : "refs");
        fs.mkdirSync(dir, { recursive: true });
        const file = freePath(dir, name);
        try {
          await saveBody(req, file, MAX_UPLOAD_BYTES);
        } catch {
          return json(res, 413, { error: "too large" });
        }
        if (path.extname(file).toLowerCase() === ".svg") fs.writeFileSync(file, sanitizeSvg(fs.readFileSync(file, "utf8")));

        const rel = path.relative(ws.root, file).split(path.sep).join("/");
        const attachment: ChatAttachment = { name, path: rel, url: "/" + rel.split("/").map(encodeURIComponent).join("/"), kind };
        json(res, 201, attachment);
      });

      // The property panel and timeline save here (PUT, body: { film, json }). The
      // app has already applied the change to the open page with Stage.reload,
      // which validates it fully; this only refuses what is not a film at all.
      server.middlewares.use("/__films/json", async (req, res) => {
        if (req.method !== "PUT") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const slug = typeof body.film === "string" ? body.film : "";
        const film = body.json as Record<string, unknown> | undefined;
        if (!SLUG.test(slug) || !fs.existsSync(path.join(ws.filmsDir, slug, "film.json"))) return json(res, 404, { error: "film not found" });
        if (!film || typeof film !== "object" || Array.isArray(film) || typeof film.dur !== "number" || !(film.dur > 0)) {
          return json(res, 400, { error: "not a film.json" });
        }
        fs.writeFileSync(path.join(ws.filmsDir, slug, "film.json"), JSON.stringify(film, null, 2) + "\n");
        json(res, 200, { ok: true });
      });

      server.middlewares.use("/__films/files", (req, res) => {
        const slug = new URL(req.url ?? "", "http://localhost").searchParams.get("film") ?? "";
        if (!SLUG.test(slug) || !fs.existsSync(path.join(ws.filmsDir, slug))) return json(res, 404, { error: "film not found" });
        json(res, 200, readFilmFiles(ws, slug));
      });

      server.middlewares.use("/__films", async (req, res) => {
        if (req.method === "GET") return json(res, 200, { films: listFilms(ws) });
        const body = await readJsonBody(req);
        const slug = typeof body.film === "string" ? body.film : "";
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
        const exists = SLUG.test(slug) && fs.existsSync(path.join(ws.filmsDir, slug));
        try {
          if (req.method === "POST") {
            if (!name) return json(res, 400, { error: "missing name" });
            const formats = Array.isArray(body.formats) ? body.formats.filter((f): f is string => typeof f === "string" && f in FORMAT_SIZES) : [];
            const dur = typeof body.dur === "number" && Number.isFinite(body.dur) ? Math.min(180, Math.max(2, body.dur)) : 12;
            const quality = QUALITIES.find((q) => q === body.quality) ?? "standard";
            return json(res, 201, { film: createFilm(ws, { name, formats: formats.length ? [...new Set(formats)] : ["1x1"], dur, quality }) });
          }
          if (req.method === "PATCH") {
            if (!exists) return json(res, 404, { error: "film not found" });
            if (!name) return json(res, 400, { error: "missing name" });
            renameFilm(ws, slug, name);
            return json(res, 200, { ok: true });
          }
          if (req.method === "DELETE") {
            if (!exists) return json(res, 404, { error: "film not found" });
            trashFilm(ws, slug);
            return json(res, 200, { ok: true });
          }
        } catch (err) {
          console.error("[films]", err);
          return json(res, 500, { error: String((err as Error).message ?? err) });
        }
        json(res, 405, { error: "method not allowed" });
      });

      // Film pages load `../../lib/stage.js` and `../../assets/fonts/…`, and
      // the app shows renders from out/ — all straight from the workspace.
      for (const prefix of STATIC_PREFIXES) {
        const root = path.join(ws.root, prefix);
        server.middlewares.use(`/${prefix}`, (req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const file = inside(root, rel);
          if (!file || rel.split("/").some((seg) => seg.startsWith("."))) return json(res, 404, { error: "not found" });
          try {
            if (!fs.statSync(file).isFile()) return json(res, 404, { error: "not found" });
          } catch {
            return json(res, 404, { error: "not found" });
          }
          sendFile(req, res, file);
        });
      }
    },
  };
}
