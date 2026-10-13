/*
 * stage-check.js — 모든 필름(2D·3D)의 품질 검사. `node tools/render.mjs films/<이름> --check`가 렌더 페이지 안에서 불러 쓴다.
 * 필름 코드는 이 파일을 불러오지 않는다.
 *
 * 방법은 자유롭게 열고, 결과는 여기서 숫자로 판정한다. 시간을 훑으며 본다:
 *   정지      — 화면이 거의 안 바뀌는 구간 (죽은 구간)
 *   새 일 없음 — 1초 동안의 변화가 계속 작은 구간 (자잘한 떨림만 있고 사건이 없다)
 *   구도      — 내용(윤곽이 있는 곳)이 화면을 얼마나 쓰는지, 비는 쪽 여백
 *   빈 화면 · 번쩍임
 *   결정성    — 같은 시각을 처음(콜드)·순서대로·뒤섞은 순서로 그려 픽셀이 같은지
 *   루프 이음새 — film.json "loop": true일 때 끝 → 처음이 튀는지
 * 의도한 것은 필름에서 Stage.allow({ still: [[T.end, DUR]], blank: [[0, 0.3]], seam: true, fill: true })로 뺀다.
 */

const TH = {
  still: 0.06,       // 연속 샘플 사이 평균 변화(0~255)가 이보다 작으면 정지
  stillNote: 0.75,   // 이만큼(초) 이어지면 참고로 적고 (읽으라고 둔 멈춤일 수 있다)
  stillMin: 1.2,     // 이만큼 이어지면 죽은 구간
  changed: 30,       // 썸네일 픽셀의 RGB 차이 합이 이보다 크면 "바뀐 픽셀"
  quiet: 0.25,       // 1초 사이 바뀐 픽셀이 이 필름 평소(중앙값)의 25%도 안 되면 "새 일 없음" (포맷·화풍과 상관없이)
  quietMin: 4,       // 이만큼(초) 이어지면 실패 (CLAUDE.md: 2~4초마다 새로운 일)
  edge: 14,          // 썸네일 밝기 차이가 이보다 크면 윤곽
  marginFail: 0.4,   // 한쪽 여백이 화면의 40%를 넘으면 실패 (시간 중앙값)
  marginNote: 0.3,
  flash: 70,         // 연속 샘플 사이 평균 밝기가 이만큼 뛰면 번쩍임
  blankStd: 1.5,
  blankEdge: 0.5,    // 처음·끝 이 시간(초) 안의 빈 화면은 페이드로 보고 참고만
  seam: 3,           // 루프 이음새 변화가 평소 한 프레임 변화의 이 배수를 넘으면 튐
};
const TW = 192;      // 썸네일 폭

function fnv(data) {
  const u = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

export async function check({ dur, fps = 60, loop = false, step = 1 / 20 }) {
  const allow = (window.Stage && window.Stage.allowed) || {};
  const src = window.__canvas, CW = src.width, CH = src.height;
  const TH_ = Math.max(8, Math.round(TW * CH / CW));
  const thumb = document.createElement('canvas'); thumb.width = TW; thumb.height = TH_;
  const tg = thumb.getContext('2d', { willReadFrequently: true });
  const settle = () => Promise.all((window.Stage && window.Stage.hooks.pending.splice(0)) || []);

  const grab = (t) => {
    const data = window.__grab(t, false);
    const h = fnv(data);
    tg.globalCompositeOperation = 'copy';
    tg.drawImage(window.__copy, 0, 0, TW, TH_);
    const px = tg.getImageData(0, 0, TW, TH_).data;
    const L = new Float32Array(TW * TH_);
    for (let i = 0; i < L.length; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return { h, px, L };
  };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.px.length; i += 4) s += Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]); return s / (a.px.length / 4 * 3); };

  await settle();
  const times = [];
  for (let t = 0; t < dur - 1e-6; t += step) times.push(Math.round(t * 1000) / 1000);
  const r3 = (x) => Math.round(x * 1000) / 1000;

  // 결정성 1: 콜드 — 아무것도 그리기 전에 가운데 시각을 먼저 그린다
  const coldT = times[Math.floor(times.length * 0.6)];
  const cold = grab(coldT);

  // 순서대로 훑기
  const S = [];
  for (const t of times) {
    const f = grab(t);
    // 윤곽 상자 (썸네일 밝기 기울기)
    let x0 = TW, y0 = TH_, x1 = -1, y1 = -1, edges = 0, sum = 0, sum2 = 0;
    for (let y = 1; y < TH_ - 1; y++) for (let x = 1; x < TW - 1; x++) {
      const i = y * TW + x, gx = f.L[i + 1] - f.L[i - 1], gy = f.L[i + TW] - f.L[i - TW];
      if (Math.abs(gx) + Math.abs(gy) > TH.edge) { edges++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    for (let i = 0; i < f.L.length; i++) { sum += f.L[i]; sum2 += f.L[i] * f.L[i]; }
    const mean = sum / f.L.length, std = Math.sqrt(Math.max(0, sum2 / f.L.length - mean * mean));
    S.push({ t, f, mean, std, edges, box: x1 >= 0 ? [x0 / TW, y0 / TH_, (x1 + 1) / TW, (y1 + 1) / TH_] : null });
  }
  // 1초 사이 바뀐 픽셀의 비율
  const changedFrac = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.px.length; i += 4) if (Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]) > TH.changed) n++;
    return n / (a.px.length / 4);
  };
  for (let i = 0; i < S.length; i++) {
    S[i].d = i ? diff(S[i - 1].f, S[i].f) : 0;
    const j = Math.max(0, i - Math.round(1 / step));
    S[i].d1 = i ? changedFrac(S[j].f, S[i].f) : 0;
  }

  const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  const inside = (spans, t) => (spans || []).some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6);
  const runs = (pred, min) => {
    const out = []; let a = null;
    for (let i = 0; i < S.length; i++) {
      const on = pred(S[i], i);
      if (on && a === null) a = i;
      if ((!on || i === S.length - 1) && a !== null) { const b = on ? i : i - 1; if (S[b].t - S[a].t + step >= min) out.push([S[a].t, r3(S[b].t + step)]); a = null; }
    }
    return out;
  };
  const issues = [], notes = [], allowed = [];
  const add = (kind, item, allowKey) => {
    if (allowKey && (allow[allowKey] === true || inside(allow[allowKey], (item.from + item.to) / 2))) allowed.push({ kind, ...item });
    else issues.push({ kind, ...item });
  };

  // 정지 · 새 일 없음
  for (const [from, to] of runs((s, i) => i > 0 && s.d < TH.still, TH.stillNote))
    if (to - from < TH.stillMin) notes.push(`멈춤: ${from.toFixed(2)}–${to.toFixed(2)}s (${(to - from).toFixed(1)}초) — 읽으라고 둔 멈춤이면 정상`);
    else add('still', { from, to, fix: `이 구간에 움직임을 넣거나(카메라 드리프트·질감 떨림·다음 장면 예비동작) 앞뒤 장면 시각을 당긴다. 의도한 정지(마지막 포스터 프레임 등)면 Stage.allow({ still: [[${from}, ${to}]] }) — 시각은 film.T로` }, 'still');
  const quietStart = Math.round(1 / step);
  const typical = med(S.slice(quietStart).map((s) => s.d1));
  for (const [from, to] of runs((s, i) => i >= quietStart && s.d1 < typical * TH.quiet, TH.quietMin))
    add('quiet', { from, to, fix: '자잘한 움직임만 있고 새로운 사건이 없다. 2~4초마다 큰 동작·장면 전환·새 요소가 오게 timeline 시각을 당기거나 사건을 하나 넣는다' }, 'quiet');

  // 빈 화면 · 번쩍임
  for (const [from, to] of runs((s) => s.std < TH.blankStd && s.edges === 0, step))
    if ((from < 1e-6 && to <= TH.blankEdge + 1e-6) || (to >= dur - 1e-6 - step && from >= dur - TH.blankEdge - 1e-6)) notes.push(`빈 화면 ${from.toFixed(2)}–${to.toFixed(2)}s — 시작·끝 페이드로 봤다`);
    else add('blank', { from, to, fix: `화면이 한 색이다. 의도(검은 암전 등)면 Stage.allow({ blank: [[${from}, ${to}]] }) — 시각은 film.T로` }, 'blank');
  for (let i = 1; i < S.length; i++) if (Math.abs(S[i].mean - S[i - 1].mean) > TH.flash)
    add('flash', { from: S[i - 1].t, to: S[i].t, max: Math.round(Math.abs(S[i].mean - S[i - 1].mean)), fix: '한 프레임에 화면 밝기가 크게 뛴다. 색·노출 설정이나 렌더러 설정을 확인한다' }, 'flash');

  // 구도: 시간 중앙값 여백 (위/아래/왼/오)
  const boxes = S.map((s) => s.box).filter(Boolean);
  let fill = null;
  if (boxes.length) {
    const m = { top: med(boxes.map((b) => b[1])), bottom: med(boxes.map((b) => 1 - b[3])), left: med(boxes.map((b) => b[0])), right: med(boxes.map((b) => 1 - b[2])) };
    const union = boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [1, 1, 0, 0]);
    fill = { margins: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100)])), union: union.map((v) => Math.round(v * 100)) };
    const ko = { top: '위', bottom: '아래', left: '왼쪽', right: '오른쪽' };
    for (const [k, v] of Object.entries(m)) {
      if (v > TH.marginFail) add('fill', { from: 0, to: dur, side: ko[k], max: Math.round(v * 100), fix: `대부분의 시간 동안 ${ko[k]} ${Math.round(v * 100)}%가 비어 있다. 이 포맷의 배치 표를 따로 두고 내용을 키우거나 옮긴다(크롭 말고 재배치). 의도면 Stage.allow({ fill: true })` }, 'fill');
      else if (v > TH.marginNote) notes.push(`구도: ${ko[k]} 여백 ${Math.round(v * 100)}% (시간 중앙값) — 넓은 편`);
    }
  } else notes.push('구도: 윤곽이 있는 내용을 찾지 못했다 (아주 부드러운 그림이면 정상)');

  // 결정성 2·3: 콜드 비교, 뒤섞은 순서로 다시 그리기
  const det = [];
  const ci = S.findIndex((s) => s.t === coldT);
  if (ci >= 0 && S[ci].f.h !== cold.h) det.push({ t: coldT, how: '처음 그린 프레임이 나중에 그린 같은 시각과 다르다 (첫 렌더·텍스처 업로드·폰트 로딩에 기대는 코드)' });
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const pick = S.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, Math.min(24, S.length));
  for (const i of pick) {
    const again = window.__grab(S[i].t, false);
    if (fnv(again) !== S[i].f.h) det.push({ t: S[i].t, how: '뒤섞은 순서로 그리면 다르다 (이전 프레임에 기대는 누적 상태·캐시)' });
  }
  for (const how of [...new Set(det.map((d) => d.how))]) {
    const ts = det.filter((d) => d.how === how).map((d) => d.t).sort((a, b) => a - b);
    issues.push({ kind: 'determinism', from: ts[0], to: ts[0], how: `${how} — ${ts.length}개 시각: ${ts.slice(0, 8).map((t) => t.toFixed(2)).join(', ')}${ts.length > 8 ? ' …' : ''}`,
      fix: 'draw 안의 모든 값을 t로부터 계산하게 고친다(draw 밖 변수에 더하거나 이전 프레임 결과를 쓰지 않는다). 시뮬레이션이면 Stage.film 안에서 0초부터 미리 계산해 표로 꺼내 쓴다' });
  }

  // 루프 이음새
  let seam = null;
  if (loop) {
    const dt = 1 / fps;
    const a = grab(dur - 2 * dt), b = grab(dur - dt), c = grab(0), d = grab(dt);
    const typical = Math.max(0.3, (diff(a, b) + diff(c, d)) / 2), jump = diff(b, c);
    seam = { jump: Math.round(jump * 100) / 100, typical: Math.round(typical * 100) / 100 };
    if (jump > typical * TH.seam) add('seam', { from: r3(dur - dt), to: 0, max: Math.round(jump / typical * 10) / 10, fix: '마지막 프레임 → 첫 프레임이 평소 한 프레임 변화보다 크게 튄다. 루프 값은 loopTrack으로, 끝 상태 = 처음 상태(위치·속도 포함)' }, 'seam');
  }

  // 그림: motion.png — 시간에 따른 변화량 (회색 = 프레임 사이, 파랑 = 1초 사이, 빨강 띠 = 문제 구간)
  const GW = 960, GH = 220, gc = document.createElement('canvas'); gc.width = GW; gc.height = GH;
  const gg = gc.getContext('2d');
  gg.fillStyle = '#151515'; gg.fillRect(0, 0, GW, GH);
  const X = (t) => t / dur * GW;
  gg.fillStyle = 'rgba(255,70,70,.28)';
  for (const x of issues) if (x.to > x.from && x.kind !== 'fill') gg.fillRect(X(x.from), 0, Math.max(2, X(x.to) - X(x.from)), GH);
  const maxD1 = Math.max(1e-3, ...S.map((s) => s.d1)), maxD = Math.max(TH.still * 20, ...S.map((s) => s.d));
  const line = (key, max, color) => { gg.strokeStyle = color; gg.lineWidth = 2; gg.beginPath(); S.forEach((s, i) => { const y = GH - 18 - (s[key] / max) * (GH - 36); i ? gg.lineTo(X(s.t), y) : gg.moveTo(X(s.t), y); }); gg.stroke(); };
  line('d1', maxD1, '#5aa0ff'); line('d', maxD, '#bbbbbb');
  gg.fillStyle = '#888'; gg.font = '12px "Geist Mono", monospace';
  for (let t = 0; t <= dur; t += 1) gg.fillText(`${t}s`, X(t) + 2, GH - 4);
  gg.fillText('회색: 프레임 사이 변화 · 파랑: 1초 사이 변화 · 빨강: 문제 구간', 8, 14);

  return {
    pass: issues.length === 0, issues, notes, allowed, fill, seam,
    samples: S.length, step,
    curve: S.map((s) => ({ t: s.t, d: Math.round(s.d * 100) / 100, d1: Math.round(s.d1 * 1000) / 1000, mean: Math.round(s.mean) })),
    images: { motion: gc.toDataURL('image/png') },
  };
}
