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
 * download. Canvases draw on the GPU, as in the app's player: the same t
 * gives the same pixels on every run on one Mac.
 *
 * Started by tools/render.mjs (directly, or through the studio server's
 * render queue) with render.mjs's own arguments, from the workspace root.
 * Reports on stdout as one JSON object per line (see WorkerEvent).
 */

export type WorkerEvent =
  | { type: "start"; title: string; format: string; W: number; H: number; dur: number; bpm: number; mode: "video" | "stills"; total: number }
  | { type: "progress"; format: string; done: number; total: number }
  | { type: "file"; format: string; kind: "video" | "stills" | "contact" | "check"; path: string; count?: number; seconds: number }
  | { type: "report"; format: string; lines: string[] }
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
  /** 3D scene check (lib/stage3d-inspect.js): overlaps, occlusion, cropping, motion graphs. */
  check3d: boolean;
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
    check3d: opt("check3d") !== undefined,
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
  // Pixels are read from a copy: Chromium moves a canvas that is read back over
  // and over (every frame of a video) off the GPU, and the film would then draw
  // on the CPU again — with its dark seams — a few frames into every render.
  await win.webContents.executeJavaScript(`
    window.__canvas = document.getElementById('c');
    window.__copy = document.createElement('canvas');
    window.__copyCtx = window.__copy.getContext('2d', { willReadFrequently: true });
    window.__grab = (t) => {
      window.seek(t);
      const c = window.__canvas, w = c.width, h = c.height;
      if (window.__copy.width !== w || window.__copy.height !== h) { window.__copy.width = w; window.__copy.height = h; }
      window.__copyCtx.globalCompositeOperation = 'copy';
      window.__copyCtx.drawImage(c, 0, 0);
      return window.__copyCtx.getImageData(0, 0, w, h).data;
    };
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

interface CheckIssue {
  kind: "penetrate" | "below" | "occluded" | "cropped" | "floaty" | "jam";
  a: string;
  b?: string;
  from: number;
  to: number;
  max: number;
  at: number;
  fix?: string;
  pairs?: string[];
  count?: number;
}

/** Runs lib/stage3d-inspect.js inside the film page and writes out/<film>/<format>/check3d/. */
async function check3d(win: BrowserWindow, film: StageFilm, outDir: string, emit: (e: WorkerEvent) => void): Promise<void> {
  const started = Date.now();
  const result = (await win.webContents.executeJavaScript(`(async () => {
    // 필름이 실제로 쓰는 엔진 폴더의 검사 코드를 쓴다 (전달해서 엔진이 고정된 필름은 lib-versions/<지문>/lib/)
    const used = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.split('?')[0].endsWith('/stage3d.js'));
    const m = await import(new URL('stage3d-inspect.js', used || new URL('../../lib/', location.href).href).href);
    return await m.check(${JSON.stringify({ dur: film.dur, bpm: film.bpm, beatOffset: film.beatOffset })});
  })()`)) as { objects: string[]; issues: CheckIssue[]; impacts: { t: number; name: string; speed: number }[]; notes: string[]; offscreen: { a: string; from: number; to: number }[]; warns: string[]; natural: number;
    composition: { beats: { beat: number; t: number; margins?: number[]; fill3d?: number; flags: string[] }[]; fixes: { from: number; to: number; what: string; fix: string }[]; overlaps: { str: string; from: number; to: number; max: number }[] };
    allowed: { kind: string; a: string }[]; pass: boolean; images: Record<string, string> };
  const dir = path.join(outDir, "check3d");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of Object.entries(result.images)) fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  const { images, ...report } = result;
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 1));

  const span = (x: CheckIssue) => (x.to - x.from < 0.01 ? `${x.from.toFixed(2)}s` : `${x.from.toFixed(2)}–${x.to.toFixed(2)}s`);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const text: Record<CheckIssue["kind"], (x: CheckIssue) => string> = {
    penetrate: (x) => `파고듦  ${span(x)}  ${x.a} ↔ ${x.b}  최대 ${x.max.toFixed(3)} (${x.at.toFixed(2)}s)`,
    below: (x) => `바닥 아래  ${span(x)}  ${x.a}  최대 ${x.max.toFixed(3)}`,
    occluded: (x) => `가림  ${span(x)}  ${x.a}이(가) ${x.b}에 최대 ${pct(x.max)} 가려짐 (${x.at.toFixed(2)}s)`,
    cropped: (x) => `잘림  ${span(x)}  ${x.a} 최대 ${pct(x.max)} 화면 밖 (${x.at.toFixed(2)}s)`,
    floaty: (x) => `무게감  ${span(x)}  ${x.a}이(가) 바닥에 닿기 전 ${pct(x.max)} 느려짐`,
    jam: (x) => `끼임  ${span(x)}  물리 물체끼리 계속 파고든 채 있음 (${x.count}개) — 심한 쌍: ${(x.pairs ?? []).join(" · ")}`,
  };
  // 첫 줄이 판정: 통과면 그림을 열 필요가 없다
  const lines = [result.pass ? "판정: 통과 — 그림을 열지 않아도 된다" : `판정: 고칠 것 ${result.issues.length}개 — 아래 → 줄의 제안대로 고치고 한 번 더 검사`];
  lines.push(`물체: ${result.objects.join(", ")}`);
  for (const x of result.issues) {
    lines.push(text[x.kind](x));
    if (x.fix) lines.push(`    → ${x.fix}`);
  }
  for (const w of result.warns) lines.push(`비트  ${w}`);
  // 구도: 내용(3D + 화면 글자)의 여백. 숫자로 맞추고 컨택트 시트는 마지막에 한 번
  const cp = result.composition;
  if (cp && cp.beats.length) {
    const bad = cp.fixes.length + cp.overlaps.length;
    lines.push(bad ? `구도: 손볼 곳 ${bad}개 — 숫자대로 고치고 다시 검사 (컨택트 시트는 마지막에 한 번)` : `구도: 좋음 — 비트 ${cp.beats.length}개 모두 여백 5–30% 안`);
    lines.push(`  여백 위/아래/왼/오 %: ${cp.beats.map((b) => (b.margins ? `b${b.beat} ${b.margins.join("/")}` : `b${b.beat} 없음`)).join(" · ")}`);
    for (const f of cp.fixes) lines.push(`  ${f.from.toFixed(2)}–${f.to.toFixed(2)}s ${f.what}\n    → ${f.fix}`);
    for (const o of cp.overlaps) lines.push(`  글자 '${o.str.slice(0, 16)}'이(가) 3D 물체와 최대 ${Math.round(o.max * 100)}% 겹침 ${o.from.toFixed(2)}–${o.to.toFixed(2)}s → 글자 자리나 물체 배치를 옮긴다 (의도면 그대로)`);
  }
  if (result.natural) lines.push(`그릇에 담기거나 물리로 쌓여 가려진 것 ${result.natural}건 — 정상으로 봤다`);
  if (result.allowed.length) lines.push(`의도로 표시됨(W.allow) ${result.allowed.length}건 — 실패에서 뺐다`);
  for (const note of result.notes) lines.push(`물리 설정  ${note}`);
  if (result.offscreen.length) {
    const t = (x: number) => x.toFixed(2);
    lines.push(`화면 밖 (등장 전·퇴장 후라면 정상): ${result.offscreen.map((o) => `${o.a} ${t(o.from)}–${t(o.to)}s`).join(" · ")}`);
  }
  if (result.impacts.length) lines.push(`충돌: ${result.impacts.map((i) => `${i.t.toFixed(2)}s ${i.name}`).join(" · ")}`);
  emit({ type: "report", format: film.format, lines });
  emit({ type: "file", format: film.format, kind: "check", path: dir, seconds: (Date.now() - started) / 1000 });
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
        const total = job.stills || job.check3d ? 0 : Math.round(((job.to ?? film.dur) - (job.from ?? 0)) * (job.fps ?? (job.draft ? 30 : film.fps || 60)) * (job.sub ?? (job.draft ? 1 : 4)));
        emit({ type: "start", title: film.title, format: film.format, W: film.W, H: film.H, dur: film.dur, bpm: film.bpm, mode: job.stills || job.check3d ? "stills" : "video", total });
        if (job.check3d) await check3d(win, film, outDir, emit);
        else if (job.stills) await renderStills(win, film, job.stills, outDir, emit, !job.noContact);
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
  // 2D draws on the GPU like the app's player, so a render matches what the
  // designer saw: the CPU rasteriser leaves a dark seam where two shapes share
  // an anti-aliased edge (a shadow shape under a card), the GPU does not. GPU
  // output is the same run to run on one Mac (measured: stills and whole
  // videos byte-identical), but can differ slightly between GPU models — as
  // WebGL already did. 3D films render about twice as fast: the 3D layer is
  // composited without leaving the GPU. MOTION_CPU2D=1 goes back to the CPU.
  if (process.env.MOTION_CPU2D === "1") app.commandLine.appendSwitch("disable-accelerated-2d-canvas");
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
