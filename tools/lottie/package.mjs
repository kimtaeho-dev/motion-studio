/*
 * package.mjs — Lottie 필름을 개발자에게 넘길 파일로: film.json의 params를 슬롯에 굽고, 이미지 에셋을 JSON 안에 넣는다.
 * tools/lottie.mjs export와 앱의 내보내기(server/export.ts)가 같이 쓴다.
 *
 *   packageLottie(filmDir) → { name, json: Buffer, dotLottie: Buffer }
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { bake } from '../../lib/lottie/bake.mjs';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

/** 압축 없이 담는 zip (dotLottie는 zip이면 된다) */
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name), crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    local.push(head, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const count = Object.keys(files).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export function packageLottie(filmDir) {
  const doc = JSON.parse(readFileSync(join(filmDir, 'lottie.json'), 'utf8'));
  let film = {};
  try { film = JSON.parse(readFileSync(join(filmDir, 'film.json'), 'utf8')); } catch { /* 슬롯 기본값 그대로 */ }
  const values = Object.fromEntries(Object.entries(film.params || {}).map(([k, p]) => [k, p.value]));
  const out = bake(doc, values);
  for (const a of out.assets || []) {
    if (!a.p || a.e || String(a.p).startsWith('data:')) continue;
    const file = join(filmDir, a.u || '', a.p);
    if (!existsSync(file)) throw new Error(`이미지 에셋이 없습니다: ${file}`);
    const ext = a.p.split('.').pop().toLowerCase();
    a.p = `data:${MIME[ext] || 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
    a.u = ''; a.e = 1;
  }
  const name = basename(resolve(filmDir));
  const json = Buffer.from(JSON.stringify(out));
  const manifest = { version: '1', generator: 'Motion Studio', author: '', animations: [{ id: name, loop: true, autoplay: true }] };
  const dotLottie = zip({ 'manifest.json': Buffer.from(JSON.stringify(manifest)), [`animations/${name}.json`]: json });
  return { name, json, dotLottie };
}
