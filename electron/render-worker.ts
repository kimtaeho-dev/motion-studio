import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow } from "electron";
import { inside, sendFile } from "../server/http";

/**
 * The render engine: one Electron process per render job.
 *
 * A film is a page whose `window.seek(t)` draws frame t into a canvas
 * (lib/stage.js). This opens that page in a hidden window, seeks, reads the
 * canvas pixels back and streams them to ffmpeg — no screenshots, no browser
 * download. Hardware acceleration is off so the canvas is rasterised in
 * software: the same t gives the same pixels on every run and every Mac.
 *
 * Started by tools/render.mjs (directly, or through the studio server's
 * render queue) with render.mjs's own arguments, from the workspace root.
 * Reports on stdout as one JSON object per line (see WorkerEvent).
 */

export type WorkerEvent =
  | { type: "start"; title: string; format: string; W: number; H: number; dur: number; bpm: number; mode: "video" | "stills"; total: number }
  | { type: "progress"; format: string; done: number; total: number }
  | { type: "file"; format: string; kind: "video" | "stills" | "contact"; path: string; count?: number; seconds: number }
  | { type: "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

type Codec = "h264" | "prores" | "webm" | "gif";

interface Job {
  /** Film folder (or page), relative to the workspace root. */
  film: string;
  format: string | null;
  allFormats: boolean;
  stills: string | null;
  draft: boolean;
  fps: number | null;
  sub: number | null;
  from: number | null;
  to: number | null;
  codec: Codec;
  /** Stills only, no contact sheet — for checks that must not touch the sheets the agent reads. */
  noContact: boolean;
}

interface StageFilm {
  title: string;
  dur: number;
  bpm: number;
  beatOffset: number;
  fps: number;
  W: number;
  H: number;
  format: string;
  formats: string[];
  transparent: boolean;
}

const CODECS: Codec[] = ["h264", "prores", "webm", "gif"];
const FLAGS_WITH_VALUE = ["format", "fps", "sub", "from", "to", "stills", "codec"];
const LOAD_TIMEOUT_MS = 30_000;

/** A failure in the film itself (film.json, script), reported without a stack. */
class FilmError extends Error {}

function parseJob(argv: string[]): Job {
  const film = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && FLAGS_WITH_VALUE.includes(argv[i - 1].slice(2))));
  if (!film) throw new FilmError("사용법: node tools/render.mjs films/<이름> [옵션]");
  const opt = (k: string): string | true | undefined => {
    const i = argv.indexOf("--" + k);
    if (i < 0) return undefined;
    return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
  };
  const num = (k: string) => {
    const v = opt(k);
    if (v === undefined || v === true) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new FilmError(`--${k}: 숫자가 필요합니다 (${v})`);
    return n;
  };
  const codec = opt("codec");
  if (codec !== undefined && !CODECS.includes(codec as Codec)) throw new FilmError(`--codec: ${CODECS.join(" | ")} 중 하나`);
  const stills = opt("stills");
  const format = opt("format");
  return {
    film,
    format: typeof format === "string" ? format : null,
    allFormats: opt("all-formats") !== undefined,
    stills: stills === undefined ? null : stills === true ? "beats" : stills,
    draft: opt("draft") !== undefined,
    fps: num("fps"),
    sub: num("sub"),
    from: num("from"),
    to: num("to"),
    codec: (codec as Codec | undefined) ?? "h264",
    noContact: opt("no-contact") !== undefined,
  };
}

/** Serves the workspace (films, lib, assets) to the hidden windows: film.json is fetched, so file:// will not do. */
function startServer(root: string): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = inside(root, rel);
    try {
      if (file && fs.statSync(file).isFile()) return sendFile(req, res, file);
    } catch {
      // fall through
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens the film page in a hidden window and waits for READY (or the reason it never will be). */
async function openFilm(pageUrl: string): Promise<{ win: BrowserWindow; film: StageFilm; errors: string[] }> {
  const win = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { backgroundThrottling: false } });
  const errors: string[] = [];
  // Electron passes (event, level, message) in older versions and a details object in newer ones.
  win.webContents.on("console-message", (...args: unknown[]) => {
    const details = args[0] as { level?: unknown; message?: unknown };
    const level = details.level ?? args[1];
    const message = details.message ?? args[2];
    if (level === "error" || level === 3) errors.push(String(message));
  });
  await win.loadURL(pageUrl);
  const started = Date.now();
  for (;;) {
    const state = (await win.webContents.executeJavaScript("({ ready: window.READY === true, error: window.LOAD_ERROR || null })")) as {
      ready: boolean;
      error: string | null;
    };
    if (state.error) throw new FilmError(state.error);
    if (state.ready) break;
    if (Date.now() - started > LOAD_TIMEOUT_MS) throw new FilmError("필름이 30초 안에 준비되지 않았습니다 (Stage.film이 불리는지 확인)");
    await sleep(20);
  }
  const film = (await win.webContents.executeJavaScript("window.FILM")) as StageFilm;
  // Grab helpers: draw t, hand back the pixels (video) or a PNG (stills).
  await win.webContents.executeJavaScript(`
    window.__canvas = document.getElementById('c');
    window.__ctx = window.__canvas.getContext('2d');
    window.__grab = (t) => { window.seek(t); return window.__ctx.getImageData(0, 0, window.__canvas.width, window.__canvas.height).data; };
    window.__png = (t) => { window.seek(t); return window.__canvas.toDataURL('image/png'); };
    true;
  `);
  return { win, film, errors };
}

let activeFfmpeg: ChildProcess | null = null;
let partialFile: string | null = null;

function ffmpegPath(): string {
  return process.env.MOTION_FFMPEG?.trim() || "ffmpeg";
}

/** ffmpeg reading raw RGBA frames on stdin; resolves when the file is complete. */
function startFfmpeg(args: string[]): { write: (frame: Uint8Array) => Promise<void>; finish: () => Promise<void> } {
  const child = spawn(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["pipe", "ignore", "pipe"] });
  activeFfmpeg = child;
  let stderr = "";
  child.stderr!.on("data", (d) => (stderr += d));
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", (err) =>
      reject(new Error((err as NodeJS.ErrnoException).code === "ENOENT" ? "ffmpeg를 찾지 못했습니다" : String(err))),
    );
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 실패 (${code})\n${stderr.trim()}`))));
  });
  // Without this, a failing ffmpeg surfaces as an unhandled rejection before finish() is awaited.
  exited.catch(() => {});
  return {
    write: (frame) =>
      new Promise((resolve, reject) => {
        if (child.exitCode !== null) return reject(new Error(`ffmpeg가 먼저 끝났습니다\n${stderr.trim()}`));
        if (child.stdin!.write(frame)) resolve();
        else child.stdin!.once("drain", () => resolve());
      }),
    finish: async () => {
      child.stdin!.end();
      await exited;
      activeFfmpeg = null;
    },
  };
}

/** Encoder arguments and output name for each codec. The filter chain before `fmt` is shared. */
function encoder(codec: Codec, draft: boolean, transparent: boolean): { ext: string; base: string; pixFmt: string; args: string[] } {
  switch (codec) {
    case "prores":
      // 4444 keeps the alpha channel for compositing in an editor.
      return { ext: "mov", base: "master", pixFmt: transparent ? "yuva444p10le" : "yuv444p10le", args: ["-c:v", "prores_ks", "-profile:v", "4444", "-vendor", "apl0"] };
    case "webm":
      return { ext: "webm", base: "alpha", pixFmt: transparent ? "yuva420p" : "yuv420p", args: ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1"] };
    case "gif":
      return { ext: "gif", base: "preview", pixFmt: "", args: [] };
    default:
      return {
        ext: "mp4",
        base: draft ? "draft" : "final",
        pixFmt: "yuv420p",
        args: ["-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "22" : "16", "-movflags", "+faststart"],
      };
  }
}

async function renderVideo(
  win: BrowserWindow,
  film: StageFilm,
  job: Job,
  outDir: string,
  emit: (e: WorkerEvent) => void,
): Promise<void> {
  const fps = job.fps ?? (job.draft ? 30 : film.fps || 60);
  const sub = job.sub ?? (job.draft ? 1 : 4);
  const from = job.from ?? 0;
  const to = job.to ?? film.dur;
  if (!(to > from)) throw new FilmError(`--from ${from} --to ${to}: 구간이 비어 있습니다`);
  const total = Math.round((to - from) * fps * sub);
  const enc = encoder(job.codec, job.draft, film.transparent);
  if (film.transparent && job.codec === "h264") emit({ type: "warn", message: "투명 배경 필름입니다. MP4에는 알파가 없습니다 (--codec prores 또는 webm)." });
  const whole = from === 0 && to === film.dur;
  const out = path.join(outDir, whole ? `${enc.base}.${enc.ext}` : `part_${from}-${to}.${enc.ext}`);
  partialFile = out.replace(new RegExp(`\\.${enc.ext}$`), `.partial.${enc.ext}`);

  // tmix averages each group of `sub` sub-frames → motion blur; select keeps
  // the last of each group. The sub-frames sample the interval *before* each
  // frame time (a 360° shutter), which blurs smoothly.
  const blur = sub > 1 ? `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/${fps}/TB,` : "";
  const scale = job.draft ? "scale=iw/2:-2," : "";
  const input = ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${film.W}x${film.H}`, "-framerate", String(fps * sub), "-i", "-"];
  const args =
    job.codec === "gif"
      ? [
          ...input,
          "-filter_complex",
          `${blur}${scale}fps=${Math.min(fps, 30)},scale='min(720,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`,
          partialFile,
        ]
      : [...input, "-vf", `${blur}${scale}format=${enc.pixFmt}`, "-r", String(fps), ...enc.args, partialFile];

  const ff = startFfmpeg(args);
  const started = Date.now();
  let lastReport = 0;
  for (let i = 0; i < total; i++) {
    const t = from + i / (fps * sub);
    const pixels = (await win.webContents.executeJavaScript(`window.__grab(${t})`)) as Uint8ClampedArray;
    await ff.write(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
    if (Date.now() - lastReport > 250 || i === total - 1) {
      lastReport = Date.now();
      emit({ type: "progress", format: film.format, done: i + 1, total });
    }
  }
  await ff.finish();
  fs.renameSync(partialFile, out);
  partialFile = null;
  emit({ type: "file", format: film.format, kind: "video", path: out, seconds: (Date.now() - started) / 1000 });
}

/** Still frames at beats, bars or given times, plus a labelled contact sheet. */
async function renderStills(
  win: BrowserWindow,
  film: StageFilm,
  spec: string,
  outDir: string,
  emit: (e: WorkerEvent) => void,
  contact = true,
): Promise<void> {
  const beat = 60 / film.bpm;
  const off = film.beatOffset || 0;
  const grid = (step: number) =>
    [...Array(Math.floor((film.dur - off) / step) + 1).keys()].map((i) => off + i * step).filter((t) => t < film.dur);
  const times = spec === "beats" ? grid(beat) : spec === "bars" ? grid(beat * 4) : spec.split(",").map(Number);
  if (times.some((t) => !Number.isFinite(t))) throw new FilmError(`--stills: beats | bars | 시각,시각,… (${spec})`);

  const dir = path.join(outDir, "stills");
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  for (const [i, t] of times.entries()) {
    const dataUrl = (await win.webContents.executeJavaScript(`window.__png(${t})`)) as string;
    fs.writeFileSync(path.join(dir, `t${t.toFixed(2).padStart(6, "0")}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
    emit({ type: "progress", format: film.format, done: i + 1, total: times.length });
  }
  if (!contact) {
    emit({ type: "file", format: film.format, kind: "stills", path: dir, count: times.length, seconds: (Date.now() - started) / 1000 });
    return;
  }

  // The sheet is drawn in the film's own page: its fonts are already loaded.
  const labels = times.map((t) => {
    const b = (t - off) / beat;
    const rounded = Math.round(b * 100) / 100;
    return `${t.toFixed(2)}s · beat ${Number.isInteger(rounded) ? Math.round(b) : b.toFixed(2)}`;
  });
  const header = `${film.title} · ${film.format} · ${film.bpm}BPM · ${times.length} stills`;
  const sheet = (await win.webContents.executeJavaScript(`(() => {
    const times = ${JSON.stringify(times)}, labels = ${JSON.stringify(labels)}, header = ${JSON.stringify(header)};
    const src = window.__canvas, cols = Math.min(6, times.length), cw = 300, ch = Math.round(cw * src.height / src.width);
    const pad = 12, head = 30, lab = 22, rows = Math.ceil(times.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * (cw + pad) + pad;
    sheet.height = pad + head + rows * (ch + lab + pad);
    const g = sheet.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '500 13px "Geist Mono", monospace'; g.textBaseline = 'top';
    g.fillStyle = '#fff'; g.fillText(header, pad, pad);
    times.forEach((t, i) => {
      const x = pad + (i % cols) * (cw + pad), y = pad + head + Math.floor(i / cols) * (ch + lab + pad);
      window.seek(t);
      g.save(); g.beginPath(); g.roundRect(x, y, cw, ch, 4); g.clip(); g.drawImage(src, x, y, cw, ch); g.restore();
      g.fillStyle = '#bbb'; g.fillText(labels[i], x, y + ch + 5);
    });
    return sheet.toDataURL('image/png');
  })()`)) as string;
  const out = path.join(outDir, spec === "beats" ? "contact-beats.png" : "contact-stills.png");
  fs.writeFileSync(out, Buffer.from(sheet.split(",")[1], "base64"));
  emit({ type: "file", format: film.format, kind: "contact", path: out, count: times.length, seconds: (Date.now() - started) / 1000 });
}

async function render(job: Job, emit: (e: WorkerEvent) => void): Promise<void> {
  const root = process.cwd();
  const html = fs.existsSync(path.join(job.film, "index.html")) ? path.join(job.film, "index.html") : job.film;
  const rel = path.relative(root, path.resolve(html));
  if (rel.startsWith("..") || !fs.existsSync(html)) throw new FilmError(`필름을 찾지 못했습니다: ${job.film}`);
  const name = path.basename(path.resolve(job.film));

  const server = await startServer(root);
  try {
    const pageUrl = (format: string | null) =>
      `${server.origin}/${rel.split(path.sep).map(encodeURIComponent).join("/")}?render=1${format ? `&format=${encodeURIComponent(format)}` : ""}`;

    const probe = await openFilm(pageUrl(job.format));
    const formats = job.allFormats ? probe.film.formats : [probe.film.format];
    probe.win.destroy();
    if (job.format && !probe.film.formats.includes(job.format)) {
      throw new FilmError(`포맷 ${job.format}이 film.json에 없습니다 (${probe.film.formats.join(", ")})`);
    }

    for (const format of formats) {
      const { win, film, errors } = await openFilm(pageUrl(format));
      try {
        if (errors.length) emit({ type: "warn", message: "페이지 오류:\n  " + errors.join("\n  ") });
        const outDir = path.join(root, "out", name, film.format);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "film.json"), JSON.stringify(film, null, 1));
        const total = job.stills ? 0 : Math.round(((job.to ?? film.dur) - (job.from ?? 0)) * (job.fps ?? (job.draft ? 30 : film.fps || 60)) * (job.sub ?? (job.draft ? 1 : 4)));
        emit({ type: "start", title: film.title, format: film.format, W: film.W, H: film.H, dur: film.dur, bpm: film.bpm, mode: job.stills ? "stills" : "video", total });
        if (job.stills) await renderStills(win, film, job.stills, outDir, emit, !job.noContact);
        else await renderVideo(win, film, job, outDir, emit);
      } finally {
        win.destroy();
      }
    }
  } finally {
    server.close();
  }
}

/** Kills ffmpeg and drops the half-written file, so a cancelled render leaves nothing that looks finished. */
function cleanup(): void {
  activeFfmpeg?.kill("SIGKILL");
  activeFfmpeg = null;
  if (partialFile) fs.rmSync(partialFile, { force: true });
  partialFile = null;
}

/** Entry point for a worker process. Must run before `app` is ready. */
export function runRenderWorker(argv: string[]): void {
  const emit = (e: WorkerEvent) => process.stdout.write(JSON.stringify(e) + "\n");
  // 2D canvases stay on the CPU rasteriser, so the same t gives the same pixels
  // on every Mac. WebGL (3D films) needs the GPU: macOS Chromium has no CPU
  // fallback for it. GPU output is the same run to run on one Mac, but can
  // differ slightly between GPU models.
  app.commandLine.appendSwitch("disable-accelerated-2d-canvas");
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
  app.dock?.hide();
  // Hidden windows open and close per format; that must not end the process.
  app.on("window-all-closed", () => {});
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      cleanup();
      app.exit(130);
    });
  }
  // Electron may quit on a signal without running the handler above; these run either way.
  app.on("will-quit", cleanup);
  process.on("exit", cleanup);

  let job: Job;
  try {
    job = parseJob(argv);
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
    app.exit(1);
    return;
  }

  void app
    .whenReady()
    .then(() => render(job, emit))
    .then(() => {
      emit({ type: "done" });
      app.exit(0);
    })
    .catch((err: Error) => {
      cleanup();
      emit({ type: "error", message: err instanceof FilmError ? err.message : String(err.stack ?? err) });
      app.exit(1);
    });
}
