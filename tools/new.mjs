#!/usr/bin/env node
// 새 필름 만들기: node tools/new.mjs <이름>
//                Lottie 필름: node tools/new.mjs <이름> --lottie [--size 512x512] [--dur 2]
import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && !/^\d/.test(a));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const lottie = args.includes('--lottie');
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('사용법: node tools/new.mjs <영문-소문자-이름> [--lottie --size 512x512 --dur 2]'); process.exit(1); }
const dir = `films/${name}`;
if (existsSync(dir)) { console.error(`${dir} 이미 있음`); process.exit(1); }
if (lottie) {
  const [w, h] = opt('size', '512x512').split('x').map(Number);
  const dur = Number(opt('dur', '2'));
  if (!(w > 0 && h > 0 && dur > 0)) { console.error('--size 512x512 · --dur 2 (초)'); process.exit(1); }
  cpSync('films/_template-lottie', dir, { recursive: true });
  for (const f of ['index.html', 'lottie.json', 'build.mjs', 'brief.md']) {
    writeFileSync(`${dir}/${f}`, readFileSync(`${dir}/${f}`, 'utf8').replaceAll('__NAME__', name)
      .replaceAll('__W__', String(w)).replaceAll('__H__', String(h)).replaceAll('__OP__', String(Math.round(dur * 60))));
  }
  execFileSync(process.execPath, ['tools/lottie.mjs', 'sync', dir], { stdio: 'ignore' });
} else {
  cpSync('films/_template', dir, { recursive: true });
  for (const f of ['index.html', 'film.json', 'brief.md']) writeFileSync(`${dir}/${f}`, readFileSync(`${dir}/${f}`, 'utf8').replaceAll('__NAME__', name));
}
mkdirSync(`${dir}/refs`, { recursive: true });
console.log(`✨ ${dir} 생성. 다음: Claude에게 "/motion-film ${name}" 또는 brief.md를 채워달라고 하세요.`);
