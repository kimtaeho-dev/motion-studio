/*
 * stage-lottie.js — Lottie 애니메이션(lottie.json)을 Skottie(CanvasKit, lib/lottie/)로 그린다.
 *
 *   Lottie 필름 (films/<이름>/lottie.json이 결과물, index.html은 이 셸 한 줄):
 *     <script src="../../lib/motion.js"></script>
 *     <script src="../../lib/stage.js"></script>
 *     <script src="../../lib/stage-lottie.js"></script>
 *     <script>Stage.lottieFilm();</script>
 *   film.json의 dur·fps·formats·params는 `node tools/lottie.mjs sync films/<이름>`이 lottie.json에서 채운다.
 *   params의 키 = Lottie 슬롯 id(sid). 속성 패널에서 바꾼 값이 슬롯에 들어간다 (내보낼 때 lottie.json에 구워진다).
 *
 *   보통 필름 안의 부품 (module 스크립트, Stage.film 밖에서 한 번):
 *     const check = await Stage.lottie('../check/lottie.json');
 *     check.draw(g, x, y, { t: t - T.done, width: 200 * S.unit, slots: { accent: P.accent } });
 *
 * 렌더 계약은 stage.js 그대로다: 같은 t면 같은 그림. CPU 래스터(SW surface)로 그려서 기기 GPU에 따라 달라지지 않는다.
 * 글꼴: 네이티브 글자(ty:5) 미리보기용으로 assets/fonts/ttf/의 Pretendard·Geist를 넘긴다. 전달물은 아웃라인(prompts/lottie.md).
 */
(function () {
  'use strict';
  if (!window.Stage) throw new Error('[stage-lottie] lib/stage.js를 먼저 불러온다');

  // 이 파일이 있는 lib/ 폴더 (엔진이 고정된 필름은 lib-versions/<지문>/lib/)
  const LIB = (document.currentScript && document.currentScript.src.replace(/stage-lottie\.js.*$/, '')) || '../../lib/';
  const FONT_FILES = ['Pretendard-Bold', 'Pretendard-SemiBold', 'Geist-Bold', 'Geist-SemiBold'];

  let ckPromise = null;
  function canvasKit() {
    if (!ckPromise) {
      ckPromise = new Promise((resolve, reject) => {
        if (window.CanvasKitInit) return resolve();
        const s = document.createElement('script');
        s.src = LIB + 'lottie/canvaskit.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('[stage-lottie] lib/lottie/canvaskit.js를 읽지 못했습니다'));
        document.head.appendChild(s);
      }).then(() => window.CanvasKitInit({ locateFile: (f) => LIB + 'lottie/' + f }));
    }
    return ckPromise;
  }

  let fontPromise = null;
  function houseFonts() {
    if (!fontPromise) {
      fontPromise = Promise.all(FONT_FILES.map(async (name) => {
        try {
          const r = await fetch(new URL(`../assets/fonts/ttf/${name}.ttf`, LIB));
          return r.ok ? [`__font_${name}.ttf`, await r.arrayBuffer()] : null;
        } catch (e) { return null; }
      })).then((list) => Object.fromEntries(list.filter(Boolean)));
    }
    return fontPromise;
  }

  const hexToColor4f = (CK, hex) => {
    const h = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex).trim());
    if (!h) return null;
    const n = parseInt(h[1], 16);
    return CK.Color4f(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, h[2] ? parseInt(h[2], 16) / 255 : 1);
  };

  // 크기별 오프스크린 캔버스 + CPU surface (여러 애니메이션이 같이 쓴다)
  const surfaces = new Map();
  function surfaceFor(CK, w, h) {
    const key = `${w}x${h}`;
    let s = surfaces.get(key);
    if (!s) {
      const el = document.createElement('canvas');
      el.width = w; el.height = h;
      const surface = CK.MakeSWCanvasSurface(el);
      if (!surface) throw new Error('[stage-lottie] 그릴 표면을 만들지 못했습니다');
      s = { el, surface };
      surfaces.set(key, s);
      if (surfaces.size > 12) {                    // 크기가 계속 바뀌는 장면(줌)에서 메모리가 쌓이지 않게
        const [oldKey, old] = surfaces.entries().next().value;
        old.surface.delete(); surfaces.delete(oldKey);
      }
    }
    return s;
  }

  const cache = new Map();
  function lottie(path) {
    const url = new URL(path, location.href).href;
    if (!cache.has(url)) cache.set(url, load(path, url));
    return cache.get(url);
  }

  async function load(path, url) {
    const [CK, fonts, text] = await Promise.all([canvasKit(), houseFonts(), fetch(url, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`Lottie 파일을 읽지 못했습니다: ${path} (${r.status})`);
      return r.text();
    })]);
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`Lottie JSON이 깨졌습니다: ${path} — ${e.message}`); }

    // 이미지 에셋: assets[].p 파일명으로 찾는다 (lottie.json 옆, 또는 u 폴더). 임베드(e:1, data:)는 그대로
    const blobs = { ...fonts };
    await Promise.all((doc.assets || []).filter((a) => a.p && !a.e && !String(a.p).startsWith('data:')).map(async (a) => {
      const r = await fetch(new URL((a.u || '') + a.p, url));
      if (!r.ok) throw new Error(`Lottie 이미지 에셋을 찾지 못했습니다: ${(a.u || '') + a.p}`);
      blobs[a.p] = await r.arrayBuffer();
    }));

    const anim = CK.MakeManagedAnimation(text, blobs);
    if (!anim) throw new Error(`Skottie가 이 Lottie를 열지 못했습니다: ${path} (필수 필드 v·fr·ip·op·w·h·layers 확인)`);

    const fps = anim.fps() || doc.fr || 60;
    const frames = Math.max(1, Math.round(anim.duration() * fps));
    const info = anim.getSlotInfo ? anim.getSlotInfo() : {};
    const slotTypes = {};
    for (const id of info.colorSlotIDs || []) slotTypes[id] = 'color';
    for (const id of info.scalarSlotIDs || []) slotTypes[id] = 'number';
    for (const id of info.textSlotIDs || []) slotTypes[id] = 'text';
    for (const id of info.vec2SlotIDs || []) slotTypes[id] = 'vec2';
    // 글자 슬롯은 setText(레이어 이름)으로 바꾼다 — canvaskit 0.41.1의 setTextSlot은 다시 조판하지 않는다
    const textLayers = {};
    for (const l of doc.layers || []) {
      const sid = l.ty === 5 && l.t && l.t.d && l.t.d.sid;
      if (!sid || !l.nm) continue;
      const k = l.t.d.k;
      (textLayers[sid] = textLayers[sid] || []).push({ name: l.nm, size: (Array.isArray(k) && k[0] && k[0].s && k[0].s.s) || 0 });
    }

    let applied = '';
    function setSlots(values) {
      if (!values) return;
      const key = JSON.stringify(values);
      if (key === applied) return;
      applied = key;
      for (const [id, v] of Object.entries(values)) {
        const type = slotTypes[id];
        if (type === 'color') { const c = hexToColor4f(CK, v); if (c) anim.setColorSlot(id, c); }
        else if (type === 'number' && Number.isFinite(+v)) anim.setScalarSlot(id, +v);
        else if (type === 'text') for (const l of textLayers[id] || []) anim.setText(l.name, String(v), l.size);
      }
    }

    // 배치: width / height / scale 중 하나 (없으면 Lottie 1px = 1px), anchor는 Lottie 상자 기준 [0~1, 0~1]
    function box(x, y, o = {}) {
      const k = o.scale != null ? o.scale : o.width != null ? o.width / doc.w : o.height != null ? o.height / doc.h : 1;
      const [ax, ay] = o.anchor || [0.5, 0.5];
      return { x: x - ax * doc.w * k, y: y - ay * doc.h * k, w: doc.w * k, h: doc.h * k, k };
    }

    // t(초) → 프레임. loop면 길이로 감고, 아니면 처음·끝에서 멈춘다
    function frameAt(t, loop) {
      const f = t * fps;
      if (loop) return ((f % frames) + frames) % frames;
      return Math.min(Math.max(f, 0), frames - 1);
    }

    function draw(g, x, y, o = {}) {
      const b = box(x, y, o);
      const alpha = o.alpha == null ? 1 : o.alpha;
      if (alpha <= 0.001 || b.w < 0.5 || b.h < 0.5) return b;
      setSlots(o.slots);
      // 지금 변환(카메라 줌 등)까지 곱한 실제 픽셀 크기로 그려서 흐려지지 않게
      const m = g.getTransform();
      const px = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) || 1;
      const pw = Math.max(1, Math.ceil(b.w * px)), ph = Math.max(1, Math.ceil(b.h * px));
      const { el, surface } = surfaceFor(CK, pw, ph);
      const c = surface.getCanvas();
      c.clear(CK.TRANSPARENT);
      anim.seekFrame(o.frame != null ? o.frame : frameAt(o.t || 0, o.loop));
      anim.render(c, CK.LTRBRect(0, 0, b.w * px, b.h * px));
      surface.flush();
      g.save();
      g.globalAlpha *= alpha;
      g.drawImage(el, 0, 0, pw, ph, b.x, b.y, pw / px, ph / px);
      g.restore();
      return b;
    }

    return { path, url, doc, w: doc.w, h: doc.h, fps, frames, dur: frames / fps, slots: slotTypes, box, frameAt, draw, setSlots };
  }

  /* Lottie 필름: lottie.json 한 편이 곧 필름. film.json은 tools/lottie.mjs sync가 맞춘다 */
  async function lottieFilm(path = 'lottie.json') {
    let lot;
    try {
      lot = await lottie(path);
    } catch (e) {
      window.LOAD_ERROR = String(e.message || e);
      console.error('[stage-lottie] ' + window.LOAD_ERROR);
      return;
    }
    window.LOTTIE = lot;
    Stage.film((film) => {
      const off = [];
      if (Math.abs(film.dur - lot.dur) > 0.5 / lot.fps) off.push(`dur ${film.dur} ≠ ${+lot.dur.toFixed(3)}`);
      if (film.fps !== lot.fps) off.push(`fps ${film.fps} ≠ ${lot.fps}`);
      if (film.W !== lot.w || film.H !== lot.h) off.push(`크기 ${film.W}x${film.H} ≠ ${lot.w}x${lot.h}`);
      if (off.length) throw new Error(`film.json이 lottie.json과 다릅니다 (${off.join(', ')}) — node tools/lottie.mjs sync 로 맞춘다`);
      const values = {};
      for (const [k, v] of Object.entries(film.P)) if (lot.slots[k]) values[k] = v;
      return {
        draw(g, t, S) {
          lot.draw(g, 0, 0, { t, width: S.W, anchor: [0, 0], slots: values });
        },
      };
    });
  }

  Object.assign(window.Stage, { lottie, lottieFilm });
})();
