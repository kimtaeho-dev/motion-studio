#!/usr/bin/env node
/*
 * determinism.mjs — 같은 프레임을 두 번 렌더해서 같은 픽셀인지 확인한다.
 * 다르면 어딘가에 Math.random / 타이머 / 누적 상태가 있다.
 *
 *   node tools/determinism.mjs films/<이름> [시각들]   예: 0,1.37,5.5
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [filmArg, times = '0,1.37,3.21,5.5'] = process.argv.slice(2);
if (!filmArg) {
  console.error('사용법: node tools/determinism.mjs films/<이름> [시각들]');
  process.exit(1);
}
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
