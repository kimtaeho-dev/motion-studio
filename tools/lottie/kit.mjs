/*
 * kit.mjs — Lottie JSON을 짧게 쓰는 조각. 필름의 build.mjs가 불러 쓴다(prompts/lottie.md, "build.mjs").
 *
 *   import { lottie, layer, group, ellipse, rect, path, fill, stroke, trim, tr, st, kf, slot, write } from '../../tools/lottie/kit.mjs';
 *
 *   st(v)                         정적 값 { a: 0, k: v }
 *   kf([[f, v, '이징'], …])        키프레임. 이징 = 아래 EASE 이름 또는 [x1, y1, x2, y2]. 마지막 키는 이징 없음
 *   slot(v, sid)                  슬롯을 참조하는 정적 값 (색이면 '#hex'도 받는다). 문서의 slots에도 넣는다
 *   layer(nm, shapes, { ip, op, ks, parent, ind })   셰이프 레이어(ty:4). ks는 { p, a, s, r, o } 중 바꿀 것만
 *   group(nm, items, trOpts)      그룹(gr) — 끝에 tr을 붙인다
 *   ellipse(size, pos) · rect(size, pos, r) · path(v, { i, o, c })   도형
 *   fill(color, opts) · stroke(color, width, opts) · trim(end, { s, o })   칠·선·트림
 *   lottie({ nm, w, h, fr, op, layers })   문서. slot()으로 만든 슬롯을 모아 넣는다
 *   write(doc, import.meta.url)    build.mjs 옆의 lottie.json에 쓴다
 *
 * 색은 '#RRGGBB' 또는 [r, g, b, a](0~1). 시간은 프레임.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hexToRgba } from '../../lib/lottie/bake.mjs';

/** prompts/lottie.md "움직임"의 곡선: [x1, y1, x2, y2] */
export const EASE = {
  'entrance-sharp': [0.2, 0.75, 0.34, 0.94],
  'travel-balanced': [0.65, 0, 0.35, 1],
  'settle-soft': [0, 0.65, 0.51, 0.99],
  'exit-accelerate': [1, 0.02, 0.54, 0.42],
  'travel-cut': [0.15, 0.85, 0.95, 0.05],
  'kinetic-ui': [0.85, 0.46, 0.14, 0.53],
  linear: [0, 0, 1, 1],
};

const color = (c) => (typeof c === 'string' ? hexToRgba(c) : c);
const arr = (v) => (Array.isArray(v) ? v : [v]);

export const st = (v) => ({ a: 0, k: v });

export function kf(keys) {
  return {
    a: 1,
    k: keys.map(([t, v, e = 'travel-balanced'], i) => {
      const s = arr(typeof v === 'string' ? color(v) : v);
      if (i === keys.length - 1) return { t, s };
      const curve = typeof e === 'string' ? EASE[e] : e;
      if (!curve) throw new Error(`모르는 이징: ${e} (${Object.keys(EASE).join(' · ')})`);
      const [x1, y1, x2, y2] = curve;
      const n = s.length;
      return { t, s, o: { x: Array(n).fill(x1), y: Array(n).fill(y1) }, i: { x: Array(n).fill(x2), y: Array(n).fill(y2) } };
    }),
  };
}

const slots = new Map();
export function slot(v, sid) {
  const k = typeof v === 'string' ? color(v) : v;
  slots.set(sid, { p: { a: 0, k } });
  return { a: 0, k, sid };
}

export function tr({ p = [0, 0], a = [0, 0], s = [100, 100], r = 0, o = 100 } = {}) {
  const w = (v) => (v && typeof v === 'object' && 'a' in v ? v : st(v));
  return { ty: 'tr', p: w(p), a: w(a), s: w(s), r: w(r), o: w(o), sk: st(0), sa: st(0) };
}

export const group = (nm, items, trOpts) => ({ ty: 'gr', nm, it: [...items, tr(trOpts)] });

const prop = (v) => (v && typeof v === 'object' && !Array.isArray(v) && 'a' in v ? v : st(v));
export const ellipse = (size, pos = [0, 0]) => ({ ty: 'el', nm: '원', p: prop(pos), s: prop(arr(size).length === 1 ? [size, size] : size) });
export const rect = (size, pos = [0, 0], r = 0) => ({ ty: 'rc', nm: '사각', p: prop(pos), s: prop(size), r: prop(r) });
export function path(v, { i, o, c = false, nm = '패스' } = {}) {
  const z = v.map(() => [0, 0]);
  return { ty: 'sh', nm, ks: st({ c, v, i: i || z, o: o || z }) };
}
export const fill = (c, { o = 100, nm = '칠', rule = 1 } = {}) => ({ ty: 'fl', nm, c: prop(typeof c === 'string' ? color(c) : c), o: prop(o), r: rule });
export const stroke = (c, width, { o = 100, cap = 'round', join = 'round', nm = '선' } = {}) => ({
  ty: 'st', nm, c: prop(typeof c === 'string' ? color(c) : c), o: prop(o), w: prop(width),
  lc: { butt: 1, round: 2, square: 3 }[cap], lj: { miter: 1, round: 2, bevel: 3 }[join], ml: 4,
});
export const trim = (end, { s = 0, o = 0, nm = '트림' } = {}) => ({ ty: 'tm', nm, s: prop(s), e: prop(end), o: prop(o), m: 1 });

export function layer(nm, shapes, { ip = 0, op, ks = {}, parent, ind } = {}) {
  const w = (v) => (v && typeof v === 'object' && 'a' in v ? v : st(v));
  const base = { o: 100, r: 0, p: [0, 0, 0], a: [0, 0, 0], s: [100, 100, 100], ...ks };
  return {
    ddd: 0, ...(ind != null && { ind }), ...(parent != null && { parent }), ty: 4, nm, sr: 1, ip, op, st: 0, bm: 0,
    ks: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, w(v)])),
    shapes,
  };
}

export function lottie({ nm, w, h, fr = 60, op, layers }) {
  // 레이어 op를 안 줬으면 문서 끝까지. ind는 순서대로
  const L = layers.map((l, i) => ({ ind: i + 1, ...l, op: l.op ?? op }));
  return { v: '5.12.0', nm, fr, ip: 0, op, w, h, ddd: 0, assets: [], ...(slots.size && { slots: Object.fromEntries(slots) }), layers: L };
}

export function write(doc, metaUrl) {
  const file = join(dirname(fileURLToPath(metaUrl)), 'lottie.json');
  writeFileSync(file, JSON.stringify(doc, null, 1) + '\n');
  console.log(`lottie.json ← build.mjs (${doc.w}x${doc.h} · ${doc.op}f)`);
}
