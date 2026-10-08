/*
 * bake.mjs — Lottie 슬롯 읽기·굽기. 브라우저(parity.js)와 Node(tools/lottie.mjs)가 같이 쓴다. DOM 없음.
 *
 *   slotsOf(doc)            → { sid: { type: 'color'|'number'|'text'|'vec2', value, animated } }
 *   bake(doc, values)       → values({ sid: 값 })를 슬롯 기본값과 묶인 글자 레이어에 써 넣은 사본
 *   hexToRgba('#2F6BFF')    → [r, g, b, a] (0~1)    · rgbaToHex([r, g, b])
 */

export function hexToRgba(hex) {
  const h = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex).trim());
  if (!h) return null;
  const n = parseInt(h[1], 16);
  const round = (v) => Math.round(v * 10000) / 10000;
  return [round(((n >> 16) & 255) / 255), round(((n >> 8) & 255) / 255), round((n & 255) / 255), h[2] ? round(parseInt(h[2], 16) / 255) : 1];
}

export function rgbaToHex(c) {
  return '#' + c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// 이 sid를 참조하는 속성이 어떤 종류인지 (색 c · 글자 문서 t.d · 그 밖은 숫자/벡터)
function usages(doc) {
  const out = {};
  const walk = (node, key) => {
    if (Array.isArray(node)) { for (const v of node) walk(v, key); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.sid === 'string') (out[node.sid] = out[node.sid] || []).push({ key });
    for (const [k, v] of Object.entries(node)) if (k !== 'slots') walk(v, k);
  };
  walk(doc, null);
  return out;
}

const textOf = (k) => (Array.isArray(k) && k[0] && k[0].s && typeof k[0].s.t === 'string' ? k[0].s.t : undefined);

export function slotsOf(doc) {
  const used = usages(doc);
  const out = {};
  for (const [sid, slot] of Object.entries(doc.slots || {})) {
    const p = (slot && slot.p) || {};
    const k = p.k;
    const keys = (used[sid] || []).map((u) => u.key);
    const animated = p.a === 1;
    let type, value;
    if (textOf(k) !== undefined || keys.includes('d')) {
      type = 'text'; value = textOf(k) ?? '';
    } else if (keys.includes('c') || (Array.isArray(k) && (k.length === 3 || k.length === 4) && k.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && !keys.some((x) => ['p', 's', 'a'].includes(x)))) {
      type = 'color'; value = Array.isArray(k) && typeof k[0] === 'number' ? rgbaToHex(k) : null;
    } else if (typeof k === 'number') {
      type = 'number'; value = k;
    } else {
      type = 'vec2'; value = k;
    }
    out[sid] = { type, value, animated };
  }
  return out;
}

// 슬롯을 참조하는 속성들 (sid → [속성 객체])
function users(doc) {
  const out = {};
  const walk = (node) => {
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.sid === 'string') (out[node.sid] = out[node.sid] || []).push(node);
    for (const [k, v] of Object.entries(node)) if (k !== 'slots') walk(v);
  };
  walk(doc);
  return out;
}

export function bake(doc, values = {}) {
  const copy = JSON.parse(JSON.stringify(doc));
  const slots = slotsOf(copy);
  const refs = users(copy);
  // 슬롯을 모르는 플레이어(오래된 lottie-ios·Android 등)도 같은 값을 그리도록 참조하는 속성의 k에도 쓴다
  const inline = (sid, k) => { for (const prop of refs[sid] || []) if (prop.a !== 1 && 'k' in prop) prop.k = k; };
  for (const [sid, v] of Object.entries(values)) {
    const s = slots[sid];
    if (!s || s.animated) continue;
    const p = copy.slots[sid].p;
    if (s.type === 'color') { const c = hexToRgba(v); if (c) { p.k = c; inline(sid, c); } }
    else if (s.type === 'number' && Number.isFinite(+v)) { p.k = +v; inline(sid, +v); }
    else if (s.type === 'text') {
      if (Array.isArray(p.k) && p.k[0] && p.k[0].s) p.k[0].s.t = String(v);
      for (const l of copy.layers || []) {
        const d = l.ty === 5 && l.t && l.t.d;
        if (d && d.sid === sid && Array.isArray(d.k) && d.k[0] && d.k[0].s) d.k[0].s.t = String(v);
      }
    }
  }
  return copy;
}
