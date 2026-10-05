/*
 * stage3d-inspect.js — 3D 장면 검사. `node tools/render.mjs films/<이름> --check3d`가 렌더 페이지 안에서 불러 쓴다.
 * 필름 코드는 이 파일을 불러오지 않는다.
 *
 * 시간을 촘촘히 훑으며 물체(W.add로 넣은 것)마다 본다:
 *   파고듦   — 물체끼리 실제로 겹친 깊이 (볼록 껍질끼리 접촉 거리, Rapier)
 *   바닥 아래 — 바닥면보다 내려간 깊이
 *   가림     — 화면에서 다른 물체에 가려진 비율 (물체별 색으로 그린 ID 패스)
 *   잘림     — 화면 밖으로 나간 비율
 * 그리고 그림 두 장: views.png(정면·옆·위, 문제 시각), motion.png(물체별 높이·속도 그래프).
 */
import * as THREE from 'three';
import { physicsReady, rapier } from './stage3d-physics.js';

const TOL = { penetrate: 0.02, below: 0.025, occluded: 0.2, cropped: 0.03, minArea: 0.002 };

export async function check({ dur, bpm, beatOffset = 0, step = 1 / 30 }) {
  const { worlds, getRenderer, meshShapes } = window.__stage3d || {};
  const W = worlds && worlds[worlds.length - 1];
  if (!W) throw new Error('3D 장면(world)이 없는 필름입니다');
  await physicsReady();
  const R = rapier();
  const r = getRenderer();
  const times = [];
  for (let t = 0; t < dur - 1e-6; t += step) times.push(Math.round(t * 1000) / 1000);

  window.seek(0);
  const objs = W.objects();
  const names = objs.map((o, i) => o.name || `물체${i + 1}`);
  const n = objs.length;
  const samples = [];
  const idPass = makeIdPass(W, r, objs);

  for (const t of times) {
    window.seek(t);
    W.scene.updateMatrixWorld(true);
    const boxes = objs.map((o) => new THREE.Box3().setFromObject(o, true));   // 정점 기준 (회전해도 부풀지 않게)
    const s = { t, pos: [], minY: [], pen: [], below: [], vis: null, ndc: [], boxes };
    for (let i = 0; i < n; i++) {
      const c = boxes[i].getCenter(new THREE.Vector3());
      s.pos.push([c.x, c.y, c.z]);
      s.minY.push(boxes[i].isEmpty() ? null : boxes[i].min.y);
      s.ndc.push(boxes[i].isEmpty() ? null : ndcBox(boxes[i], W.camera));
      if (W.floor && !boxes[i].isEmpty()) {
        const d = W.ground - boxes[i].min.y;
        if (d > TOL.below) s.below.push({ i, depth: d });
      }
    }
    // 파고듦: 상자가 겹치는 쌍만 정밀하게
    let shapes = null;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (boxes[i].isEmpty() || boxes[j].isEmpty() || !boxes[i].clone().expandByScalar(TOL.penetrate).intersectsBox(boxes[j])) continue;
      shapes ||= objs.map((o) => worldShapes(o, meshShapes, R));
      let worst = Infinity, normal = null;
      for (const a of shapes[i]) for (const b of shapes[j]) {
        const hit = a.shape.contactShape(a.pos, IDQ, b.shape, b.pos, IDQ, 0.05);
        if (hit && hit.distance < worst) { worst = hit.distance; normal = [hit.normal1.x, hit.normal1.y, hit.normal1.z]; }
      }
      if (worst < -TOL.penetrate) s.pen.push({ i, j, depth: -worst, normal });
    }
    s.vis = idPass.measure();
    samples.push(s);
  }
  idPass.dispose();

  // ── 구간으로 묶기 ──
  const issues = [], offscreen = [];
  const spans = (pick) => {
    const out = [];
    let cur = null;
    samples.forEach((s, k) => {
      const v = pick(s);
      if (v != null) {
        // 0.1초 이내로 끊긴 건 한 구간 (튐 등)
        if (cur && k - cur.k <= Math.round(0.1 / step) + 1) { cur.to = s.t; cur.k = k; if (v.value > cur.max) Object.assign(cur, { max: v.value, at: s.t, atK: k, extra: v.extra }); }
        else { cur = { from: s.t, to: s.t, k, max: v.value, at: s.t, atK: k, extra: v.extra }; out.push(cur); }
      }
    });
    return out.map(({ k, ...rest }) => rest);
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    for (const sp of spans((s) => { const p = s.pen.find((p) => p.i === i && p.j === j); return p ? { value: p.depth, extra: p.normal } : null; }))
      issues.push({ kind: 'penetrate', a: names[i], b: names[j], i, j, ...sp });
  }
  for (let i = 0; i < n; i++) {
    for (const sp of spans((s) => { const p = s.below.find((p) => p.i === i); return p ? { value: p.depth } : null; }))
      issues.push({ kind: 'below', a: names[i], i, ...sp });
    for (const sp of spans((s) => {
      const v = s.vis[i];
      if (!v || v.area < TOL.minArea || v.occluded < TOL.occluded) return null;
      return { value: v.occluded, extra: names[v.by] };
    })) issues.push({ kind: 'occluded', a: names[i], b: sp.extra, i, j: names.indexOf(sp.extra), ...sp });
    // 잘림: 일부만 보이는 경우. 통째로 화면 밖(등장 전, 퇴장 후)은 문제가 아니라 따로 알려 준다
    for (const sp of spans((s) => {
      const v = s.vis[i];
      return v && v.total > 0 && v.cropped >= TOL.cropped && v.cropped < 0.98 ? { value: v.cropped } : null;
    })) issues.push({ kind: 'cropped', a: names[i], i, ...sp });
    for (const sp of spans((s) => {
      const v = s.vis[i];
      return v && (v.total === 0 || v.cropped >= 0.98) ? { value: 1 } : null;
    })) offscreen.push({ a: names[i], from: sp.from, to: sp.to });
  }
  // 화면 밖에서 들어오거나 나가는 중의 잘림은 등장·퇴장이다 (바로 앞뒤가 통째로 화면 밖)
  const near = (x, y) => Math.abs(x - y) <= step * 1.5;
  const entering = (x) => x.kind === 'cropped' && offscreen.some((o) => o.a === x.a && (near(o.to, x.from) || near(x.to, o.from)));
  for (let k = issues.length - 1; k >= 0; k--) if (entering(issues[k])) issues.splice(k, 1);

  const impacts = (window.__stage3dSims || []).flatMap((sim) => sim.impacts);

  // ── 무게감: 바닥에 닿기 직전에 속도가 줄면 "내려앉은" 것 (떨어지는 물체는 닿을 때 가장 빠르다) ──
  if (W.floor) for (let i = 0; i < n; i++) {
    if (objs[i].userData.physics) continue;   // 물리로 떨어지는 건 중력대로 가속한다 (찌그러짐이 중심을 움직여 오탐이 난다)
    const h = samples.map((s) => (s.minY[i] == null ? null : s.minY[i] - W.ground));
    for (let k = 1; k < samples.length; k++) {
      if (h[k - 1] == null || h[k] == null || !(h[k - 1] > 0.03 && h[k] <= 0.03)) continue;   // 닿는 순간
      // 내려오기 시작한 데서부터(최대 1.5초 전) 닿을 때까지의 하강 속도
      const down = (q) => (samples[q - 1].pos[i][1] - samples[q].pos[i][1]) / step;
      let q0 = k;
      while (q0 > 1 && k - q0 < 1.5 / step && down(q0 - 1) > -0.05) q0--;
      const vy = [];
      for (let q = q0; q <= k; q++) vy.push(Math.max(0, down(q)));
      const peak = Math.max(...vy), end = Math.max(vy[vy.length - 1], vy[vy.length - 2] ?? 0);
      if (Math.max(...h.slice(Math.max(0, q0 - 1), k).filter((v) => v != null)) < 0.3) continue;   // 살짝 내려앉는 건 낙하가 아니다
      if (peak > 1.5 && end < peak * 0.6) issues.push({ kind: 'floaty', a: names[i], i, from: samples[k].t, to: samples[k].t, at: samples[k].t, atK: k, max: 1 - end / peak });
    }
  }
  // ── 비트: 물리로 떨어진 물체의 첫 착지가 비트에서 벗어났나 ──
  const beatLen = 60 / bpm, warns = [];
  const firstHits = new Map();
  for (const im of impacts) if (!firstHits.has(im.name)) firstHits.set(im.name, im.t);
  for (const [name, t] of firstHits) {
    const off = t - (beatOffset + Math.round((t - beatOffset) / beatLen) * beatLen);
    if (Math.abs(off) > 0.05) warns.push(`${name} 첫 착지 ${t.toFixed(2)}s가 비트에서 ${off > 0 ? '+' : ''}${off.toFixed(2)}s — land: { at: 비트 }로 맞출 수 있다`);
  }

  // ── 물리 물체끼리(또는 키프레임 물체와)의 접촉: 착지 순간 잠깐 눌리는 건 정상, 계속 끼어 있는 것만 한 줄로 ──
  const phys = (k) => k >= 0 && (objs[k]?.userData.physics || objs[k]?.userData.kinematic);
  const jam = issues.filter((x) => (x.kind === 'penetrate' && phys(x.i) && phys(x.j)) || (x.kind === 'below' && objs[x.i]?.userData.physics));
  for (const x of jam) issues.splice(issues.indexOf(x), 1);
  // 계속 끼어 있는 것만. 바닥은 그림자만 받는 투명한 면이라, 쌓인 무게로 살짝 눌리는 건(0.06 이하) 보이지 않는다
  const stuck = jam.filter((x) => x.to - x.from >= 0.3 && (x.kind !== 'below' || x.max > 0.06));
  if (stuck.length) {
    const who = [...new Set(stuck.flatMap((x) => [x.a, x.b].filter(Boolean)))];
    const worst = stuck.reduce((m, x) => (x.max > m.max ? x : m));
    const top = [...stuck].sort((p, q) => (q.to - q.from) * q.max - (p.to - p.from) * p.max).slice(0, 4)
      .map((x) => `${x.b ? `${x.a}↔${x.b}` : `${x.a} 바닥 아래`} ${x.from.toFixed(1)}–${x.to.toFixed(1)}s ${x.max.toFixed(2)}`);
    issues.push({ kind: 'jam', a: who.join(', '), pairs: top, from: Math.min(...stuck.map((x) => x.from)), to: Math.max(...stuck.map((x) => x.to)), max: worst.max, at: worst.at, atK: worst.atK, i: worst.i, j: worst.j, count: who.length });
  }

  // ── 담김·더미의 가림은 정상: 그릇(키프레임 물체) 안에 들어간 물체, 물리로 쌓인 물체끼리 ──
  let natural = 0;
  for (let k = issues.length - 1; k >= 0; k--) {
    const x = issues[k];
    if (x.kind !== 'occluded' || x.j < 0) continue;
    const s0 = samples[x.atK];
    const inside = objs[x.j]?.userData.kinematic && s0 && s0.boxes[x.j].containsPoint(s0.boxes[x.i].getCenter(new THREE.Vector3()));
    if ((objs[x.i]?.userData.physics && objs[x.j]?.userData.physics) || (objs[x.i]?.userData.physics && inside)) { issues.splice(k, 1); natural++; }
  }

  // ── 의도 표시(W.allow)한 것은 실패에서 뺀다. 종류 목록 또는 { 종류: [시작, 끝] } (그 구간만). '코인*'처럼 이름 묶음도 ──
  const covers = (name, x) => {
    const key = Object.keys(W.allowed || {}).find((k) => k === name || (k.endsWith('*') && name.startsWith(k.slice(0, -1))));
    const a = key && W.allowed[key];
    if (!a) return false;
    if (Array.isArray(a)) return a.includes(x.kind);
    const span = a[x.kind];
    return span === true || (Array.isArray(span) && x.from >= span[0] - 1e-6 && x.to <= span[1] + 1e-6);
  };
  const allowed = [];
  for (let k = issues.length - 1; k >= 0; k--) {
    const x = issues[k];
    if (covers(x.a, x) || (x.b && covers(x.b, x))) allowed.push(...issues.splice(k, 1));
  }
  issues.sort((a, b) => a.from - b.from);
  for (const x of issues) x.fix = suggest(x, { W, objs, samples, names, step });
  const notes = (window.__stage3dSims || []).flatMap((sim) => sim.notes);
  const views = drawViews(W, r, objs, names, samples, issues);
  const motion = drawMotion(names, samples, issues, impacts, { dur, bpm, beatOffset, ground: W.floor ? W.ground : null });
  window.seek(0);
  const round = (x) => Math.round(x * 1000) / 1000;
  return {
    objects: names,
    issues: issues.map(({ i, j, atK, extra, ...x }) => ({ ...x, max: round(x.max) })),
    impacts, notes, offscreen, natural,
    warns: warns.length > 3 ? [`물리 착지 ${warns.length}개가 비트에서 벗어남 — 일부러 엇갈린 거면 무시, 아니면 land: { at: 비트 }`] : warns,
    allowed: allowed.map(({ kind, a, b, from, to }) => ({ kind, a, b, from, to })),
    pass: issues.length === 0,
    images: { views, motion },
  };
}

const IDQ = { x: 0, y: 0, z: 0, w: 1 };

/** 상자 8개 꼭짓점을 화면 좌표(-1~1)로: [x0, x1, y0, y1] */
function ndcBox(box, cam) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(x, y, z).project(cam);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  return [x0, x1, y0, y1];
}

/**
 * 물체 i를 move만큼 옮겼을 때 다른 물체와 3D로 겹치지 않고(screen=true면 화면에서도 덜 겹치는) 첫 후보.
 * 그 시각의 경계 상자로 본다 — 정밀하진 않으니 고친 뒤 한 번 더 검사한다.
 */
function freeMove(i, moves, s, W, screen = false) {
  if (!s) return null;
  for (const m of moves) {
    const box = s.boxes[i].clone().translate(new THREE.Vector3(...m));
    if (W.floor && box.min.y < W.ground - 0.025) continue;
    let ok = true;
    for (let j = 0; j < s.boxes.length && ok; j++) {
      if (j === i || s.boxes[j].isEmpty()) continue;
      if (box.clone().expandByScalar(0.02).intersectsBox(s.boxes[j])) ok = false;
      else if (screen) {
        const a = ndcBox(box, W.camera), b = s.ndc[j];
        const ox = Math.min(a[1], b[1]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
        if (ox > 0 && oy > 0 && (ox * oy) / ((a[1] - a[0]) * (a[3] - a[2])) > 0.15) ok = false;
      }
    }
    if (ok && Math.max(...ndcBox(box, W.camera).map(Math.abs)) <= 1) return m;   // 화면 안에 남아야 한다
  }
  return null;
}

/**
 * 고치는 법을 숫자로. AI가 그림을 보고 추측하지 않아도 되게, 코드가 계산할 수 있는 건 계산해 준다.
 */
function suggest(x, { W, objs, samples, names, step }) {
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));
  const s = samples[x.atK];
  const isPhys = (i) => !!objs[i]?.userData.physics;
  switch (x.kind) {
    case 'penetrate': {
      if (isPhys(x.i) || isPhys(x.j)) return '물리 물체: 놓기 전 기다리는 자리끼리 겹치는지, 줄 간격(row의 gap)이 좁은지 본다';
      const n = x.extra || [0, 1, 0], d = x.max + 0.03;
      const pick = freeMove(x.j, [n.map((v) => v * d), [0, 0, -(d + 0.3)], [0, 0, d + 0.3]].filter((v) => v.some((c) => c)), s, W);
      if (pick) return `${x.b}을(를) [${pick.map(f2).join(', ')}]만큼 옮기면 떨어지고 다른 물체와도 안 겹친다 (${x.at.toFixed(2)}s 기준)`;
      const pickA = freeMove(x.i, [n.map((v) => -v * d)], s, W);
      return pickA ? `${x.a}을(를) [${pickA.map(f2).join(', ')}]만큼 옮기면 떨어진다 (${x.at.toFixed(2)}s 기준)` : '옮길 빈자리가 없다 — 배치를 다시 짠다 (물체 수를 줄이거나 화면 범위를 넓힌다)';
    }
    case 'below':
      return isPhys(x.i) ? '물리 물체: 너무 높은 곳에서 떨어지는지(기다리는 높이), squash가 큰지 본다' : `${x.a}의 y를 ${f2(x.max + 0.01)}만큼 올린다 (바닥 = ${W.ground})`;
    case 'cropped': {
      // 잘린 시간 동안 이 물체가 화면 밖으로 가장 많이 나간 정도 → 카메라를 얼마나 물리면 되나
      let over = 1, side = '';
      for (const sm of samples) {
        if (sm.t < x.from - 1e-6 || sm.t > x.to + 1e-6 || !sm.ndc[x.i]) continue;
        const [x0, x1, y0, y1] = sm.ndc[x.i];
        for (const [v, name] of [[-x0, '왼쪽'], [x1, '오른쪽'], [-y0, '아래'], [y1, '위']]) if (v > over) { over = v; side = name; }
      }
      return over > 1 ? `화면 ${side}으로 넘친다. W.fit의 margin(또는 width·height)을 지금의 ${(over / 0.95).toFixed(2)}배로, 또는 ${x.a}을(를) 안쪽으로` : '화면 가장자리에 걸친다. margin을 1.05배로';
    }
    case 'occluded': {
      const a = s?.ndc[x.i], b = s?.ndc[x.j];
      if (!a || !b) return '앞뒤 간격을 벌리거나 옆으로 비킨다';
      const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
      const cam = W.camera, c = new THREE.Vector3(...s.pos[x.i]);
      const perNdc = cam.position.distanceTo(c) * Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
      const dir = (a[0] + a[1]) / 2 >= (b[0] + b[1]) / 2 ? 1 : -1, dx = overlap * perNdc + 0.05;
      // 가까운 쪽부터, 반대쪽, 위로 — 다른 물체와 부딪히거나 새로 가리지 않는 첫 자리
      const pick = freeMove(x.i, [[dir * dx, 0, 0], [-dir * (dx + (b[1] - b[0]) * perNdc), 0, 0], [0, (Math.min(a[3], b[3]) - Math.max(a[2], b[2])) * perNdc / cam.aspect + 0.05, 0]], s, W, true);
      const allow = `의도한 가림이면 W.allow({ ${x.a}: ['occluded'] })`;
      return pick ? `${x.a}을(를) [${pick.map(f2).join(', ')}]만큼 옮기면 ${x.b}에 안 가리고 다른 물체와도 안 겹친다 (${x.at.toFixed(2)}s 기준). ${allow}` : `옮길 빈자리가 없다 — 앞뒤 간격을 벌리거나 배치를 다시 짠다. ${allow}`;
    }
    case 'floaty':
      return '바닥에 닿기 직전 느려진다(둥둥 내려앉음). 스프링 대신 M.drop / M.arc 또는 physics()로 떨어뜨린다';
    case 'jam':
      return '좁은 곳에 너무 많이 떨어져 서로 끼어 있다. pile()로 층별 자리를 잡아 land에 넣거나, 개수를 줄이거나, 그릇을 넓힌다 (위 "물리 설정" 줄 참고)';
  }
  return '';
}
const ZERO = { x: 0, y: 0, z: 0 };

/** 물체의 충돌 모양을 월드 좌표의 점으로 (자세·찌그러짐까지 반영) */
function worldShapes(obj, meshShapes, R) {
  const m = obj.matrixWorld, v = new THREE.Vector3();
  return meshShapes(obj, 300).map((s) => {
    if (s.ball) {
      const c = s.ball.center.clone().applyMatrix4(m), k = new THREE.Vector3().setFromMatrixScale(m);
      return { shape: new R.Ball(s.ball.r * Math.max(k.x, k.y, k.z)), pos: { x: c.x, y: c.y, z: c.z } };
    }
    const p = new Float32Array(s.points.length);
    for (let i = 0; i < p.length; i += 3) { v.set(s.points[i], s.points[i + 1], s.points[i + 2]).applyMatrix4(m); p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z; }
    return { shape: new R.ConvexPolyhedron(p, null), pos: ZERO };
  });
}

/**
 * 가림·잘림: 물체마다 다른 색으로 칠해 작게 그린다. 카메라를 1.6배 넓혀서 화면 밖 부분까지 본다.
 * vis[i] = { area: 화면 중 차지한 비율, occluded: 가려진 비율, by: 가장 많이 가린 물체, cropped: 화면 밖 비율 }
 */
function makeIdPass(W, r, objs) {
  const WIDE = 1.6, size = r.getDrawingBufferSize(new THREE.Vector2());
  const w = 240, h = Math.max(2, Math.round(240 * size.y / size.x));
  const rt = new THREE.WebGLRenderTarget(w, h);
  const mats = objs.map((_, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(((i + 1) * 20) / 255, 0, 0, THREE.LinearSRGBColorSpace) }));
  const buf = new Uint8Array(w * h * 4), all = new Uint8Array(w * h);
  const inner = (x, y) => Math.abs(x + 0.5 - w / 2) < w / 2 / WIDE && Math.abs(y + 0.5 - h / 2) < h / 2 / WIDE;
  const idAt = (k) => Math.round(buf[k * 4] / 20);

  function draw(only) {
    const saved = new Map();
    W.scene.traverse((o) => { if (o.isMesh) { saved.set(o, [o.visible, o.material]); o.visible = false; } });
    objs.forEach((root, i) => {
      if (only != null && only !== i) return;
      root.traverse((m) => { if (m.isMesh && !m.userData.stage3dHelper) { m.visible = saved.get(m)[0]; m.material = mats[i]; } });
    });
    const cam = W.camera.clone();
    cam.zoom = 1 / WIDE; cam.updateProjectionMatrix();
    const prev = { cs: r.outputColorSpace, tm: r.toneMapping, sm: r.shadowMap.enabled };
    r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.shadowMap.enabled = false;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear();
    r.render(W.scene, cam);
    r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    r.setRenderTarget(null);
    Object.assign(r, { outputColorSpace: prev.cs, toneMapping: prev.tm });
    r.shadowMap.enabled = prev.sm;
    for (const [o, [vis, mat]] of saved) { o.visible = vis; o.material = mat; }
  }

  return {
    measure() {
      draw(null);
      for (let k = 0; k < w * h; k++) all[k] = idAt(k);
      const frame = (w / WIDE) * (h / WIDE);
      return objs.map((_, i) => {
        draw(i);
        let total = 0, inside = 0, seen = 0;
        const by = {};
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const k = y * w + x;
          if (idAt(k) !== i + 1) continue;
          total++;
          if (!inner(x, y)) continue;
          inside++;
          if (all[k] === i + 1) seen++;
          else if (all[k] > 0) by[all[k] - 1] = (by[all[k] - 1] || 0) + 1;
        }
        const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
        return {
          area: inside / frame, total,
          occluded: inside ? 1 - seen / inside : 0, by: top ? Number(top[0]) : null,
          cropped: total ? 1 - inside / total : 0,
        };
      });
    },
    dispose() { rt.dispose(); mats.forEach((m) => m.dispose()); },
  };
}

/* ── views.png: 문제 시각마다 정면 · 옆 · 위 ─────────────────────────────────── */
function drawViews(W, r, objs, names, samples, issues) {
  const pick = [];
  const worst = (kind) => issues.filter((x) => x.kind === kind).sort((a, b) => b.max - a.max)[0];
  for (const kind of ['penetrate', 'below', 'occluded', 'cropped']) { const x = worst(kind); if (x && !pick.some((p) => Math.abs(p.t - x.at) < 0.1)) pick.push({ t: x.at, why: label(x) }); }
  if (!pick.length) pick.push({ t: samples[Math.floor(samples.length / 2)].t, why: '문제 없음 — 가운데 시각' });
  pick.splice(4);

  const src = r.domElement, PW = 380, front = window.__canvas;
  const PH = Math.round(PW * front.height / front.width), head = 34, lab = 26, pad = 12;
  const sheet = document.createElement('canvas');
  sheet.width = pad + 3 * (PW + pad);
  sheet.height = pad + head + pick.length * (PH + lab + pad);
  const g = sheet.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '500 13px "Geist Mono", monospace'; g.fillStyle = '#fff'; g.textBaseline = 'top';
  g.fillText('정면 (필름 카메라) · 옆 (오른쪽에서) · 위 (위에서) — 회색 선 = 바닥', pad, pad);

  const ortho = (c, from, up, wSpan, hSpan) => {
    const a = PW / PH, half = Math.max(wSpan / 2, hSpan / 2 * a);
    const cam = new THREE.OrthographicCamera(-half, half, half / a, -half / a, 0.01, 200);
    cam.position.copy(c).add(from.multiplyScalar(50)); cam.up.copy(up); cam.lookAt(c);
    return cam;
  };

  pick.forEach((p, row) => {
    window.seek(p.t);
    // 옆·위 화면의 범위: 그 시각에 화면 안팎의 물체들이 있는 곳 + 바닥
    const bounds = new THREE.Box3();
    for (const o of objs) bounds.union(new THREE.Box3().setFromObject(o, true));
    bounds.expandByScalar(0.5);
    if (W.floor) bounds.min.y = Math.min(bounds.min.y, W.ground - 0.3);
    const c = bounds.getCenter(new THREE.Vector3()), sz = bounds.getSize(new THREE.Vector3());
    const cams = [null, ortho(c, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), sz.z, sz.y), ortho(c, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), sz.x, sz.z)];
    const y = pad + head + row * (PH + lab + pad);
    cams.forEach((cam, col) => {
      const x = pad + col * (PW + pad);
      if (!cam) g.drawImage(front, x, y, PW, PH);
      else {
        const prevSize = r.getSize(new THREE.Vector2());
        r.setSize(PW * 2, PH * 2, false);
        r.render(W.scene, cam);
        g.fillStyle = '#E9E6E0'; g.fillRect(x, y, PW, PH);
        g.drawImage(src, x, y, PW, PH);
        r.setSize(prevSize.x, prevSize.y, false);
        if (W.floor && col === 1) {   // 옆 화면의 바닥선
          const v = new THREE.Vector3(c.x, W.ground, c.z).project(cam);
          g.strokeStyle = '#888'; g.beginPath(); g.moveTo(x, y + (1 - v.y) / 2 * PH); g.lineTo(x + PW, y + (1 - v.y) / 2 * PH); g.stroke();
        }
      }
      // 물체 이름
      const camUse = cam || W.camera;
      g.font = '600 12px Pretendard, "Geist Mono", sans-serif';
      objs.forEach((o, i) => {
        const v = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(camUse);
        if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return;
        const tx = x + (v.x + 1) / 2 * PW, ty = y + (1 - v.y) / 2 * PH;
        const tw = g.measureText(names[i]).width + 8;
        g.fillStyle = 'rgba(17,17,17,.75)'; g.fillRect(tx - tw / 2, ty - 9, tw, 18);
        g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(names[i], tx - tw / 2 + 4, ty);
      });
    });
    g.font = '500 13px "Geist Mono", Pretendard, monospace'; g.textBaseline = 'top'; g.fillStyle = '#ddd';
    g.fillText(`${p.t.toFixed(2)}s — ${p.why}`, pad, y + PH + 6);
  });
  return sheet.toDataURL('image/png');
}

/* ── motion.png: 물체별 바닥 위 높이(파랑)와 속도(회색). 빨간 띠 = 파고듦, 주황 점 = 충돌 ─────── */
function drawMotion(names, samples, issues, impacts, { dur, bpm, beatOffset, ground }) {
  const Wd = 1200, rowH = 96, left = 120, pad = 12, top = 40;
  const sheet = document.createElement('canvas');
  sheet.width = Wd; sheet.height = top + names.length * (rowH + pad) + pad;
  const g = sheet.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '500 13px "Geist Mono", Pretendard, monospace'; g.fillStyle = '#fff'; g.textBaseline = 'top';
  g.fillText('파랑 = 바닥 위 높이 · 회색 = 속도 · 빨강 = 파고듦 · 주황 = 충돌 · 세로선 = 비트', pad, pad);
  const X = (t) => left + (t / dur) * (Wd - left - pad);
  g.font = '400 11px "Geist Mono", monospace'; g.fillStyle = '#888';
  for (let t = 0; t <= dur + 1e-6; t += 1) g.fillText(`${t}s`, X(t) - (t >= dur - 1e-6 ? 18 : 0), top - 14);
  names.forEach((name, i) => {
    const y0 = top + i * (rowH + pad);
    g.fillStyle = '#1b1b1b'; g.fillRect(left, y0, Wd - left - pad, rowH);
    // 비트
    for (let b = 0, t = beatOffset; t < dur; b++, t = beatOffset + (b * 60) / bpm) {
      g.fillStyle = b % 4 === 0 ? '#3a3a3a' : '#262626'; g.fillRect(X(t), y0, 1, rowH);
    }
    for (const x of issues) if (x.kind === 'penetrate' && (x.a === name || x.b === name)) {
      g.fillStyle = 'rgba(255,70,70,.35)'; g.fillRect(X(x.from), y0, Math.max(2, X(x.to) - X(x.from)), rowH);
    }
    const hs = samples.map((s) => (s.minY[i] == null ? 0 : ground == null ? s.pos[i][1] : s.minY[i] - ground));
    const vs = samples.map((s, k) => {
      if (!k) return 0;
      const a = samples[k - 1].pos[i], b = s.pos[i], dt = s.t - samples[k - 1].t;
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt;
    });
    const plot = (vals, color, lo, hi) => {
      g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
      vals.forEach((v, k) => { const px = X(samples[k].t), py = y0 + rowH - 6 - ((v - lo) / (hi - lo || 1)) * (rowH - 12); k ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
    };
    const hMax = Math.max(0.5, ...hs), vMax = Math.max(1, ...vs);
    plot(vs, '#777', 0, vMax);
    plot(hs, '#5b8cff', Math.min(0, ...hs), hMax);
    for (const im of impacts) if (im.name === name) { g.fillStyle = '#ff9f43'; g.beginPath(); g.arc(X(im.t), y0 + rowH - 6, 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#ddd'; g.textBaseline = 'top'; g.font = '600 13px Pretendard, sans-serif';
    g.fillText(name, pad, y0 + 4);
    g.font = '400 11px "Geist Mono", monospace'; g.fillStyle = '#888';
    g.fillText(`높이 ≤ ${hMax.toFixed(2)}`, pad, y0 + 26);
    g.fillText(`속도 ≤ ${vMax.toFixed(1)}/s`, pad, y0 + 42);
  });
  return sheet.toDataURL('image/png');
}

function label(x) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  switch (x.kind) {
    case 'penetrate': return `${x.a} ↔ ${x.b} 파고듦 ${x.max.toFixed(3)}`;
    case 'below': return `${x.a} 바닥 아래 ${x.max.toFixed(3)}`;
    case 'occluded': return `${x.a}이(가) ${x.b}에 ${pct(x.max)} 가려짐`;
    case 'cropped': return `${x.a} ${pct(x.max)} 화면 밖`;
  }
  return x.kind;
}
export { label };
