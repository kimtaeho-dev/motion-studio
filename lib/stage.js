/*
 * stage.js — 필름 한 편의 "무대": 캔버스, 포맷, 폰트, 미리보기 UI, 렌더 계약.
 *
 * 필름 쪽에서는 이것만 부르면 된다:
 *
 *   Stage.film({
 *     title: '샘플', dur: 12, bpm: 120,
 *     formats: { '1x1': [1080, 1080], '9x16': [1080, 1920], '16x9': [1920, 1080] },
 *     cues: [{ t: 0.5, type: 'click' }, ...],     // 효과음 (tools/sfx.mjs가 읽음)
 *     draw(g, t, S) { ... },                       // S = { W, H, format, unit, ... }
 *   });
 *
 * 렌더 계약 (tools/render.mjs 가 의존):
 *   window.seek(t)  → t초 프레임을 그린다. 같은 t면 항상 같은 그림.
 *   window.FILM     → { title, dur, bpm, fps, W, H, format, cues }
 *   window.READY    → 폰트 로딩 끝나면 true
 *
 * 미리보기 (일반 브라우저로 열었을 때만):
 *   Space 재생/정지 · ←/→ 1프레임 · Shift+←/→ 1비트 · Home 처음 · 스크러버 드래그
 *   ?format=9x16 · ?t=3.5 (해당 시각에서 정지) · ?grid=1 (비트 그리드 표시)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(location.search);
  const RENDER = navigator.webdriver || q.get('render') === '1';

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

  function film(def) {
    // <head> 안에서 불려도 동작하도록 body가 생긴 뒤 시작
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => film(def)); return; }
    const formats = def.formats || { '1x1': [1080, 1080] };
    const format = q.get('format') && formats[q.get('format')] ? q.get('format') : Object.keys(formats)[0];
    const [W, H] = formats[format];
    const fps = def.fps || 60;

    document.documentElement.style.cssText = 'margin:0;height:100%';
    document.body.style.cssText = `margin:0;min-height:100%;background:${RENDER ? '#000' : '#1b1b1a'};` +
      'font-family:Geist,Pretendard,system-ui,sans-serif;color:#ddd';

    const canvas = document.createElement('canvas');
    canvas.id = 'c'; canvas.width = W; canvas.height = H;
    canvas.style.display = 'block';
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');

    // 레이아웃 단위: 짧은 변 기준 1080 = 1000u. 포맷이 바뀌어도 같은 비율로 보이게.
    const unit = Math.min(W, H) / 1080;
    const S = { W, H, format, unit, cx: W / 2, cy: H / 2, portrait: H > W, landscape: W > H, dur: def.dur, bpm: def.bpm };

    window.FILM = { title: def.title || document.title, dur: def.dur, bpm: def.bpm || 120, fps, W, H, format,
      formats: Object.keys(formats), cues: def.cues || [], beatOffset: def.beatOffset || 0 };

    let current = 0;
    window.seek = (t) => {
      current = t;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.filter = 'none'; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      def.draw(g, t, S);
      g.restore();
      if (showGrid) drawGrid(t);
      return true;
    };

    let showGrid = q.get('grid') === '1' && !RENDER;
    function drawGrid(t) {
      const bpm = window.FILM.bpm, b = (t - window.FILM.beatOffset) * bpm / 60;
      g.save(); g.font = `500 ${22 * unit}px "Geist Mono"`; g.fillStyle = 'rgba(255,0,80,.85)';
      g.fillText(`t ${t.toFixed(2)}s  beat ${Math.floor(b)}  bar ${Math.floor(b / 4)}.${Math.floor(b) % 4}`, 24 * unit, H - 24 * unit);
      g.restore();
    }

    loadFonts().then(() => {
      window.READY = true;
      if (!RENDER) preview();
      else window.seek(0);
    });

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
      const dur = def.dur, bpm = window.FILM.bpm, off = window.FILM.beatOffset;
      // 비트 눈금
      const nb = Math.floor((dur - off) * bpm / 60);
      let ticks = '<div style="position:absolute;left:0;right:0;top:13px;height:2px;background:#333"></div>';
      for (let i = 0; i <= nb; i++) {
        const x = ((off + i * 60 / bpm) / dur) * 100, big = i % 4 === 0;
        ticks += `<div style="position:absolute;left:${x}%;top:${big ? 4 : 9}px;width:1px;height:${big ? 20 : 10}px;background:${big ? '#666' : '#3a3a3a'}"></div>`;
      }
      for (const c of window.FILM.cues)
        ticks += `<div title="${c.type}" style="position:absolute;left:${(c.t / dur) * 100}%;top:22px;width:3px;height:3px;border-radius:2px;background:#d97757"></div>`;
      tl.innerHTML = ticks + '<div id="ph" style="position:absolute;top:0;width:2px;height:28px;background:#fff"></div>';
      const ph = tl.querySelector('#ph');

      function fit() {
        const aw = innerWidth - 32, ah = innerHeight - 64, s = Math.min(aw / W, ah / H);
        canvas.style.cssText = `display:block;width:${W * s}px;height:${H * s}px;margin:${(ah - H * s) / 2 + 8}px auto 0;border-radius:6px`;
      }
      addEventListener('resize', fit); fit();

      let playing = !q.get('t'), t0 = performance.now(), base = q.get('t') ? Number(q.get('t')) : 0;
      const now = () => (playing ? (base + (performance.now() - t0) / 1000) % dur : base);
      const setT = (t) => { base = ((t % dur) + dur) % dur; t0 = performance.now(); };
      const toggle = () => { setT(now()); playing = !playing; t0 = performance.now(); pp.textContent = playing ? '⏸' : '▶'; };
      pp.onclick = toggle;
      pp.textContent = playing ? '⏸' : '▶';

      let drag = false;
      const scrub = (e) => { const r = tl.getBoundingClientRect(); setT(((e.clientX - r.left) / r.width) * dur); };
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
            const b = 60 / bpm, cur = Math.round((now() - off) / b);
            setT(off + (cur + dir) * b);
          } else setT(now() + dir / fps);
        }
      });

      (function loop() {
        const t = now();
        window.seek(t);
        ph.style.left = `${(t / dur) * 100}%`;
        const b = (t - off) * bpm / 60;
        tc.textContent = `${t.toFixed(2)}s · beat ${Math.max(0, Math.floor(b))} · f${Math.round(t * fps)}`;
        requestAnimationFrame(loop);
      })();
    }

    return S;
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

  window.Stage = { film, rrect, cursor, text, layer, RENDER };
})();
