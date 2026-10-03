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
 *       "timeline": { "check":  { "t": 2.5, "label": "체크로 모핑" } },                          // 이름 붙은 시각(초)
 *       "cues":     [{ "at": "check", "dt": 0.02, "type": "success" }, { "t": 0.5, "type": "click" }] }
 *
 *   index.html (코드 — 에이전트가 쓴다)
 *     Stage.film((film) => {
 *       // film = { title, dur, bpm, beatOffset, fps, transparent, P: { accent: '#2F6BFF' }, T: { check: 2.5 } }
 *       // 여기서 film으로부터 상수·표를 만든다 (film.json이 바뀌면 이 함수가 다시 불린다)
 *       return {
 *         cues: [...],                 // (선택) 코드로 만드는 반복 효과음 — film.json cues 뒤에 붙는다
 *         draw(g, t, S) { ... },       // S = { W, H, format, unit, cx, cy, portrait, landscape, transparent, ... }
 *       };
 *     });
 *
 * 렌더 계약 (tools/render.mjs 가 의존):
 *   window.seek(t)     → t초 프레임을 그린다. 같은 t면 항상 같은 그림.
 *   window.FILM        → { title, dur, bpm, beatOffset, fps, W, H, format, formats, transparent, cues }
 *   window.READY       → film.json + 폰트 로딩 끝나면 true
 *   window.LOAD_ERROR  → film.json을 읽지 못했거나 형식이 틀리면 오류 문구
 *   Stage.reload(json) → film.json 내용을 바꿔 다시 적용 (앱이 편집 직후 부른다)
 *   postMessage({ type: 'motion:film-json', json }) 도 같은 일을 한다 (앱의 iframe 미리보기용)
 *
 * 필름은 http(s)로 열어야 한다 (file://에서는 film.json을 읽을 수 없다). npm run preview / render.mjs가 서버를 띄운다.
 *
 * 미리보기 (일반 브라우저로 열었을 때만):
 *   Space 재생/정지 · ←/→ 1프레임 · Shift+←/→ 1비트 · Home 처음 · 스크러버 드래그
 *   ?format=9x16 · ?t=3.5 (해당 시각에서 정지) · ?grid=1 (비트 그리드 표시)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(location.search);
  const RENDER = navigator.webdriver || q.get('render') === '1';

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
    const cues = [];
    (Array.isArray(json.cues) ? json.cues : json.cues === undefined ? [] : (errs.push('cues: 배열이어야 합니다'), [])).forEach((c, i) => {
      if (!isObj(c) || typeof c.type !== 'string') return errs.push(`cues[${i}].type: 효과음 이름(문자열)이 필요합니다`);
      const { at, dt, ...rest } = c;
      if (at !== undefined) {
        if (!(at in T)) return errs.push(`cues[${i}].at: timeline에 "${at}"이 없습니다`);
        if (dt !== undefined && !isNum(dt)) return errs.push(`cues[${i}].dt: 숫자여야 합니다`);
        cues.push({ ...rest, t: T[at] + (dt || 0) });
      } else if (isNum(c.t)) cues.push(rest);
      else errs.push(`cues[${i}]: "t"(초) 또는 "at"(timeline 이름)이 필요합니다`);
    });
    if (errs.length) throw new Error('film.json 형식 오류\n  - ' + errs.join('\n  - '));

    return {
      title: json.title || document.title, dur: json.dur, bpm: json.bpm || 120, beatOffset: json.beatOffset || 0,
      fps: json.fps || 60, formats, transparent: !!json.transparent, P, T, cues,
    };
  }

  function film(factory) {
    if (typeof factory !== 'function') {
      throw new Error('[stage] Stage.film((F) => ({ draw(g, t, S) {} })) 형태로 부른다. dur·bpm·formats·cues 같은 데이터는 film.json에 둔다.');
    }
    // <head> 안에서 불려도 동작하도록 body가 생긴 뒤 시작
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => film(factory)); return; }

    const fail = (err) => {
      const msg = String(err && err.message || err);
      window.LOAD_ERROR = msg;
      console.error('[stage] ' + msg);
      if (!RENDER) {
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
    document.body.style.cssText = `margin:0;min-height:100%;background:${RENDER ? (F.transparent ? 'transparent' : '#000') : '#1b1b1a'};` +
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
      const m = factory({ title: nextF.title, dur: nextF.dur, bpm: nextF.bpm, beatOffset: nextF.beatOffset, fps: nextF.fps,
        transparent: nextF.transparent, P: { ...nextF.P }, T: { ...nextF.T } });
      if (!m || typeof m.draw !== 'function') throw new Error('Stage.film의 함수는 { draw(g, t, S) } 를 돌려줘야 합니다');
      F = nextF; made = m;
      Object.assign(S, { dur: F.dur, bpm: F.bpm, transparent: F.transparent });
      window.FILM = { title: F.title, dur: F.dur, bpm: F.bpm, beatOffset: F.beatOffset, fps: F.fps, W, H, format,
        formats: Object.keys(formats), transparent: F.transparent, cues: [...F.cues, ...(m.cues || [])] };
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

    window.READY = true;
    if (!RENDER) preview();
    else window.seek(0);

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
      // 비트 눈금 + 효과음 점 (film.json이 바뀌면 다시 그린다)
      function ticks() {
        const dur = F.dur, bpm = F.bpm, off = F.beatOffset;
        const nb = Math.floor((dur - off) * bpm / 60);
        let html = '<div style="position:absolute;left:0;right:0;top:13px;height:2px;background:#333"></div>';
        for (let i = 0; i <= nb; i++) {
          const x = ((off + i * 60 / bpm) / dur) * 100, big = i % 4 === 0;
          html += `<div style="position:absolute;left:${x}%;top:${big ? 4 : 9}px;width:1px;height:${big ? 20 : 10}px;background:${big ? '#666' : '#3a3a3a'}"></div>`;
        }
        for (const c of window.FILM.cues)
          html += `<div title="${c.type}" style="position:absolute;left:${(c.t / dur) * 100}%;top:22px;width:3px;height:3px;border-radius:2px;background:#d97757"></div>`;
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

  const Stage = window.Stage = { film, reload: () => false, rrect, cursor, text, layer, RENDER };
})();
