#!/usr/bin/env node
/*
 * lottie.mjs — Lottie 필름(films/<이름>/lottie.json) 도구. 쓰는 법은 prompts/lottie.md.
 *
 *   node tools/lottie.mjs sync films/<이름>     # lottie.json → film.json (dur·fps·크기·params). lottie.json을 고칠 때마다
 *   node tools/lottie.mjs check films/<이름>    # 호환(lottie-web)·움직임·슬롯 검사. BLOCK이 있으면 exit 1
 *   node tools/lottie.mjs export films/<이름>   # params를 슬롯에 구워 out/<이름>/lottie/<이름>.json · <이름>.lottie
 *   node tools/lottie.mjs text "문구" [--font Pretendard-Bold] [--size 72] [--color #111111] [--slot ink]
 *                                     [--align left|center|right] [--tracking 0] [--name 제목]
 *       → 글자를 아웃라인 셰이프 레이어(ty:4) JSON으로 (stdout). 글자마다 그룹 하나(nm = 글자), 그룹 변환의 기준점은 글자 중심.
 *         글꼴: assets/fonts/ttf/ (Pretendard-Bold · Pretendard-SemiBold · Geist-Bold · Geist-SemiBold)
 *
 * lottie-web으로 실제 그려 비교하는 검사는 브라우저가 필요해서 render.mjs에 있다: node tools/render.mjs films/<이름> --parity
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bake, hexToRgba, slotsOf } from '../lib/lottie/bake.mjs';
import { packageLottie } from './lottie/package.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function readFilm(dir) {
  if (!dir || !existsSync(join(dir, 'lottie.json'))) die(`Lottie 필름이 아닙니다: ${dir} (lottie.json이 없다)`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(dir, 'lottie.json'), 'utf8'));
  } catch (e) {
    die(`lottie.json이 JSON으로 읽히지 않습니다: ${e.message}`);
  }
  for (const k of ['v', 'fr', 'ip', 'op', 'w', 'h', 'layers']) if (doc[k] === undefined) die(`lottie.json에 ${k}가 없습니다`);
  let film = {};
  try {
    film = JSON.parse(readFileSync(join(dir, 'film.json'), 'utf8'));
  } catch {
    // 처음 sync
  }
  return { doc, film };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/* ── sync ─────────────────────────────────────────────────────────── */
function sync(dir, { quiet = false } = {}) {
  const { doc, film } = readFilm(dir);
  const notes = [];
  const slots = slotsOf(doc);
  const prev = film.params || {};
  const params = {};
  // 속성 패널 순서 = params 순서: 이미 있던 것은 그 자리, 새 슬롯은 뒤에
  const order = [...Object.keys(prev).filter((k) => slots[k]), ...Object.keys(slots).filter((k) => !prev[k])];
  for (const sid of order) {
    const s = slots[sid];
    if (s.animated) { notes.push(`슬롯 ${sid}: 키프레임이 있는 슬롯은 속성 패널에 올리지 않는다`); continue; }
    if (s.type === 'vec2') { notes.push(`슬롯 ${sid}: 위치·크기 슬롯은 속성 패널에 올리지 않는다`); continue; }
    const old = prev[sid];
    // 디자이너가 바꾼 값은 그대로 둔다. 종류가 바뀐 슬롯만 lottie.json 값으로 다시 시작
    params[sid] = old && old.type === s.type
      ? old
      : { type: s.type, value: s.value, label: (old && old.label) || sid };
    if (params[sid].label === sid) notes.push(`슬롯 ${sid}: label이 없다 — film.json에서 디자이너가 알아볼 한국어로 고친다`);
  }
  for (const k of Object.keys(prev)) if (!params[k]) notes.push(`params.${k}: lottie.json에 그 슬롯이 없어 뺐다`);

  const fps = doc.fr;
  const next = {
    title: film.title || doc.nm || basename(resolve(dir)),
    kind: 'lottie',
    dur: round3((doc.op - doc.ip) / fps),
    bpm: film.bpm || 120,
    beatOffset: film.beatOffset || 0,
    fps,
    formats: { [`${doc.w}x${doc.h}`]: [doc.w, doc.h] },
    transparent: film.transparent ?? true,
    params,
    timeline: {},
  };
  writeFileSync(join(dir, 'film.json'), JSON.stringify(next, null, 2) + '\n');
  if (!quiet) {
    console.log(`film.json ← lottie.json: ${doc.w}x${doc.h} · ${next.dur}s · ${fps}fps · 슬롯 ${Object.keys(params).length}개`);
    for (const n of notes) console.log(`  - ${n}`);
  }
  return { doc, film: next, notes };
}

/* ── check ────────────────────────────────────────────────────────── */
function check(dir) {
  const { doc, film } = readFilm(dir);
  const file = join(dir, 'lottie.json');
  let fail = false;
  const run = (script, label) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'lottie', script), file], { encoding: 'utf8' });
    console.log(`── ${label}`);
    process.stdout.write((r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) fail = true;
  };
  run('check-compat.mjs', '호환 (lottie-web에서도 같게 나오는지, 정적 검사)');
  run('check-motion.mjs', '움직임 (이징 곡선 끊김)');

  console.log('── film.json');
  const want = { dur: round3((doc.op - doc.ip) / doc.fr), fps: doc.fr, size: `${doc.w}x${doc.h}` };
  const size = film.formats && Object.values(film.formats)[0];
  const off = [];
  if (film.kind !== 'lottie') off.push('kind가 lottie가 아님');
  if (Math.abs((film.dur ?? 0) - want.dur) > 0.5 / doc.fr) off.push(`dur ${film.dur} ≠ ${want.dur}`);
  if (film.fps !== want.fps) off.push(`fps ${film.fps} ≠ ${want.fps}`);
  if (!size || `${size[0]}x${size[1]}` !== want.size) off.push(`크기 ≠ ${want.size}`);
  const slots = slotsOf(doc);
  for (const k of Object.keys(film.params || {})) if (!slots[k]) off.push(`params.${k}에 해당하는 슬롯이 없음`);
  for (const [k, p] of Object.entries(film.params || {})) if (p.label === k) off.push(`params.${k}: label을 한국어로`);
  if (off.length) {
    fail = true;
    console.log(`  BLOCK ${off.join(' · ')} → node tools/lottie.mjs sync ${dir} 후 label을 고친다`);
  } else {
    console.log('  통과 — lottie.json과 맞다');
  }
  const kb = Buffer.byteLength(JSON.stringify(bake(doc, values(film)))) / 1024;
  console.log(`\n${fail ? '실패 — BLOCK을 0으로 만든다' : '통과'} · 내보낼 크기 약 ${Math.round(kb)}KB${kb > 150 ? ' (150KB 넘음 — 레이어·키프레임을 줄인다)' : ''}`);
  console.log('다음: node tools/render.mjs ' + dir + ' --parity  (lottie-web으로 실제 그려 비교)');
  process.exit(fail ? 1 : 0);
}

const values = (film) => Object.fromEntries(Object.entries(film.params || {}).map(([k, p]) => [k, p.value]));

/* ── export ───────────────────────────────────────────────────────── */
function exportFilm(dir) {
  readFilm(dir);
  let pkg;
  try {
    pkg = packageLottie(dir);
  } catch (e) {
    die(e.message);
  }
  const outDir = join(ROOT, 'out', pkg.name, 'lottie');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${pkg.name}.json`), pkg.json);
  writeFileSync(join(outDir, `${pkg.name}.lottie`), pkg.dotLottie);
  console.log(`내보냄: out/${pkg.name}/lottie/${pkg.name}.json (${Math.round(pkg.json.length / 1024)}KB) · ${pkg.name}.lottie`);
}

/* ── text → 아웃라인 ──────────────────────────────────────────────── */
async function text(args) {
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const str = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!str) die('사용법: node tools/lottie.mjs text "문구" [--font Pretendard-Bold] [--size 72] [--color #111111] [--slot ink] [--align left] [--tracking 0]');
  const fontName = opt('font', 'Pretendard-Bold');
  const fontFile = join(ROOT, 'assets', 'fonts', 'ttf', `${fontName}.ttf`);
  if (!existsSync(fontFile)) die(`글꼴이 없습니다: ${fontName} (Pretendard-Bold · Pretendard-SemiBold · Geist-Bold · Geist-SemiBold)`);
  const opentype = await import('../lib/three/addons/libs/opentype.module.js');
  const buf = readFileSync(fontFile);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const size = +opt('size', 72), tracking = +opt('tracking', 0), align = opt('align', 'left');
  const color = hexToRgba(opt('color', '#111111'));
  if (!color) die('--color는 #RRGGBB');
  const slot = opt('slot');

  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  const groups = [];
  let x = 0;
  const r = (v) => Math.round(v * 100) / 100;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    const ch = [...str][i] ?? '';
    const path = glyph.getPath(x, 0, size);
    const bb = path.getBoundingBox();
    const shapes = [];
    let cur = null;
    const close = () => {
      if (!cur || cur.v.length < 2) { cur = null; return; }
      // 마지막 점이 첫 점과 같으면 합친다 (들어오는 접선은 첫 점으로)
      const n = cur.v.length - 1;
      if (Math.abs(cur.v[n][0] - cur.v[0][0]) < 1e-6 && Math.abs(cur.v[n][1] - cur.v[0][1]) < 1e-6) {
        cur.i[0] = cur.i[n]; cur.v.pop(); cur.i.pop(); cur.o.pop();
      }
      shapes.push({ ty: 'sh', nm: `윤곽 ${shapes.length + 1}`, ks: { a: 0, k: { c: true, v: cur.v.map((p) => p.map(r)), i: cur.i.map((p) => p.map(r)), o: cur.o.map((p) => p.map(r)) } } });
      cur = null;
    };
    for (const c of path.commands) {
      if (c.type === 'M') { close(); cur = { v: [[c.x, c.y]], i: [[0, 0]], o: [[0, 0]] }; }
      else if (c.type === 'L') { cur.v.push([c.x, c.y]); cur.i.push([0, 0]); cur.o.push([0, 0]); }
      else if (c.type === 'Q' || c.type === 'C') {
        const [px, py] = cur.v[cur.v.length - 1];
        const c1 = c.type === 'Q' ? [px + (2 / 3) * (c.x1 - px), py + (2 / 3) * (c.y1 - py)] : [c.x1, c.y1];
        const c2 = c.type === 'Q' ? [c.x + (2 / 3) * (c.x1 - c.x), c.y + (2 / 3) * (c.y1 - c.y)] : [c.x2, c.y2];
        cur.o[cur.o.length - 1] = [c1[0] - px, c1[1] - py];
        cur.v.push([c.x, c.y]); cur.i.push([c2[0] - c.x, c2[1] - c.y]); cur.o.push([0, 0]);
      } else if (c.type === 'Z') close();
    }
    close();
    if (shapes.length) {
      const cx = r((bb.x1 + bb.x2) / 2), cy = r((bb.y1 + bb.y2) / 2);
      groups.push({
        ty: 'gr', nm: ch,
        it: [...shapes, {
          ty: 'tr', p: { a: 0, k: [cx, cy] }, a: { a: 0, k: [cx, cy] }, s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 },
        }],
      });
    }
    let adv = glyph.advanceWidth * scale + tracking;
    if (i + 1 < glyphs.length) adv += font.getKerningValue(glyph, glyphs[i + 1]) * scale;
    x += adv;
  }
  const width = x - tracking;
  const shift = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
  const fill = { ty: 'fl', nm: '칠', c: { a: 0, k: color, ...(slot ? { sid: slot } : {}) }, o: { a: 0, k: 100 }, r: 1 };
  const layer = {
    ddd: 0, ty: 4, nm: opt('name', str), sr: 1, ip: 0, op: 99999, st: 0, bm: 0,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [-r(shift), 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    shapes: [{ ty: 'gr', nm: '글자', it: [...groups, fill, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } }] }],
  };
  const out = {
    note: '레이어 위치(ks.p)가 글자 기준선의 ' + (align === 'center' ? '가운데' : align === 'right' ? '오른쪽 끝' : '왼쪽 끝') +
      '. ip·op는 장면에 맞게 고친다. 글자마다 그룹(nm = 글자)이라 그룹 tr로 따로 움직인다.',
    width: r(width), ascent: r(font.ascender * scale), descent: r(-font.descender * scale), layer,
  };
  process.stdout.write(JSON.stringify(out) + '\n');
}

const dir = rest[0];
if (cmd === 'sync') sync(dir);
else if (cmd === 'check') check(dir);
else if (cmd === 'export') exportFilm(dir);
else if (cmd === 'text') await text(rest);
else die('사용법: node tools/lottie.mjs sync|check|export films/<이름>  ·  node tools/lottie.mjs text "문구" …');
