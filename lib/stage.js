/*
 * stage.js — 필름 한 편의 "무대": film.json 로딩, 캔버스, 포맷, 폰트, 미리보기 UI, 렌더 계약.
 *
 * 필름 = films/<이름>/index.html + films/<이름>/film.json
 *
 *   film.json (데이터 — 앱의 속성 패널·타임라인이 이 파일만 고친다)
 *     { "title": "샘플", "dur": 12, "bpm": 120, "beatOffset": 0, "fps": 60,
 *       "formats": { "1x1": [1080, 1080], "9x16": [1080, 1920] },
 *       "transparent": false,                                   // true면 배경을 칠하지 않는다 (알파 보존)
 *       "params":   { "accent": { "type": "color", "value": "#2F6BFF", "label": "포인트 컬러" } },   // text | color | number
 *       "timeline": { "check":  { "t": 2.5, "label": "체크로 모핑" } }                           // 이름 붙은 시각(초)
 *     }
 *
 *   index.html (코드 — 에이전트가 쓴다)
 *     Stage.film((film) => {
 *       // film = { title, dur, bpm, beatOffset, fps, transparent, P: { accent: '#2F6BFF' }, T: { check: 2.5 },
 *       //          W, H, format, portrait, landscape }   ← 포맷을 미리 알아야 할 때 (물리는 포맷별 배치로 굽는다)
 *       // 여기서 film으로부터 상수·표를 만든다 (film.json이 바뀌면 이 함수가 다시 불린다)
 *       return {
 *         draw(g, t, S) { ... },       // S = { W, H, format, unit, cx, cy, portrait, landscape, transparent, ... }
 *       };
 *     });
 *
 *   3D(기기 목업·모델·입체 글자)는 lib/stage3d.js — 그 파일 맨 위 주석 참고.
 *
 * 렌더 계약 (tools/render.mjs 가 의존):
 *   window.seek(t)     → t초 프레임을 그린다. 같은 t면 항상 같은 그림.
 *   window.FILM        → { title, dur, bpm, beatOffset, fps, W, H, format, formats, transparent }
 *   window.READY       → film.json + 폰트 로딩 끝나면 true
 *   window.LOAD_ERROR  → film.json을 읽지 못했거나 형식이 틀리면 오류 문구
 *   Stage.reload(json) → film.json 내용을 바꿔 다시 적용 (앱이 편집 직후 부른다)
 *   postMessage({ type: 'motion:film-json', json }) 도 같은 일을 한다 (앱의 iframe 미리보기용)
 *
 * 필름은 http(s)로 열어야 한다 (file://에서는 film.json을 읽을 수 없다). npm run preview / render.mjs가 서버를 띄운다.
 *
 * 앱 플레이어 (?embed=1): 재생 바·재생 루프 없이 캔버스만 창에 맞춘다. 시각은 앱이 window.seek(t)로 정한다.
 *
 * 미리보기 (일반 브라우저로 열었을 때만):
 *   Space 재생/정지 · ←/→ 1프레임 · Shift+←/→ 1비트 · Home 처음 · 스크러버 드래그
 *   ?format=9x16 · ?t=3.5 (해당 시각에서 정지) · ?grid=1 (비트 그리드 표시)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(location.search);
  const RENDER = navigator.webdriver || q.get('render') === '1';
  const EMBED = !RENDER && q.get('embed') === '1';

  // 필름 스크립트가 로딩 중에 죽으면 (문법 오류, 없는 변수 등) 렌더러가 READY를 기다리지 않고 바로 알 수 있게
  addEventListener('error', (e) => {
    if (!window.READY && !window.LOAD_ERROR) window.LOAD_ERROR = `필름 스크립트 오류: ${e.message} (${(e.filename || '').split('?')[0].split('/').pop()}:${e.lineno})`;
  });

  // 폰트는 레포에 포함된 파일만 쓴다 (기기마다 결과가 달라지지 않도록)
  const FONT_BASE = (document.currentScript && document.currentScript.src.replace(/lib\/stage\.js.*$/, '')) || '../../';
  const FONTS = [
    ['Pretendard', 'Pretendard-Regular', 400], ['Pretendard', 'Pretendard-Medium', 500],
    ['Pretendard', 'Pretendard-SemiBold', 600], ['Pretendard', 'Pretendard-Bold', 700],
    ['Geist', 'Geist-Regular', 400], ['Geist', 'Geist-Medium', 500],
    ['Geist', 'Geist-SemiBold', 600], ['Geist', 'Geist-Bold', 700],
    ['Geist Mono', 'GeistMono-Regular', 400],
  ];
  async function loadFonts() {
    await Promise.all(FONTS.map(async ([family, file, weight]) => {
      const f = new FontFace(family, `url(${FONT_BASE}assets/fonts/${file}.woff2)`, { weight: String(weight) });
      try { document.fonts.add(await f.load()); } catch (e) { console.warn('[stage] font', file, e); }
    }));
  }

  /* ── film.json 검사 → F ─────────────────────────────────────────── */
  const PARAM_TYPES = ['text', 'color', 'number'];
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  function parseFilm(json) {
    const errs = [];
    if (!isObj(json)) throw new Error('film.json이 객체가 아닙니다');
    if (!isNum(json.dur) || json.dur <= 0) errs.push('dur: 0보다 큰 숫자(초)여야 합니다');
    for (const k of ['bpm', 'beatOffset', 'fps']) if (json[k] !== undefined && !isNum(json[k])) errs.push(`${k}: 숫자여야 합니다`);
    const formats = json.formats === undefined ? { '1x1': [1080, 1080] } : json.formats;
    if (!isObj(formats) || !Object.keys(formats).length) errs.push('formats: { "1x1": [1080, 1080] } 형태여야 합니다');
    else for (const [k, v] of Object.entries(formats))
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n > 0)) errs.push(`formats.${k}: [가로, 세로] 정수 쌍이어야 합니다`);

    const P = {};
    for (const [k, p] of Object.entries(json.params || {})) {
      if (!isObj(p) || !PARAM_TYPES.includes(p.type)) { errs.push(`params.${k}.type: ${PARAM_TYPES.join(' | ')} 중 하나여야 합니다`); continue; }
      if (p.type === 'number' ? !isNum(p.value) : typeof p.value !== 'string') errs.push(`params.${k}.value: ${p.type === 'number' ? '숫자' : '문자열'}여야 합니다`);
      if (p.type === 'color' && typeof p.value === 'string' && !/^#[0-9a-fA-F]{6}$/.test(p.value)) errs.push(`params.${k}.value: #RRGGBB 색이어야 합니다`);
      P[k] = p.value;
    }
    const T = {};
    for (const [k, e] of Object.entries(json.timeline || {})) {
      if (!isObj(e) || !isNum(e.t)) { errs.push(`timeline.${k}.t: 숫자(초)여야 합니다`); continue; }
      T[k] = e.t;
    }
    // cues(효과음)는 더 이상 쓰지 않는다. 예전 film.json에 남아 있어도 오류 없이 무시한다.
    if (errs.length) throw new Error('film.json 형식 오류\n  - ' + errs.join('\n  - '));

    return {
      title: json.title || document.title, dur: json.dur, bpm: json.bpm || 120, beatOffset: json.beatOffset || 0,
      fps: json.fps || 60, formats, transparent: !!json.transparent, P, T,
    };
  }

  function film(factory) {
    if (typeof factory !== 'function') {
      throw new Error('[stage] Stage.film((F) => ({ draw(g, t, S) {} })) 형태로 부른다. dur·bpm·formats 같은 데이터는 film.json에 둔다.');
    }
    // <head> 안에서 불려도 동작하도록 body가 생긴 뒤 시작
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => film(factory)); return; }

    const fail = (err) => {
      const msg = String(err && err.message || err);
      window.LOAD_ERROR = msg;
      console.error('[stage] ' + msg);
      if (!RENDER && !EMBED) {
        const pre = document.createElement('pre');
        pre.style.cssText = 'margin:40px;color:#ff8a7a;font:14px/1.6 "Geist Mono",monospace;white-space:pre-wrap';
        pre.textContent = msg;
        document.body.appendChild(pre);
      }
    };

    const json = fetch(new URL('film.json', location.href), { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`film.json을 읽지 못했습니다 (${r.status}). 필름 폴더에 film.json이 있어야 합니다.`);
      return r.json();
    });
    Promise.all([json, loadFonts()]).then(([j]) => start(factory, j)).catch(fail);
  }

  function start(factory, json) {
    let F = parseFilm(json);
    const formats = F.formats;
    const format = q.get('format') && formats[q.get('format')] ? q.get('format') : Object.keys(formats)[0];
    const [W, H] = formats[format];

    document.documentElement.style.cssText = 'margin:0;height:100%';
    const bodyBg = RENDER ? (F.transparent ? 'transparent' : '#000') : EMBED ? 'transparent' : '#1b1b1a';
    document.body.style.cssText = `margin:0;min-height:100%;background:${bodyBg};${EMBED ? 'overflow:hidden;' : ''}` +
      'font-family:Geist,Pretendard,system-ui,sans-serif;color:#ddd';

    const canvas = document.createElement('canvas');
    canvas.id = 'c'; canvas.width = W; canvas.height = H;
    canvas.style.display = 'block';
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');

    // 레이아웃 단위: 짧은 변 기준 1080 = 1000u. 포맷이 바뀌어도 같은 비율로 보이게.
    const unit = Math.min(W, H) / 1080;
    const S = { W, H, format, unit, cx: W / 2, cy: H / 2, portrait: H > W, landscape: W > H };

    let made, current = 0;
    function apply(nextF) {
      for (const fn of Stage.hooks.beforeApply) fn();   // stage3d: 이전 장면의 GPU 자원 정리
      const m = factory({ title: nextF.title, dur: nextF.dur, bpm: nextF.bpm, beatOffset: nextF.beatOffset, fps: nextF.fps,
        transparent: nextF.transparent, P: { ...nextF.P }, T: { ...nextF.T },
        W, H, format, portrait: H > W, landscape: W > H });
      if (!m || typeof m.draw !== 'function') throw new Error('Stage.film의 함수는 { draw(g, t, S) } 를 돌려줘야 합니다');
      F = nextF; made = m;
      Object.assign(S, { dur: F.dur, bpm: F.bpm, transparent: F.transparent });
      window.FILM = { title: F.title, dur: F.dur, bpm: F.bpm, beatOffset: F.beatOffset, fps: F.fps, W, H, format,
        formats: Object.keys(formats), transparent: F.transparent };
    }
    apply(F);

    window.seek = (t) => {
      current = t;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.filter = 'none'; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      if (F.transparent) g.clearRect(0, 0, W, H);
      made.draw(g, t, S);
      g.restore();
      if (showGrid) drawGrid(t);
      return true;
    };

    // 앱이 film.json을 고친 뒤 부른다. 포맷 크기는 페이지를 다시 열어야 바뀐다.
    let onReload = () => {};
    Stage.reload = (nextJson) => {
      try {
        apply(parseFilm(nextJson));
        delete window.LOAD_ERROR;
      } catch (e) {
        window.LOAD_ERROR = String(e.message || e);
        console.error('[stage] ' + window.LOAD_ERROR);
        return false;
      }
      onReload();
      window.seek(current);
      // 백그라운드 작업(물리 굽기 등)이 끝나면 지금 시각을 다시 그린다. 그 전엔 이전 결과가 보인다
      const wait = Stage.hooks.pending.splice(0);
      if (wait.length) Promise.all(wait).then(() => window.seek(current), (e) => console.error('[stage] ' + (e.message || e)));
      return true;
    };
    addEventListener('message', (e) => {
      if (e.data && e.data.type === 'motion:film-json') Stage.reload(e.data.json);
    });

    let showGrid = q.get('grid') === '1' && !RENDER;
    function drawGrid(t) {
      const bpm = F.bpm, b = (t - F.beatOffset) * bpm / 60;
      g.save(); g.font = `500 ${22 * unit}px "Geist Mono"`; g.fillStyle = 'rgba(255,0,80,.85)';
      g.fillText(`t ${t.toFixed(2)}s  beat ${Math.floor(b)}  bar ${Math.floor(b / 4)}.${Math.floor(b) % 4}`, 24 * unit, H - 24 * unit);
      g.restore();
    }

    // 처음 열 때는 백그라운드 작업(물리 굽기 등)이 끝나야 준비 완료 — 렌더·검사가 덜 구운 장면을 찍지 않게
    const ready = () => {
      window.READY = true;
      if (EMBED) embed();
      else if (!RENDER) preview();
      else window.seek(0);
    };
    const wait = Stage.hooks.pending.splice(0);
    if (wait.length) Promise.all(wait).then(ready, (e) => { window.LOAD_ERROR = '물리 굽기 실패: ' + (e.message || e); console.error('[stage] ' + window.LOAD_ERROR); });
    else ready();

    /* ── 앱 플레이어 ─────────────────────────────────────────────────── */
    function embed() {
      function fit() {
        const s = Math.min(innerWidth / W, innerHeight / H);
        canvas.style.cssText = `display:block;position:absolute;width:${W * s}px;height:${H * s}px;` +
          `left:${(innerWidth - W * s) / 2}px;top:${(innerHeight - H * s) / 2}px`;
      }
      addEventListener('resize', fit); fit();
      window.seek(Number(q.get('t')) || 0);
    }

    /* ── 미리보기 UI ─────────────────────────────────────────────────── */
    function preview() {
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:10px 16px;background:#111;' +
        'display:flex;gap:12px;align-items:center;font:500 13px Geist,Pretendard,sans-serif;z-index:2';
      bar.innerHTML = `
        <button id="pp" style="all:unset;cursor:pointer;width:28px;text-align:center;font-size:16px">⏸</button>
        <div id="tl" style="position:relative;flex:1;height:28px;cursor:pointer"></div>
        <span id="tc" style="font-family:'Geist Mono';min-width:150px;text-align:right"></span>
        <select id="fm" style="background:#222;color:#ddd;border:1px solid #333;border-radius:6px;padding:3px">
          ${Object.keys(formats).map((f) => `<option ${f === format ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
        <label style="display:flex;gap:4px;align-items:center"><input id="gr" type="checkbox" ${showGrid ? 'checked' : ''}>grid</label>`;
      document.body.appendChild(bar);

      const tl = bar.querySelector('#tl'), tc = bar.querySelector('#tc'), pp = bar.querySelector('#pp');
      let ph;
      // 비트 눈금 (film.json이 바뀌면 다시 그린다)
      function ticks() {
        const dur = F.dur, bpm = F.bpm, off = F.beatOffset;
        const nb = Math.floor((dur - off) * bpm / 60);
        let html = '<div style="position:absolute;left:0;right:0;top:13px;height:2px;background:#333"></div>';
        for (let i = 0; i <= nb; i++) {
          const x = ((off + i * 60 / bpm) / dur) * 100, big = i % 4 === 0;
          html += `<div style="position:absolute;left:${x}%;top:${big ? 4 : 9}px;width:1px;height:${big ? 20 : 10}px;background:${big ? '#666' : '#3a3a3a'}"></div>`;
        }
        tl.innerHTML = html + '<div id="ph" style="position:absolute;top:0;width:2px;height:28px;background:#fff"></div>';
        ph = tl.querySelector('#ph');
      }
      ticks();
      onReload = ticks;

      function fit() {
        const aw = innerWidth - 32, ah = innerHeight - 64, s = Math.min(aw / W, ah / H);
        canvas.style.cssText = `display:block;width:${W * s}px;height:${H * s}px;margin:${(ah - H * s) / 2 + 8}px auto 0;border-radius:6px`;
      }
      addEventListener('resize', fit); fit();

      let playing = !q.get('t'), t0 = performance.now(), base = q.get('t') ? Number(q.get('t')) : 0;
      const now = () => (playing ? (base + (performance.now() - t0) / 1000) % F.dur : base);
      const setT = (t) => { base = ((t % F.dur) + F.dur) % F.dur; t0 = performance.now(); };
      const toggle = () => { setT(now()); playing = !playing; t0 = performance.now(); pp.textContent = playing ? '⏸' : '▶'; };
      pp.onclick = toggle;
      pp.textContent = playing ? '⏸' : '▶';

      let drag = false;
      const scrub = (e) => { const r = tl.getBoundingClientRect(); setT(((e.clientX - r.left) / r.width) * F.dur); };
      tl.onpointerdown = (e) => { drag = true; if (playing) toggle(); scrub(e); tl.setPointerCapture(e.pointerId); };
      tl.onpointermove = (e) => drag && scrub(e);
      tl.onpointerup = () => (drag = false);
      bar.querySelector('#fm').onchange = (e) => { q.set('format', e.target.value); location.search = q.toString(); };
      bar.querySelector('#gr').onchange = (e) => (showGrid = e.target.checked);

      addEventListener('keydown', (e) => {
        if (e.code === 'Space') { e.preventDefault(); toggle(); }
        if (e.code === 'Home') setT(0);
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          if (playing) toggle();
          const dir = e.code === 'ArrowLeft' ? -1 : 1;
          if (e.shiftKey) {
            const b = 60 / F.bpm, cur = Math.round((now() - F.beatOffset) / b);
            setT(F.beatOffset + (cur + dir) * b);
          } else setT(now() + dir / F.fps);
        }
      });

      (function loop() {
        const t = now();
        window.seek(t);
        ph.style.left = `${(t / F.dur) * 100}%`;
        const b = (t - F.beatOffset) * F.bpm / 60;
        tc.textContent = `${t.toFixed(2)}s · beat ${Math.max(0, Math.floor(b))} · f${Math.round(t * F.fps)}`;
        requestAnimationFrame(loop);
      })();
    }
  }

  /* ── 그리기 도우미 ───────────────────────────────────────────────── */
  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.roundRect(x, y, w, h, r);
  }
  // 커서 (화살표). down: 0~1 (눌림)
  function cursor(g, x, y, scale = 1, down = 0) {
    g.save(); g.translate(x, y); g.scale(scale * (1 - 0.12 * down), scale * (1 - 0.12 * down));
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(0, 34); g.lineTo(8.5, 26); g.lineTo(14.5, 39.5); g.lineTo(20, 37);
    g.lineTo(14, 24); g.lineTo(25, 24); g.closePath();
    g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
    g.fillStyle = '#111'; g.fill();
    g.shadowColor = 'transparent'; g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
  // 텍스트를 블러/알파와 함께 (교체 애니메이션용)
  function text(g, str, x, y, { font, color = '#111', align = 'center', base = 'middle', alpha = 1, blur = 0, dy = 0 } = {}) {
    if (alpha <= 0.001) return;
    g.save(); g.globalAlpha *= alpha; if (blur > 0.05) g.filter = `blur(${blur}px)`;
    g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
    g.fillText(str, x, y + dy); g.restore();
  }
  // 레이어: alpha/blur 를 묶어서 적용
  function layer(g, alpha, blur, fn) {
    if (alpha <= 0.001) return;
    g.save(); g.globalAlpha *= alpha; if (blur > 0.05) g.filter = `blur(${blur}px)`; fn(); g.restore();
  }

  /* ── SVG 에셋 ─────────────────────────────────────────────────────
   * 디자이너가 준 SVG(로고·아이콘·일러스트)를 벡터 그대로, 도형마다 따로 움직일 수 있게 그린다.
   *   const logo = await Stage.svg('refs/logo.svg');      // Stage.film 밖에서 한 번 (module 스크립트)
   *   logo.draw(g, x, y, { width, anchor, alpha, fill, recolor, only, part: (p, i) => ({ trace, fill, alpha, dx, dy, scale, rotate }) })
   * 지원: path·rect·circle·ellipse·line·polyline·polygon, g·use, transform, fill/stroke(단색·linear/radialGradient),
   * opacity, fill-rule, 선 끝·이음. 무시(경고): text(아웃라인으로 받는다), image, clipPath·mask·filter, gradientTransform.
   */
  const SVG_SHAPES = 'path,rect,circle,ellipse,line,polyline,polygon';
  const SKIP_ANCESTORS = 'defs,clipPath,mask,symbol,pattern,marker';
  const svgCache = new Map();

  function hex(color) {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color || '');
    if (m) return '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('');
    const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((color || '').trim());
    if (!h) return null;
    const s = h[1].length === 3 ? h[1].replace(/./g, '$&$&') : h[1];
    return '#' + s.toLowerCase();
  }
  function rgbaAlpha(color) {
    const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(color || '');
    return m ? +m[1] : 1;
  }
  function shapeD(el) {
    const n = (a, d = 0) => { const v = parseFloat(el.getAttribute(a)); return Number.isFinite(v) ? v : d; };
    switch (el.localName) {
      case 'path': return el.getAttribute('d') || '';
      case 'rect': {
        const x = n('x'), y = n('y'), w = n('width'), h = n('height');
        let rx = el.hasAttribute('rx') ? n('rx') : n('ry'), ry = el.hasAttribute('ry') ? n('ry') : rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
        return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
          `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
      }
      case 'circle': case 'ellipse': {
        const cx = n('cx'), cy = n('cy');
        const rx = el.localName === 'circle' ? n('r') : n('rx'), ry = el.localName === 'circle' ? n('r') : n('ry');
        return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
      }
      case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
      case 'polyline': case 'polygon': {
        const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        let d = '';
        for (let i = 0; i + 1 < pts.length; i += 2) d += (i ? 'L' : 'M') + pts[i] + ' ' + pts[i + 1];
        return el.localName === 'polygon' ? d + 'Z' : d;
      }
    }
    return '';
  }

  // url(#id) → { type, stops, coords, units } (그라데이션의 href 상속까지)
  function readGradient(doc, ref, warn) {
    const id = /url\(["']?#([^"')]+)/.exec(ref || '');
    const el = id && doc.getElementById(id[1]);
    if (!el || !/^(linear|radial)Gradient$/.test(el.localName)) return null;
    const chain = [];
    for (let e = el; e && chain.length < 8; ) {
      chain.push(e);
      const href = e.getAttribute('href') || e.getAttribute('xlink:href');
      e = href && href.startsWith('#') ? doc.getElementById(href.slice(1)) : null;
    }
    const attr = (a) => { for (const e of chain) if (e.hasAttribute(a)) return e.getAttribute(a); return null; };
    if (attr('gradientTransform')) warn('gradientTransform은 무시합니다');
    const stopsOwner = chain.find((e) => e.querySelector('stop'));
    const stops = stopsOwner ? [...stopsOwner.querySelectorAll('stop')].map((s) => {
      const cs = getComputedStyle(s);
      const off = s.getAttribute('offset') || '0';
      return { offset: Math.min(1, Math.max(0, off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0)),
        color: hex(cs.stopColor) || '#000000', alpha: (parseFloat(cs.stopOpacity) || 0) * rgbaAlpha(cs.stopColor) };
    }) : [];
    const units = attr('gradientUnits') === 'userSpaceOnUse' ? 'user' : 'bbox';
    const num = (a, d) => { const v = attr(a); if (v == null) return d; return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v); };
    if (el.localName === 'linearGradient') {
      return { type: 'linear', units, stops, x1: num('x1', 0), y1: num('y1', 0), x2: num('x2', 1), y2: num('y2', 0) };
    }
    const cx = num('cx', 0.5), cy = num('cy', 0.5);
    return { type: 'radial', units, stops, cx, cy, r: num('r', 0.5), fx: num('fx', cx), fy: num('fy', cy) };
  }

  function readPaint(doc, value, opacity, warn) {
    if (!value || value === 'none') return null;
    if (value.startsWith('url(')) {
      const grad = readGradient(doc, value, warn);
      if (!grad) { warn(`지원하지 않는 칠: ${value}`); return null; }
      return { grad, alpha: opacity };
    }
    const c = hex(value);
    return c ? { color: c, alpha: opacity * rgbaAlpha(value) } : null;
  }

  async function svg(url) {
    const key = new URL(url, location.href).href;
    if (!svgCache.has(key)) svgCache.set(key, loadSvg(url, key));
    return svgCache.get(key);
  }

  async function loadSvg(url, key) {
    const res = await fetch(key, { cache: 'no-store' });
    if (!res.ok) throw new Error(`[stage] SVG를 읽지 못했습니다: ${url} (${res.status})`);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const root = doc.documentElement;
    if (root.localName !== 'svg') throw new Error(`[stage] SVG가 아닙니다: ${url}`);
    const warnings = new Set();
    const warn = (m) => warnings.add(m);

    // 문서에 붙이기 전에 실행될 수 있는 것을 걷어낸다
    root.querySelectorAll('script,foreignObject').forEach((e) => e.remove());
    for (const e of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...e.attributes]) if (/^on/i.test(a.name)) e.removeAttribute(a.name);
    }
    // <use> → 참조한 요소의 복사본 (스타일·변환을 실제 요소처럼 계산하려고)
    for (let pass = 0; pass < 4; pass++) {
      const uses = root.querySelectorAll('use');
      if (!uses.length) break;
      for (const u of uses) {
        const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
        const src = href.startsWith('#') && doc.getElementById(href.slice(1));
        const gEl = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        for (const a of [...u.attributes]) if (!/^(x|y|width|height|href|xlink:href)$/.test(a.name)) gEl.setAttribute(a.name, a.value);
        const tx = parseFloat(u.getAttribute('x')) || 0, ty = parseFloat(u.getAttribute('y')) || 0;
        gEl.setAttribute('transform', `${u.getAttribute('transform') || ''} translate(${tx} ${ty})`);
        if (src) {
          const clone = src.localName === 'symbol' ? doc.createElementNS('http://www.w3.org/2000/svg', 'g') : src.cloneNode(true);
          if (src.localName === 'symbol') for (const c of src.childNodes) clone.appendChild(c.cloneNode(true));
          clone.removeAttribute('id');
          clone.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
          gEl.appendChild(clone);
        }
        u.replaceWith(gEl);
      }
    }

    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const hasVB = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
    const w = hasVB ? vb[2] : parseFloat(root.getAttribute('width')) || 0;
    const h = hasVB ? vb[3] : parseFloat(root.getAttribute('height')) || 0;
    if (!(w > 0 && h > 0)) throw new Error(`[stage] SVG 크기를 알 수 없습니다 (viewBox나 width/height가 필요): ${url}`);

    // 문서에 잠깐 붙여서 브라우저가 계산한 스타일·변환·길이를 읽는다 (1 SVG 단위 = 1px이 되도록)
    root.setAttribute('width', w); root.setAttribute('height', h);
    root.setAttribute('preserveAspectRatio', 'none');
    const host = document.createElement('div');
    // visibility:hidden은 도형에 상속돼 '숨은 도형'과 구분이 안 되므로 화면 밖 + 투명으로 숨긴다
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
    const live = document.importNode(root, true);
    host.appendChild(live);
    (document.body || document.documentElement).appendChild(host);

    const ldoc = { getElementById: (id) => live.querySelector(`#${CSS.escape(id)}`) };
    if (live.querySelector('text')) warn('글자(text)는 그리지 않습니다 — 디자이너에게 글자를 아웃라인(패스)으로 바꾼 SVG를 받으세요');
    if (live.querySelector('image')) warn('image는 그리지 않습니다');

    const parts = [];
    try {
      for (const el of live.querySelectorAll(SVG_SHAPES)) {
        if (el.parentElement.closest(SKIP_ANCESTORS)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.getAttribute('clip-path') || el.getAttribute('mask') || el.getAttribute('filter')) warn('clipPath·mask·filter는 무시합니다');
        const d = shapeD(el);
        if (!d) continue;
        let opacity = 1;
        const groups = [];
        for (let e = el; e && e !== live; e = e.parentElement) {
          const o = parseFloat(getComputedStyle(e).opacity);
          if (Number.isFinite(o)) opacity *= o;
          if (e !== el && e.id) groups.push(e.id);
          if (e !== el && (e.getAttribute('clip-path') || e.getAttribute('mask') || e.getAttribute('filter'))) warn('clipPath·mask·filter는 무시합니다');
        }
        const m = el.getCTM();
        const mat = m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0];
        let box = { x: 0, y: 0, width: 0, height: 0 };
        try { box = el.getBBox(); } catch (e) { /* 크기 없는 도형 */ }
        // 전체 좌표계의 경계 상자 (네 모서리를 변환)
        const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
          .map(([x, y]) => [mat[0] * x + mat[2] * y + mat[4], mat[1] * x + mat[3] * y + mat[5]]);
        const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
        const gx = Math.min(...xs), gy = Math.min(...ys), gw = Math.max(...xs) - gx, gh = Math.max(...ys) - gy;
        let length = 0;
        try { length = el.getTotalLength(); } catch (e) { /* 길이 없는 도형 */ }
        const sw = parseFloat(cs.strokeWidth);
        parts.push({
          i: parts.length, id: el.id || null, groups, tag: el.localName,
          path: new Path2D(d), m: mat, length, box: { x: box.x, y: box.y, w: box.width, h: box.height },
          x: gx, y: gy, w: gw, h: gh, cx: gx + gw / 2, cy: gy + gh / 2,
          fill: readPaint(ldoc, cs.fill, (parseFloat(cs.fillOpacity) || 0), warn),
          fillRule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
          stroke: readPaint(ldoc, cs.stroke, (parseFloat(cs.strokeOpacity) || 0), warn),
          strokeWidth: Number.isFinite(sw) ? sw : 1,
          cap: cs.strokeLinecap || 'butt', join: cs.strokeLinejoin || 'miter', miter: parseFloat(cs.strokeMiterlimit) || 4,
          opacity,
        });
      }
    } finally {
      host.remove();
    }
    for (const msg of warnings) console.warn(`[stage] ${url}: ${msg}`);
    return makeSvg(url, w, h, parts, [...warnings]);
  }

  function makeSvg(url, w, h, parts, warnings) {
    const byName = (name) => parts.filter((p) => p.id === name || p.groups.includes(name));

    // 배치: width / height / scale 중 하나 (없으면 1 SVG 단위 = 1px), anchor는 SVG 상자 기준 [0~1, 0~1]
    function box(x, y, o = {}) {
      const k = o.scale != null ? o.scale : o.width != null ? o.width / w : o.height != null ? o.height / h : 1;
      const [ax, ay] = o.anchor || [0.5, 0.5];
      return { x: x - ax * w * k, y: y - ay * h * k, w: w * k, h: h * k, k };
    }

    function paintStyle(g, p, paint, o) {
      if (o.fill) return o.fill;
      if (paint.color) return (o.recolor && o.recolor[paint.color]) || paint.color;
      const gr = paint.grad;
      const bb = gr.units === 'bbox' ? p.box : { x: 0, y: 0, w: 1, h: 1 };
      const X = (v) => bb.x + v * bb.w, Y = (v) => bb.y + v * bb.h;
      const cg = gr.type === 'linear'
        ? g.createLinearGradient(X(gr.x1), Y(gr.y1), X(gr.x2), Y(gr.y2))
        : g.createRadialGradient(X(gr.fx), Y(gr.fy), 0, X(gr.cx), Y(gr.cy), gr.r * (gr.units === 'bbox' ? Math.max(bb.w, bb.h) : 1));
      for (const s of gr.stops) {
        const c = (o.recolor && o.recolor[s.color]) || s.color;
        const [r, gg, b] = [1, 3, 5].map((i) => parseInt((hex(c) || '#000000').slice(i, i + 2), 16));
        cg.addColorStop(s.offset, `rgba(${r},${gg},${b},${s.alpha})`);
      }
      return cg;
    }

    function draw(g, x, y, opts = {}) {
      const o = { ...opts };
      if (o.recolor) o.recolor = Object.fromEntries(Object.entries(o.recolor).map(([a, b]) => [hex(a) || a, b]));
      const only = o.only == null ? null : new Set([].concat(o.only));
      const list = only ? parts.filter((p) => only.has(p.id) || p.groups.some((n) => only.has(n))) : parts;
      const b = box(x, y, o);
      const alpha = o.alpha == null ? 1 : o.alpha;
      if (alpha <= 0.001) return b;
      const traceWidth = o.traceWidth || Math.max(w, h) / 200;
      list.forEach((p, n) => {
        const s = (o.part && o.part(p, n)) || {};
        const a = alpha * p.opacity * (s.alpha == null ? 1 : s.alpha);
        if (a <= 0.001) return;
        const trace = s.trace == null ? 1 : Math.min(1, Math.max(0, s.trace));
        const fillA = s.fill == null ? 1 : Math.min(1, Math.max(0, s.fill));
        g.save();
        g.translate(b.x + (s.dx || 0), b.y + (s.dy || 0));
        g.scale(b.k, b.k);
        if (s.scale != null || s.rotate) {
          g.translate(p.cx, p.cy);
          if (s.rotate) g.rotate(s.rotate);
          if (s.scale != null) g.scale(s.scale, s.scale);
          g.translate(-p.cx, -p.cy);
        }
        g.transform(...p.m);
        if (p.fill && fillA > 0.001) {
          g.globalAlpha = a * p.fill.alpha * fillA;
          g.fillStyle = paintStyle(g, p, p.fill, o);
          g.fill(p.path, p.fillRule);
        }
        // 선: 원래 선이 있으면 그 선을, 없으면 trace < 1 동안 칠 색으로 윤곽을 그린다
        const strokePaint = p.stroke || (trace < 1 && p.fill ? p.fill : null);
        if (strokePaint && trace > 0.001) {
          g.globalAlpha = a * strokePaint.alpha;
          g.strokeStyle = paintStyle(g, p, strokePaint, o);
          g.lineWidth = p.stroke ? p.strokeWidth : traceWidth;
          g.lineCap = p.cap; g.lineJoin = p.join; g.miterLimit = p.miter;
          if (trace < 1 && p.length > 0) { g.setLineDash([p.length * trace, p.length + 1]); g.lineDashOffset = 0; }
          g.stroke(p.path);
        }
        g.restore();
      });
      return b;
    }

    return { url, w, h, aspect: w / h, parts, warnings, part: byName, box, draw };
  }

  const Stage = window.Stage = { film, reload: () => false, rrect, cursor, text, layer, svg, RENDER, hooks: { beforeApply: [], pending: [] } };
})();
