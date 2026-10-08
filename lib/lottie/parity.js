/*
 * parity.js — Lottie 필름을 Skottie(미리보기·렌더)와 lottie-web 5 SVG(개발자가 웹에서 쓰는 플레이어)로 같은 프레임을 그려 비교한다.
 * render-worker가 `--parity`로 필름 페이지 안에서 부른다: (await import('…/lottie/parity.js')).check({ params })
 *
 * 차이 = 두 그림 중 하나라도 칠해진 픽셀 가운데, 색(알파 곱한 값)이 크게 다른 픽셀의 비율.
 * 경계선 안티앨리어싱은 렌더러마다 조금씩 달라서 0이 되지 않는다. 통과 기준은 PASS_PCT.
 */
import { bake } from './bake.mjs';

const PASS_PCT = 2;      // 프레임마다 내용 영역의 2% 미만
const TOLERANCE = 48;    // 채널 차이(0~255)가 이보다 크면 다른 픽셀
const SAMPLES = 9;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.lottie) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('lottie-web을 읽지 못했습니다'));
    document.head.appendChild(s);
  });
}

async function toDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}

function checker(g, x, y, w, h) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#e9e9e9'; g.fillRect(x, y, w, h); g.fillStyle = '#d4d4d4';
  const s = 16;
  for (let j = 0; j * s < h; j++) for (let i = (j % 2); i * s < w; i += 2) g.fillRect(x + i * s, y + j * s, s, s);
  g.restore();
}

export async function check({ params = {} } = {}) {
  const lot = window.LOTTIE;
  if (!lot) throw new Error('Lottie 필름이 아닙니다 (Stage.lottieFilm으로 연 필름만 비교한다)');
  await loadScript(new URL('lottie_svg.min.js', import.meta.url).href);

  const values = Object.fromEntries(Object.entries(params).map(([k, p]) => [k, p.value]));
  const doc = bake(lot.doc, values);
  // lottie-web SVG를 이미지로 옮겨 그리려면 이미지 에셋이 SVG 안에 들어 있어야 한다
  for (const a of doc.assets || []) {
    if (!a.p || a.e || String(a.p).startsWith('data:')) continue;
    a.p = await toDataUrl(new URL((a.u || '') + a.p, lot.url).href); a.u = ''; a.e = 1;
  }
  const { w, h } = lot;
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none`;
  document.body.appendChild(host);
  const anim = window.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: doc });
  await new Promise((resolve) => { if (anim.isLoaded) resolve(); else anim.addEventListener('DOMLoaded', resolve); });

  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const a = mk(), b = mk(), ga = a.getContext('2d', { willReadFrequently: true }), gb = b.getContext('2d', { willReadFrequently: true });
  const results = [];
  const shots = [];
  const n = Math.min(SAMPLES, lot.frames);
  for (let i = 0; i < n; i++) {
    const frame = Math.round((i * (lot.frames - 1)) / Math.max(1, n - 1));
    ga.clearRect(0, 0, w, h);
    lot.draw(ga, 0, 0, { frame, width: w, anchor: [0, 0], slots: values });
    anim.goToAndStop(frame, true);
    const svg = host.querySelector('svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    gb.clearRect(0, 0, w, h);
    gb.drawImage(img, 0, 0, w, h);

    const da = ga.getImageData(0, 0, w, h).data, db = gb.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    let content = 0, bad = 0;
    for (let p = 0, q = 0; p < da.length; p += 4, q++) {
      const aa = da[p + 3], ab = db[p + 3];
      if (aa < 8 && ab < 8) continue;
      content++;
      let d = Math.abs(aa - ab);
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((da[p + c] * aa - db[p + c] * ab) / 255));
      if (d > TOLERANCE) { bad++; mask[q] = 1; }
    }
    const pct = content ? (100 * bad) / content : 0;
    results.push({ frame, t: +(frame / lot.fps).toFixed(3), pct: +pct.toFixed(2) });
    shots.push({ frame, pct, a: ga.getImageData(0, 0, w, h), b: gb.getImageData(0, 0, w, h), mask });
  }
  anim.destroy(); host.remove();

  // 차이가 큰 프레임 3장: Skottie | lottie-web | 다른 곳(빨강)
  const worst = [...shots].sort((x, y) => y.pct - x.pct).slice(0, 3).sort((x, y) => x.frame - y.frame);
  const cell = Math.min(360, w), k = cell / w, ch = Math.round(h * k), pad = 16, head = 40, lab = 28;
  const sheet = document.createElement('canvas');
  sheet.width = pad + 3 * (cell + pad); sheet.height = head + worst.length * (ch + lab + pad) + pad;
  const g = sheet.getContext('2d');
  g.fillStyle = '#141414'; g.fillRect(0, 0, sheet.width, sheet.height);
  g.fillStyle = '#eee'; g.font = '600 15px Geist, sans-serif';
  ['Skottie (미리보기·렌더)', 'lottie-web 5 SVG (웹 플레이어)', '다른 곳 (빨강)'].forEach((label, col) => g.fillText(label, pad + col * (cell + pad), 26));
  const tmp = mk(), gt = tmp.getContext('2d');
  worst.forEach((s, row) => {
    const y = head + row * (ch + lab + pad);
    g.fillStyle = '#aaa'; g.font = '500 13px "Geist Mono", monospace';
    g.fillText(`f${s.frame} · ${(s.frame / lot.fps).toFixed(2)}s · 차이 ${s.pct.toFixed(2)}%`, pad, y + 16);
    const top = y + lab;
    [s.a, s.b].forEach((data, col) => {
      const x = pad + col * (cell + pad);
      checker(g, x, top, cell, ch);
      gt.putImageData(data, 0, 0);
      g.drawImage(tmp, x, top, cell, ch);
    });
    const x = pad + 2 * (cell + pad);
    const diff = new ImageData(w, h);
    for (let q = 0; q < s.mask.length; q++) {
      const p = q * 4, al = s.a.data[p + 3] / 255;
      const base = 30 + 60 * al;
      diff.data[p] = s.mask[q] ? 255 : base; diff.data[p + 1] = s.mask[q] ? 40 : base; diff.data[p + 2] = s.mask[q] ? 40 : base; diff.data[p + 3] = 255;
    }
    gt.putImageData(diff, 0, 0);
    g.drawImage(tmp, x, top, cell, ch);
  });

  const max = Math.max(0, ...results.map((r) => r.pct));
  return { pass: max < PASS_PCT, passPct: PASS_PCT, max: +max.toFixed(2), frames: results, images: { parity: sheet.toDataURL('image/png') } };
}
