#!/usr/bin/env node
/*
 * render.mjs — 필름을 프레임 단위로 렌더해서 영상이나 스틸로 만든다.
 *
 *   node tools/render.mjs films/<이름>                    # 전체 렌더 (60fps, 모션블러 4서브프레임) → final.mp4
 *   node tools/render.mjs films/<이름> --format 9x16      # 다른 포맷
 *   node tools/render.mjs films/<이름> --draft            # 빠른 초안 (30fps, 서브프레임 1, 절반 해상도) → draft.mp4
 *   node tools/render.mjs films/<이름> --from 4 --to 6    # 일부 구간만 (수정 확인용) → part_4-6.mp4
 *   node tools/render.mjs films/<이름> --stills beats     # 비트마다 1장 → 컨택트 시트 (풀 렌더 전에 꼭)
 *   node tools/render.mjs films/<이름> --stills 0.5,2,4.25 # 지정 시각 스틸
 *   node tools/render.mjs films/<이름> --all-formats      # 정의된 모든 포맷
 *   node tools/render.mjs films/<이름> --codec prores     # 편집용 ProRes 4444 (투명 배경 유지) → master.mov
 *   node tools/render.mjs films/<이름> --codec webm       # 투명 배경 WebM (VP9) → alpha.webm
 *   node tools/render.mjs films/<이름> --codec gif        # 미리보기 GIF (30fps 이하, 720px 이하) → preview.gif
 *   node tools/render.mjs films/<이름> --check3d          # 3D 검사: 파고듦·바닥 아래·가림·잘림 + views.png·motion.png → check3d/
 *
 * 결과: out/<이름>/<포맷>/ 에 영상, film.json, stills/, contact-*.png
 *
 * 렌더 자체는 Electron 렌더 워커(electron/render-worker.ts)가 한다. Motion Studio
 * 앱 안에서 실행되면(MOTION_STUDIO_URL) 앱의 렌더 큐에 맡겨서 화면에 진행률이
 * 보이고 취소할 수 있다. 혼자 실행하면 워커를 직접 띄운다.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAGS_WITH_VALUE = ['format', 'fps', 'sub', 'from', 'to', 'stills', 'codec'];
const argv = process.argv.slice(2);
const filmIndex = argv.findIndex((a, i) => !a.startsWith('--') && !(i > 0 && FLAGS_WITH_VALUE.includes(argv[i - 1].slice(2))));
if (filmIndex < 0) {
  console.error('사용법: node tools/render.mjs films/<이름> [옵션]');
  process.exit(1);
}
// Absolute, so the studio server (whose cwd may differ) resolves the same folder.
const args = argv.map((a, i) => (i === filmIndex ? resolve(a) : a));

/* ── 출력 ── */
const tty = process.stdout.isTTY;
let lastStep = -1;
let started = 0;
function print(event) {
  switch (event.type) {
    case 'queued':
      console.log(`⏳ 앞의 렌더 ${event.ahead}개를 기다리는 중`);
      break;
    case 'start':
      started = Date.now();
      lastStep = -1;
      console.log(`▶ ${event.title} · ${event.format} ${event.W}x${event.H} · ${event.dur}s · ${event.bpm}BPM`);
      break;
    case 'progress': {
      if (!event.total) break;
      const pct = event.done / event.total;
      if (tty) {
        const s = (Date.now() - started) / 1000, eta = event.done ? (s / event.done) * (event.total - event.done) : 0;
        process.stdout.write(`\r  ${Math.round(pct * 100)}%  (${event.done}/${event.total}, 남은 시간 ~${eta.toFixed(0)}초)   `);
      } else {
        // Logged output (the agent reads it): a line per quarter, not one per frame.
        const step = Math.floor(pct * 4);
        if (step > lastStep && step > 0 && step < 4) console.log(`  ${step * 25}%`);
        lastStep = step;
      }
      break;
    }
    case 'file': {
      if (tty) process.stdout.write('\n');
      const where = relative(process.cwd(), event.path);
      if (event.kind === 'check') console.log(`🔍 ${where}/  views.png · motion.png · report.json`);
      else if (event.kind === 'contact') console.log(`🖼  스틸 ${event.count}장 → ${where}`);
      else if (event.kind === 'stills') console.log(`🖼  스틸 ${event.count}장 → ${where}/`);
      else console.log(`🎞  ${where}  (${Math.round(event.seconds)}초)`);
      break;
    }
    case 'report':
      for (const line of event.lines) console.log(`   ${line}`);
      break;
    case 'warn':
      console.warn(`⚠️  ${event.message}`);
      break;
    case 'error':
      if (tty) process.stdout.write('\n');
      console.error(`❌ ${event.message}`);
      break;
  }
}

/** Feeds a stream of NDJSON text to `onEvent`, one parsed object per line. */
function lineReader(onEvent) {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // not one of ours (Electron startup chatter)
      }
    }
  };
}

/* ── 앱의 렌더 큐로 ── */
async function viaStudio(url) {
  const res = await fetch(`${url}/__render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    print({ type: 'error', message: body.error ?? `렌더 큐 응답 ${res.status}` });
    return false;
  }
  let ok = false;
  const feed = lineReader((event) => {
    if (event.type === 'done') ok = true;
    print(event);
  });
  const decoder = new TextDecoder();
  for await (const chunk of res.body) feed(decoder.decode(chunk, { stream: true }));
  return ok;
}

/* ── 워커 직접 ── */
function workerCommand() {
  if (process.env.MOTION_RENDER_CMD) return JSON.parse(process.env.MOTION_RENDER_CMD);
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const worker = join(repo, 'dist-electron', 'render-worker.cjs');
  if (!existsSync(worker)) throw new Error('렌더 엔진이 아직 빌드되지 않았습니다. 먼저 npm run build:electron');
  // In Node, the `electron` package exports the path of its binary.
  const electron = createRequire(join(repo, 'package.json'))('electron');
  return [electron, worker];
}

function direct() {
  let command;
  try {
    command = workerCommand();
  } catch (err) {
    print({ type: 'error', message: err.message });
    return Promise.resolve(false);
  }
  return new Promise((done) => {
    let ok = false;
    const child = spawn(command[0], [...command.slice(1), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    // Chromium's own log lines ("[pid:date:LEVEL:file] …") are not about the film.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      for (const line of text.split('\n')) if (line.trim() && !/^\[\d+:\d+\//.test(line)) process.stderr.write(line + '\n');
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', lineReader((event) => {
      if (event.type === 'done') ok = true;
      print(event);
    }));
    child.on('error', (err) => {
      print({ type: 'error', message: `렌더 엔진을 시작하지 못했습니다: ${err.message}` });
      done(false);
    });
    child.on('close', () => done(ok));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
  });
}

let ok;
const studio = process.env.MOTION_STUDIO_URL;
if (studio) {
  try {
    ok = await viaStudio(studio);
  } catch (err) {
    // The app was closed under us: render on our own rather than fail the step.
    if (err?.cause?.code !== 'ECONNREFUSED') throw err;
    console.warn('⚠️  앱의 렌더 큐에 연결하지 못해서 직접 렌더합니다.');
    ok = await direct();
  }
} else {
  ok = await direct();
}
process.exit(ok ? 0 : 1);
