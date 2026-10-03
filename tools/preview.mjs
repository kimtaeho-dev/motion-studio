#!/usr/bin/env node
// 미리보기 서버: npm run preview → http://localhost:4173  (필름 목록 + 각 필름 스크러버)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
const PORT = Number(process.env.PORT || 4173), ROOT = process.cwd();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' };
createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') {
    const films = readdirSync('films').filter((f) => !f.startsWith('_') && existsSync(join('films', f, 'index.html')));
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(`<!doctype html><meta charset="utf-8"><title>motion-studio</title>
<body style="margin:0;padding:40px;background:#1b1b1a;color:#eee;font:15px system-ui">
<h1 style="font-weight:600">motion-studio</h1><ul style="line-height:2">
${films.map((f) => {
  const outs = existsSync(join('out', f)) ? readdirSync(join('out', f)).filter((d) => existsSync(join('out', f, d, 'final.mp4'))) : [];
  return `<li><a style="color:#9cf" href="/films/${f}/index.html">${f}</a> ${outs.map((d) => `· <a style="color:#aaa" href="/out/${f}/${d}/final.mp4">${d}.mp4</a>`).join(' ')}</li>`;
}).join('')}</ul><p style="color:#888">Space 재생/정지 · ←/→ 1프레임 · Shift+←/→ 1비트 · 스크러버 드래그</p></body>`);
  }
  const file = normalize(join(ROOT, url));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`🎬 http://localhost:${PORT}`));
