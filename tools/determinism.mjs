#!/usr/bin/env node
/*
 * determinism.mjs — 같은 프레임을 두 번(서로 다른 프로세스에서) 렌더해서 같은 픽셀인지 확인한다.
 * 다르면 어딘가에 Math.random / 타이머 / 누적 상태 / 첫 렌더에 기대는 코드가 있다.
 * 단, GPU는 같은 맥에서도 렌더 프로세스마다 가는 획의 가장자리를 몇 단계 다르게 칠할 때가 있다(3D 텍스처로 올린
 * 크레용 결에서 최대 4/255, 0.3% 픽셀). 이건 필름 코드의 문제가 아니라서 통과로 보고 알리기만 한다.
 * 한 페이지 안에서 순서를 뒤섞어 보는 검사는 render.mjs --check가 한다.
 *
 *   node tools/determinism.mjs films/<이름> [시각들]   예: 0,1.37,5.5 (없으면 필름 길이에 고르게 8장)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [filmArg, timesArg] = process.argv.slice(2);
if (!filmArg) {
  console.error('사용법: node tools/determinism.mjs films/<이름> [시각들]');
  process.exit(1);
}
// 기본: 필름 길이 안에 고르게 8장 (반올림이 겹치지 않게 홀수 간격으로 비켜서)
const dur = JSON.parse(readFileSync(join(filmArg, 'film.json'), 'utf8')).dur;
const times = timesArg ?? Array.from({ length: 8 }, (_, i) => (dur * (i + 0.37) / 8).toFixed(2)).join(',');
const render = join(dirname(fileURLToPath(import.meta.url)), 'render.mjs');
const name = basename(resolve(filmArg));

const files = times.split(',').map((t) => `t${Number(t).toFixed(2).padStart(6, '0')}.png`);

// 필름 코드의 실수(물체 위치·색이 바뀜)는 이보다 훨씬 크게 다르다
const GPU_MAX = 8;        // 채널 차이 최대 (0–255)
const GPU_PCT = 1;        // 다른 픽셀 비율 최대 (%)

/** PNG → RGBA bytes via ffmpeg (the app sets MOTION_FFMPEG). null when ffmpeg is not there. */
function pixels(png) {
  const r = spawnSync(process.env.MOTION_FFMPEG?.trim() || 'ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    { input: png, maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
}

/** How far apart two PNGs are: { max, pct } or null when they cannot be compared. */
function distance(a, b) {
  const pa = pixels(a), pb = pixels(b);
  if (!pa || !pb || pa.length !== pb.length) return null;
  let max = 0, n = 0;
  for (let i = 0; i < pa.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(pa[i + k] - pb[i + k]));
    if (d) { n++; if (d > max) max = d; }
  }
  return { max, pct: (100 * n) / (pa.length / 4) };
}

/** Renders just these stills (no contact sheet) and returns their PNG bytes, for the format render.mjs picked. */
function pass() {
  const r = spawnSync(process.execPath, [render, filmArg, '--stills', times, '--no-contact'], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exit(1);
  }
  const format = /· (\S+) \d+x\d+ ·/.exec(r.stdout)?.[1];
  const dir = join('out', name, format, 'stills');
  const pngs = {};
  for (const f of files) {
    pngs[f] = readFileSync(join(dir, f));
    // Only what this check rendered goes; stills the agent made for itself stay.
    rmSync(join(dir, f));
  }
  return pngs;
}

const a = pass();
const b = pass();
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const differ = Object.keys(a).filter((f) => md5(a[f]) !== md5(b[f]));
const gpu = [], real = [];
for (const f of differ) {
  const d = distance(a[f], b[f]);
  if (d && d.max <= GPU_MAX && d.pct <= GPU_PCT) gpu.push(`${f} (최대 ${d.max}/255, ${d.pct.toFixed(2)}%)`);
  else real.push(d ? `${f} (최대 ${d.max}/255, ${d.pct.toFixed(2)}%)` : f);
}
if (real.length) {
  console.log(`❌ 렌더마다 결과가 다릅니다: ${real.join(', ')}`);
  process.exit(1);
}
console.log(`✅ 결정적: 같은 시각 → 같은 그림 (${Object.keys(a).length}장)`);
if (gpu.length) console.log(`   GPU 미세 차이 ${gpu.length}장 — 필름 코드 문제가 아니다. 고치지 않는다: ${gpu.join(', ')}`);
