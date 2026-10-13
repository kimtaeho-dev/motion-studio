#!/usr/bin/env node
/*
 * determinism.mjs — 같은 프레임을 두 번(서로 다른 프로세스에서) 렌더해서 같은 픽셀인지 확인한다.
 * 다르면 어딘가에 Math.random / 타이머 / 누적 상태 / 첫 렌더에 기대는 코드가 있다.
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

/** Renders just these stills (no contact sheet) and returns their md5s, for the format render.mjs picked. */
function pass() {
  const r = spawnSync(process.execPath, [render, filmArg, '--stills', times, '--no-contact'], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exit(1);
  }
  const format = /· (\S+) \d+x\d+ ·/.exec(r.stdout)?.[1];
  const dir = join('out', name, format, 'stills');
  const hashes = {};
  for (const f of files) {
    hashes[f] = createHash('md5').update(readFileSync(join(dir, f))).digest('hex');
    // Only what this check rendered goes; stills the agent made for itself stay.
    rmSync(join(dir, f));
  }
  return hashes;
}

const a = pass();
const b = pass();
const differ = Object.keys(a).filter((f) => a[f] !== b[f]);
if (differ.length === 0) {
  console.log(`✅ 결정적: 같은 시각 → 같은 픽셀 (${Object.keys(a).length}장)`);
} else {
  console.log(`❌ 렌더마다 결과가 다릅니다: ${differ.join(', ')}`);
  process.exit(1);
}
