#!/usr/bin/env node
// 새 필름 만들기: node tools/new.mjs <이름>
import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const name = process.argv[2];
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('사용법: node tools/new.mjs <영문-소문자-이름>'); process.exit(1); }
const dir = `films/${name}`;
if (existsSync(dir)) { console.error(`${dir} 이미 있음`); process.exit(1); }
cpSync('films/_template', dir, { recursive: true });
for (const f of ['index.html', 'film.json', 'brief.md']) writeFileSync(`${dir}/${f}`, readFileSync(`${dir}/${f}`, 'utf8').replaceAll('__NAME__', name));
mkdirSync(`${dir}/refs`, { recursive: true }); mkdirSync(`${dir}/audio`, { recursive: true });
console.log(`✨ ${dir} 생성. 다음: Claude에게 "/motion-film ${name}" 또는 brief.md를 채워달라고 하세요.`);
