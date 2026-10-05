/*
 * motion.js — 시간의 순수 함수로만 이루어진 모션 라이브러리
 *
 * 규칙: 여기 있는 모든 함수는 (t, 데이터) → 값. 내부 상태 없음, 타이머 없음, Math.random 없음.
 * 그래서 seek(812번째 프레임)을 0~811 프레임 없이 바로 그릴 수 있고, 렌더가 매번 똑같다.
 *
 * 브라우저: <script src="../../lib/motion.js"></script> → window.M
 * Node:    const M = require('./lib/motion.js')
 */
(function (root) {
  'use strict';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const mix = lerp;
  const inv = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));       // lerp의 역함수
  const range = (a, b, x) => clamp(inv(a, b, x));                    // a~b 구간 진행도 0~1

  /* ── 스프링 ───────────────────────────────────────────────────────────
   * 감쇠 스프링의 닫힌 해 (0 → 1 step response). k = 강성, d = 감쇠.
   * z = d / (2√k) 가 1에 가까울수록 오버슈트 없음. z < 1 이면 살짝 넘침.
   */
  function spring(t, k = 170, d = 26) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k), z = d / (2 * w0);
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    // 과감쇠
    const r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1));
    return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
  }

  /* 프리셋 — 용도별로 고르면 된다. [k, d]
   * snappy : 버튼, 토글, 인디케이터 앞쪽 끝 — 빠르고 아주 살짝 넘침
   * ui     : 카드, 컨테이너 크기 변화 — 기본값
   * camera : 카메라, 큰 레이아웃 — 무게감, 오버슈트 없음
   * heavy  : 큰 타이포, 로고 — 느리고 묵직
   * playful: 마스코트, 스티커 — 눈에 보이는 바운스 (UI에는 쓰지 말 것)
   */
  const SPRINGS = {
    snappy:  [380, 34],
    ui:      [220, 28],
    camera:  [110, 22],
    heavy:   [90, 19],
    playful: [260, 14],
  };
  const sp = (name) => SPRINGS[name] || SPRINGS.ui;

  /* ── track: 목표가 여러 번 바뀌는 값 ────────────────────────────────────
   * keys: [[시간, 값], ...] 시간순. 첫 키는 시작값.
   * 바뀔 때마다 스프링을 "새로 시작"하지 않고 "하나씩 더한다". → 끊김 없이 이어지고, 여전히 t의 순수 함수.
   */
  function track(t, keys, k = 220, d = 28) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++)
      v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
    return v;
  }

  /* loopTrack: 루프 영상용 track. 마지막 값 == 첫 값이어야 한다.
   * 이전 사이클의 스프링 꼬리를 함께 더해서, 마지막 프레임 → 첫 프레임 이음새에서
   * 위치와 속도까지 정확히 이어진다. (루프 끊김의 가장 흔한 원인 해결)
   */
  function loopTrack(t, keys, dur, k = 220, d = 28) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const dv = keys[i][1] - keys[i - 1][1], ti = keys[i][0];
      v += dv * (spring(t - ti, k, d) + spring(t - ti + dur, k, d) - 1);
    }
    // 마지막 값이 첫 값과 다르면 잘못 쓴 것 — 개발 중 바로 보이게
    if (Math.abs(keys[keys.length - 1][1] - keys[0][1]) > 1e-6 && !loopTrack._warned) {
      loopTrack._warned = true;
      console.warn('[motion] loopTrack: 마지막 값이 첫 값과 달라서 이음새가 튑니다', keys);
    }
    return v;
  }

  /* 색 트랙: keys 값이 '#rrggbb' */
  function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgb(a) { return `rgb(${a.map((x) => Math.round(clamp(x, 0, 255))).join(',')})`; }
  function colorTrack(t, keys, k, d, loopDur) {
    const ch = [0, 1, 2].map((c) => {
      const kk = keys.map(([tt, col]) => [tt, hex(col)[c]]);
      return loopDur ? loopTrack(t, kk, loopDur, k, d) : track(t, kk, k, d);
    });
    return rgb(ch);
  }
  const mixColor = (a, b, p) => rgb(hex(a).map((x, i) => lerp(x, hex(b)[i], p)));

  /* ── 늘어나는 인디케이터 (탭, 토글 노브) ─────────────────────────────────
   * 앞쪽 끝은 빠른 스프링, 뒤쪽 끝은 느린 스프링 → 이동 중에 액체처럼 늘어났다가 붙는다.
   * stops: [[시간, 왼쪽 x], ...], width: 기본 폭
   */
  function stretch(t, stops, width, opts = {}) {
    const [kf, df] = opts.fast || [420, 34], [ks, ds] = opts.slow || [150, 22];
    const tr = opts.loop ? (s, k, d) => loopTrack(t, s, opts.loop, k, d) : (s, k, d) => track(t, s, k, d);
    const a = tr(stops, kf, df), b = tr(stops, ks, ds);
    // 움직이는 방향 쪽이 앞쪽 끝
    const left = Math.min(a, b), right = Math.max(a, b) + width;
    return { left, right, width: right - left, center: (left + right) / 2 };
  }

  /* ── 텍스트 교체 타이밍 ─────────────────────────────────────────────────
   * 모핑하는 컨테이너 안의 내용: 모핑 시작 직후 들어오고, 다음 모핑 직전에 나간다.
   * 반환 0~1. 겹침 방지가 핵심.
   */
  function swapAlpha(t, tIn, tOut, inDelay = 0.08, inDur = 0.14, outDur = 0.1) {
    const a = range(tIn + inDelay, tIn + inDelay + inDur, t);
    const b = tOut == null ? 1 : 1 - range(tOut - outDur, tOut, t);
    return Math.min(a, b);
  }
  // 교체 중 블러 (px). alpha가 1이면 0, 0에 가까울수록 max.
  const swapBlur = (alpha, max = 10) => (1 - alpha) * max;

  /* ── 루프 & 비트 ───────────────────────────────────────────────────────── */
  const loopT = (t, dur) => ((t % dur) + dur) % dur;
  const beat = (n, bpm = 120, offset = 0) => offset + (n * 60) / bpm;     // n번째 비트의 시각(초)
  const bar = (n, bpm = 120, beatsPerBar = 4, offset = 0) => beat(n * beatsPerBar, bpm, offset);

  /* ── 시드 고정 난수 ─────────────────────────────────────────────────────
   * Math.random 금지. rng(7)() 처럼 쓴다. 같은 시드면 항상 같은 수열.
   */
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── 물리 곡선: 엔진 없이 식으로 (2D·3D 공통, 단순한 낙하·미끄러짐·포물선) ─────────
   * g: 중력 가속도. 2D는 px/s²(1080 기준 3000 ≈ 손바닥만 한 물체), 3D는 stage3d의 G × 1.6(snappy).
   * 여러 물체가 부딪히거나 쌓이면 stage3d의 physics()를 쓴다.
   */
  // 떨어져서 튀다 멈춘다. t0에 바닥 위 h에서 놓음 → 바닥 위 높이(≥0). bounce: 반발(0~1)
  function drop(t, t0, h, { g = 3000, v0 = 0, bounce = 0.3 } = {}) {
    if (t <= t0) return h;
    let tau = t - t0;
    const t1 = (v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g;
    if (tau < t1) return h + v0 * tau - (g * tau * tau) / 2;
    tau -= t1;
    let v = bounce * (g * t1 - v0);
    while (v > g * 0.012) {               // 1프레임쯤 뜨는 작은 튐부터는 멈춘 것으로
      const T = (2 * v) / g;
      if (tau < T) return v * tau - (g * tau * tau) / 2;
      tau -= T; v *= bounce;
    }
    return 0;
  }
  // drop이 바닥에 닿는 시각들 [{ t, speed }] — squash()나 연출 타이밍에 쓴다
  function dropHits(t0, h, { g = 3000, v0 = 0, bounce = 0.3 } = {}) {
    const hits = [];
    let t = t0 + (v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g, v = g * (t - t0) - v0;
    while (v > g * 0.012) { hits.push({ t, speed: v }); v *= bounce; t += (2 * v) / g; }
    return hits;
  }
  // 바닥을 미끄러지다 마찰로 멈춘다. 이동 거리(≥0). mu: 마찰계수
  function slide(t, t0, v0, { mu = 0.4, g = 3000 } = {}) {
    if (t <= t0) return 0;
    const a = mu * g, stop = v0 / a, tau = Math.min(t - t0, stop);
    return v0 * tau - (a * tau * tau) / 2;
  }
  // 포물선: t0에 p0를 떠나 t1에 정확히 p1에 닿는다 (비트에 착지). [x, y], y는 위가 +. 전후로는 p0·p1에 머문다
  function arc(t, t0, t1, p0, p1, { g = 3000 } = {}) {
    if (t <= t0) return [p0[0], p0[1]];
    if (t >= t1) return [p1[0], p1[1]];
    const T = t1 - t0, tau = t - t0, vy = (p1[1] - p0[1] + (g * T * T) / 2) / T;
    return [p0[0] + ((p1[0] - p0[0]) * tau) / T, p0[1] + vy * tau - (g * tau * tau) / 2];
  }
  // 착지 찌그러짐: hits [{t, speed}]에서 → 눌리는 양 (+면 납작, −면 살짝 늘어남). 스케일 = [1 + s*0.3, 1 − s]
  function squash(t, hits, amount = 0.08, ref = 1500) {
    let s = 0;
    for (const h of hits) {
      const tau = t - h.t;
      if (tau < 0 || tau > 0.5) continue;
      const v = amount * Math.min(1.2, h.speed / ref) * Math.exp(-tau / 0.06) * Math.cos((tau * Math.PI * 2) / 0.16);
      if (Math.abs(v) > Math.abs(s)) s = v;
    }
    return s;
  }

  /* ── 이징 (스프링을 못 쓰는 곳에만: 선 그리기 진행도 등) ───────────────── */
  const ease = {
    linear: (p) => p,
    outCubic: (p) => 1 - Math.pow(1 - clamp(p), 3),
    inOutCubic: (p) => (p = clamp(p), p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outExpo: (p) => (p = clamp(p), p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  };

  const M = {
    clamp, lerp, mix, inv, range,
    spring, SPRINGS, sp, track, loopTrack, colorTrack, mixColor, hex, rgb,
    stretch, swapAlpha, swapBlur,
    drop, dropHits, slide, arc, squash,
    loopT, beat, bar, rng, ease,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  else root.M = M;
})(typeof window !== 'undefined' ? window : globalThis);
