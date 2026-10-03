#!/usr/bin/env node
/*
 * render.mjs — 필름을 프레임 단위로 렌더해서 MP4로 만든다.
 *
 *   node tools/render.mjs films/<이름>                    # 전체 렌더 (60fps, 모션블러 4서브프레임)
 *   node tools/render.mjs films/<이름> --format 9x16      # 다른 포맷
 *   node tools/render.mjs films/<이름> --draft            # 빠른 초안 (30fps, 서브프레임 1, 절반 해상도)
 *   node tools/render.mjs films/<이름> --from 4 --to 6    # 일부 구간만 (수정 확인용)
 *   node tools/render.mjs films/<이름> --stills beats     # 비트마다 1장 → 컨택트 시트 (풀 렌더 전에 꼭)
 *   node tools/render.mjs films/<이름> --stills 0.5,2,4.25 # 지정 시각 스틸
 *   node tools/render.mjs films/<이름> --all-formats      # 정의된 모든 포맷
 *
 * 결과: out/<이름>/<포맷>/ 에 silent.mp4, cues.json, film.json, stills/, contact.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = ['format', 'fps', 'sub', 'from', 'to', 'stills'];
const filmDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && FLAGS_WITH_VALUE.includes(argv[i - 1].slice(2))));
if (!filmDir) { console.error('사용법: node tools/render.mjs films/<이름> [옵션]'); process.exit(1); }
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };

const draft = !!opt('draft', false);
const name = basename(resolve(filmDir));
const html = existsSync(join(filmDir, 'index.html')) ? join(filmDir, 'index.html') : filmDir;

async function openFilm(browser, format, scale = 1) {
  // 먼저 메타데이터를 읽기 위해 작은 창으로 연다
  const probe = await browser.newPage();
  await probe.goto(pathToFileURL(resolve(html)).href + `?render=1${format ? '&format=' + format : ''}`);
  await probe.waitForFunction(() => window.READY === true, null, { timeout: 30000 });
  const film = await probe.evaluate(() => window.FILM);
  await probe.close();

  const page = await browser.newPage({ viewport: { width: film.W, height: film.H }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(pathToFileURL(resolve(html)).href + `?render=1&format=${film.format}`);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 30000 });
  if (errors.length) console.warn('⚠️  페이지 오류:\n  ' + errors.join('\n  '));
  return { page, film };
}

async function frame(page, film, t) {
  await page.evaluate((tt) => window.seek(tt), t);
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: film.W, height: film.H }, animations: 'disabled' });
}

function ffmpeg(args, stdin) {
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => (c === 0 ? ok() : fail(new Error('ffmpeg 실패 ' + c))));
    if (stdin) stdin(p.stdin);
  });
}

/* 스틸 + 컨택트 시트: 라벨(시각/비트)을 붙여 브라우저에서 합성한다 */
async function stills(browser, page, film, outDir, spec) {
  const beatLen = 60 / film.bpm, off = film.beatOffset || 0;
  let times;
  if (spec === 'beats' || spec === true) times = [...Array(Math.floor((film.dur - off) / beatLen) + 1).keys()].map((i) => off + i * beatLen).filter((t) => t < film.dur);
  else if (spec === 'bars') times = [...Array(Math.floor((film.dur - off) / (beatLen * 4)) + 1).keys()].map((i) => off + i * beatLen * 4).filter((t) => t < film.dur);
  else times = String(spec).split(',').map(Number);

  const dir = join(outDir, 'stills'); mkdirSync(dir, { recursive: true });
  const imgs = [];
  for (const t of times) {
    const png = await frame(page, film, t);
    const f = join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`);
    writeFileSync(f, png);
    imgs.push({ t, b: (t - off) / beatLen, src: 'data:image/png;base64,' + png.toString('base64') });
  }
  const cols = Math.min(6, imgs.length), cw = 300, ch = Math.round((cw * film.H) / film.W);
  const sheet = await browser.newPage({ viewport: { width: cols * (cw + 12) + 12, height: 400 } });
  await sheet.setContent(`<body style="margin:0;padding:12px;background:#111;font:500 13px monospace;color:#bbb">
    <div style="margin-bottom:8px;color:#fff">${film.title} · ${film.format} · ${film.bpm}BPM · ${imgs.length} stills</div>
    <div style="display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:12px">
    ${imgs.map((i) => `<div><img src="${i.src}" style="width:${cw}px;height:${ch}px;display:block;border-radius:4px">
      <div style="padding-top:4px">${i.t.toFixed(2)}s · beat ${Number.isInteger(Math.round(i.b * 100) / 100) ? Math.round(i.b) : i.b.toFixed(2)}</div></div>`).join('')}
    </div></body>`);
  const out = join(outDir, spec === 'beats' || spec === true ? 'contact-beats.png' : 'contact-stills.png');
  await sheet.screenshot({ path: out, fullPage: true });
  await sheet.close();
  console.log(`🖼  스틸 ${imgs.length}장 → ${out}`);
}

async function renderVideo(page, film, outDir) {
  const fps = Number(opt('fps', draft ? 30 : film.fps || 60));
  const sub = Number(opt('sub', draft ? 1 : 4));
  const from = Number(opt('from', 0)), to = Number(opt('to', film.dur));
  const total = Math.round((to - from) * fps * sub);
  const out = join(outDir, from === 0 && to === film.dur ? 'silent.mp4' : `part_${from}-${to}.mp4`);

  // tmix로 서브프레임 sub장을 평균 → 모션블러. select로 그룹의 마지막 프레임만 남긴다.
  const vf = (sub > 1 ? `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/${fps}/TB,` : '') +
    (draft ? 'scale=iw/2:-2,' : '') + 'format=yuv420p';
  const started = Date.now();
  let done = 0;
  await ffmpeg(['-f', 'image2pipe', '-framerate', String(fps * sub), '-i', '-', '-vf', vf, '-r', String(fps),
    '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '22' : '16', '-movflags', '+faststart', out],
  async (stdin) => {
    for (let i = 0; i < total; i++) {
      // 서브프레임은 프레임 시각 "직전" 구간을 샘플 (셔터 180°가 아닌 360°에 가까움 — 부드러운 블러)
      const t = from + i / (fps * sub);
      const png = await frame(page, film, t);
      if (!stdin.write(png)) await new Promise((r) => stdin.once('drain', r));
      done++;
      if (done % (fps * sub) === 0) {
        const s = (Date.now() - started) / 1000, eta = (s / done) * (total - done);
        process.stdout.write(`\r  ${(done / (fps * sub)).toFixed(0)}s / ${(to - from).toFixed(0)}s  (남은 시간 ~${eta.toFixed(0)}초)   `);
      }
    }
    stdin.end();
  });
  console.log(`\n🎞  ${out}  (${((Date.now() - started) / 1000).toFixed(0)}초)`);
}

// 브라우저 경로를 직접 지정하려면 CHROMIUM_PATH 환경변수 (예: 사내 이미지, CI)
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const probe = await openFilm(browser, opt('format', null));
  const formats = opt('all-formats', false) ? probe.film.formats : [probe.film.format];
  await probe.page.close();

  for (const format of formats) {
    const { page, film } = await openFilm(browser, format);
    const outDir = join('out', name, film.format);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'film.json'), JSON.stringify({ ...film, cues: undefined }, null, 1));
    writeFileSync(join(outDir, 'cues.json'), JSON.stringify(film.cues, null, 1));
    console.log(`▶ ${film.title} · ${film.format} ${film.W}x${film.H} · ${film.dur}s · ${film.bpm}BPM · 효과음 ${film.cues.length}개`);

    if (opt('stills', false)) await stills(browser, page, film, outDir, opt('stills'));
    else await renderVideo(page, film, outDir);
    await page.close();
  }
} finally {
  await browser.close();
}
