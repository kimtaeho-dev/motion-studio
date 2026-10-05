/*
 * stage3d-physics.js — 물리를 "미리 구워서" 쓴다. (Rapier, 결정적 빌드: lib/rapier)
 *
 * 물리 엔진은 앞 프레임을 이어받아 계산하지만, 필름은 t만 보고 바로 그려야 한다(렌더 계약).
 * 그래서 Stage.film 함수 안에서 0초부터 끝까지 1/960초 간격으로 한 번 돌려 모든 자세를 표로 만들고,
 * draw(t)는 그 표에서 꺼내 쓰기만 한다. 같은 입력이면 같은 표 → 여전히 t의 순수 함수.
 * 계산은 백그라운드(stage3d-physics-worker.js)에서 하고, 같은 입력은 다시 계산하지 않는다. 앱에서 값을 바꿔도
 * 화면이 멈추지 않고, 렌더·검사는 Stage가 계산이 끝날 때까지 기다린다.
 *
 *   import { world, physics, physicsReady, ... } from '../../lib/stage3d.js';
 *   await physicsReady();
 *   Stage.film((film) => {
 *     const W = world();
 *     W.add({ 폰: ph, 캡슐: cap, 공: ball });
 *     W.fit(film, { width: 5, height: 3.5 });            // 카메라를 먼저 잡아 둔다 (pos: 'above'가 쓴다)
 *     const sim = physics(W, { feel: 'snappy' });
 *     sim.kinematic(ph, (t) => ({ pos: [0, lift(t), 0], rot: [0, turn(t), 0] }));   // 키프레임으로 움직이는 물체도 부딪힌다
 *     sim.body(cap, { pos: 'above', land: { at: T.hit, pos: [0.8, 0.2] } });   // 화면 바로 위에서 기다리다 T.hit 비트에 그 자리에 닿는다
 *     sim.body(ball, { pos: [-1, 2, 0], at: T.drop + 0.25, vel: [1.5, 0, 0], bounce: 0.5 });
 *     sim.bake(film.dur);
 *     return { draw(g, t, S) { sim.apply(t); W.fit(S, ...); W.render(g, S); } };
 *   });
 *
 * 단위: 폰 높이 3.04 = 실제 14.7cm → 1단위 ≈ 4.84cm. 중력은 이 크기에 맞춰 자동으로 환산한다.
 * (9.8을 그대로 넣으면 1단위를 1m로 계산해서 건물이 떨어지듯 느려진다.)
 */
import * as THREE from 'three';
import { meshShapes } from './stage3d.js';
import { simulate } from './stage3d-physics-core.js';

let R = null;
/** 겹침 검사(stage3d-inspect.js)가 쓰는 Rapier */
export const rapier = () => R;
// 겹침 검사가 충돌 기록(impacts)을 그래프에 찍을 수 있게. film.json이 바뀌면 다시 만든다.
const sims = (window.__stage3dSims = []);
// 같은 입력으로 구운 결과 (필름 페이지가 살아 있는 동안). 키 = signature()
const bakeCache = new Map();
// 이름별 마지막 결과: 다시 굽는 동안(백그라운드) 물체가 사라지지 않고 이전 움직임을 보여 준다
const lastByName = new Map();

/* ── 백그라운드 굽기: 작업자 하나를 계속 쓴다. 굽는 중에 새 요청이 오면 기다리는 건 가장 최신 하나만 ── */
let worker = null, busy = null, queued = null, seq = 0;
function bakeAsync(job) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try { worker = new Worker(new URL('./stage3d-physics-worker.js', import.meta.url), { type: 'module' }); }
      catch { worker = false; }
      if (worker) worker.onmessage = ({ data }) => {
        const done = busy; busy = null;
        if (done && done.id === data.id) data.error ? done.reject(new Error(data.error)) : done.resolve(data.result);
        if (queued) { const q = queued; queued = null; send(q); }
      };
    }
    if (!worker) return resolve(simulate(job, R));   // Worker를 못 쓰는 곳: 그 자리에서
    const req = { id: ++seq, job, resolve, reject };
    if (busy) { if (queued) queued.resolve(null); queued = req; }   // 밀린 옛 요청은 버린다 (null)
    else send(req);
  });
}
function send(req) { busy = req; worker.postMessage({ id: req.id, job: req.job }); }
if (window.Stage) Stage.hooks.beforeApply.push(() => { sims.length = 0; });
/** Rapier(wasm)를 불러온다. 물리를 쓰는 필름만 Stage.film 밖에서 한 번 await. */
export async function physicsReady() {
  if (R) return;
  const mod = await import(new URL('./rapier/rapier.mjs', import.meta.url).href);
  await mod.init();
  R = mod;
}

const UNIT_M = 0.0484;
/** 실제 중력(단위/s²). 연출 프리셋은 이걸 곱해서 쓴다. M.drop 같은 곡선에도 쓸 수 있다. */
export const G = 9.81 / UNIT_M;

/* 연출된 물리 프리셋. 실제 그대로는 화면에서 둥둥 떠 보인다 — 모션 디자인은 중력을 조금 세게, 착지는 단단하게.
 * snappy(기본) : 프로덕트·UI 오브젝트. 빠르게 떨어지고 짧게 튄다
 * heavy        : 큰 물체, 로고. 더 세게 떨어지고 거의 안 튄다, 잘 안 미끄러진다
 * floaty       : 가벼운 소품, 풍선 느낌. 느리게 (UI엔 쓰지 않는다)
 * real         : 실제 중력
 */
// damp: [공기 저항, 구름 저항] — 이게 없으면 공이 끝없이 굴러 화면 밖으로 나간다
const FEEL = {
  snappy: { g: 1.6, bounce: 0.28, friction: 0.55, damp: [0.15, 1.6] },
  heavy:  { g: 2.2, bounce: 0.1, friction: 0.8, damp: [0.1, 2.5] },
  floaty: { g: 0.5, bounce: 0.4, friction: 0.4, damp: [0.6, 0.8] },
  real:   { g: 1.0, bounce: 0.3, friction: 0.5, damp: [0.02, 0.4] },
};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const toQuat = (rot) => (rot && rot.length === 4 ? new THREE.Quaternion(...rot) : new THREE.Quaternion().setFromEuler(_e.set(...(rot || [0, 0, 0]))));
const poseOf = (p) => ({ pos: new THREE.Vector3(...(p.pos || [0, 0, 0])), quat: toQuat(p.rot) });

export function physics(W, { feel = 'snappy', gravity, hz = 960, walls = null } = {}) {
  if (!R) throw new Error('[stage3d] physics: 먼저 await physicsReady()');
  const F = FEEL[feel];
  if (!F) throw new Error(`[stage3d] physics feel: ${Object.keys(FEEL).join(' | ')}`);
  const g = gravity ?? G * F.g;
  const bodies = [], kins = [], waiting = [];
  let baked = null;

  /** 물체를 holder 그룹에 넣는다: holder가 위치와 착지 찌그러짐, 물체가 회전을 맡는다. */
  function wrap(obj) {
    const holder = new THREE.Group();
    holder.name = obj.name;
    holder.userData.physics = true;
    (obj.parent || W.scene).add(holder);
    holder.add(obj);
    obj.position.set(0, 0, 0); obj.quaternion.identity();
    holder.updateMatrixWorld(true);
    return holder;
  }

  function shapesFor(obj) {
    const shapes = meshShapes(obj);
    if (!shapes.length) throw new Error(`[stage3d] physics: "${obj.name || obj.type}"에 충돌 모양이 없습니다`);
    // 착지 높이·찌그러짐 기준점 계산용 점 (모양마다 최대 120개)
    const support = [];
    for (const s of shapes) {
      if (s.ball) { const { center: c, r } = s.ball; for (const d of [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) support.push(new THREE.Vector3(c.x + d[0], c.y + d[1], c.z + d[2])); continue; }
      const n = s.points.length / 3, step = Math.max(1, Math.floor(n / 120));
      for (let i = 0; i < n; i += step) support.push(new THREE.Vector3(s.points[i * 3], s.points[i * 3 + 1], s.points[i * 3 + 2]));
    }
    return { shapes, support };
  }

  // 회전 q에서 방향 n 쪽으로 가장 멀리 나간 점까지의 거리
  const reach = (support, q, n) => { let m = 0; for (const v of support) m = Math.max(m, _p.copy(v).applyQuaternion(q).dot(n)); return m; };

  const sim = {
    g, hz,
    /** 부딪히고 튄 기록: [{ t, name, speed }] — 비트와 맞는지 확인하거나 연출에 쓴다 */
    impacts: [],
    /** 어색한 설정에 대한 안내 (--check3d 보고서에 나온다) */
    notes: [],

    /**
     * 물리로 움직이는 물체.
     *   pos, rot      : 놓기 전 자리 (rot은 [x,y,z] 라디안). pos: 'above'면 land 자리 바로 위, 화면 밖에서 기다린다
     *                   (Stage.film 함수 안에서 먼저 W.fit(film, ...)을 불러 카메라를 잡아 둔다)
     *   at            : 이 시각에 놓는다 (기본 0, land만 주면 착지 시각에서 거꾸로 계산). 그 전에는 pos/rot 또는 hold(t)대로 있다
     *   hold(t)       : 놓기 전 손으로 움직이는 경로 → 놓는 순간의 속도를 이어받는다 (던지기)
     *   vel, spin     : 놓는 순간 속도 [x,y,z] (단위/s), 회전 속도 [x,y,z] (rad/s)
     *   land          : { at, pos: [x, z], on? } — at 시각에 그 자리 바닥(또는 높이 on)에 닿도록 vel을 계산한다.
     *                   body의 at을 안 주면 "그냥 놓아서 떨어지면 그 시각에 닿는" 놓는 시각을 계산한다 (비트에 착지시키는 기본 방법)
     *   bounce, friction, density : 반발(0~1), 마찰, 밀도 (feel 프리셋이 기본값)
     *   damp          : [공기 저항, 구름 저항] (feel 프리셋이 기본값). 굴러서 멈추는 거리를 정한다
     *   upright       : true면 넘어지지 않는다 (세로축으로만 돈다). 밑이 둥근 글자(S, O)를 세워서 착지시킬 때
     *   squash        : 착지할 때 찌그러지는 정도 (기본 0.06, 금속·유리는 0)
     */
    body(obj, o = {}) {
      if (!obj.parent) W.scene.add(obj);
      // pos/rot을 안 주면 지금 놓인 자리에서 시작한다
      const above = o.pos === 'above';
      if (above && !o.land) throw new Error(`[stage3d] physics: pos: 'above'는 land와 함께 쓴다 (${obj.name || obj.type})`);
      const rest = { pos: above ? new THREE.Vector3() : o.pos ? new THREE.Vector3(...o.pos) : obj.position.clone(), quat: o.rot ? toQuat(o.rot) : obj.quaternion.clone() };
      const holder = wrap(obj);
      const { shapes, support } = shapesFor(obj);
      if (above) {
        // 착지 자리 바로 위, 물체 바닥이 화면 위로 막 벗어나는 높이 (기다리는 자리끼리 겹치지 않게 물체마다 조금씩 엇갈림)
        const [x, z] = o.land.pos, down = reach(support, rest.quat, new THREE.Vector3(0, -1, 0));
        const up = reach(support, rest.quat, new THREE.Vector3(0, 1, 0));
        const side = Math.max(...[[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map((d) => reach(support, rest.quat, new THREE.Vector3(...d))));
        let y = W.skyAt(x, z, down);
        // 먼저 기다리는 물체와 겹치면 그 위로
        for (const p of waiting) if (Math.hypot(p.x - x, p.z - z) < p.side + side + 0.05) y = Math.max(y, p.top + down + 0.1);
        rest.pos.set(x, y, z);
        waiting.push({ x, z, side, top: y + up });
      }
      const hold = o.hold ? (t) => poseOf(o.hold(t)) : () => rest, customHold = !!o.hold;
      // land.on에 물체를 주면 그 위에 쌓는다: 물리 물체면 그 물체의 착지 높이 + 높이, 아니면 지금 윗면
      if (o.land && o.land.on && typeof o.land.on === 'object') {
        const under = bodies.find((x) => x.obj === o.land.on);
        let on;
        if (under) {
          const top = reach(under.support, under.hold(under.at).quat, new THREE.Vector3(0, 1, 0));
          const bottom = reach(under.support, under.hold(under.at).quat, new THREE.Vector3(0, -1, 0));
          on = (under.land?.on ?? W.ground) + bottom + top;
        } else on = new THREE.Box3().setFromObject(o.land.on, true).max.y;
        o = { ...o, land: { ...o.land, on } };
      }
      let at = o.at ?? 0;
      if (o.land && o.at === undefined) {
        // 그냥 떨어뜨려서 land.at에 닿으려면 언제 놓아야 하나: 낙하 높이 h = ½gT²
        const p = hold(o.land.at), cy = (o.land.on ?? W.ground) + reach(support, p.quat, new THREE.Vector3(0, -1, 0));
        at = o.land.at - Math.sqrt(Math.max(0, 2 * (p.pos.y - cy) / g));
      }
      bodies.push({
        obj, holder, shapes, support, name: obj.name || `물체${bodies.length + 1}`,
        at, hold, customHold, above,
        vel: o.vel, spin: o.spin, land: o.land,
        density: o.density ?? 1, friction: o.friction ?? F.friction, bounce: o.bounce ?? F.bounce, squash: o.squash ?? 0.06, damp: o.damp ?? F.damp, upright: !!o.upright,
        hits: [],
      });
      baked = null;
      return sim;
    },

    /** 키프레임(스프링)으로 움직이는 물체. 물리는 이 물체를 밀 수 없지만, 이 물체는 다른 물체를 민다. fn(t) → { pos, rot } */
    kinematic(obj, fn) {
      if (!obj.parent) W.scene.add(obj);
      const save = { p: obj.position.clone(), q: obj.quaternion.clone() };
      obj.position.set(0, 0, 0); obj.quaternion.identity();
      const { shapes } = shapesFor(obj);
      obj.position.copy(save.p); obj.quaternion.copy(save.q);
      obj.userData.kinematic = true;
      kins.push({ obj, fn: (t) => poseOf(fn(t)), shapes });
      baked = null;
      return sim;
    },

    /**
     * 0초부터 dur초까지 미리 계산한다. 계산은 백그라운드에서 하고(앱 화면이 멈추지 않는다), 끝나기 전에는
     * 이전 결과(없으면 놓기 전 자세)를 보여 준다. 렌더·검사는 Stage가 끝날 때까지 기다린다.
     * land를 준 물체는 착지 시각이 맞도록 몇 번 다시 돈다. 입력이 같으면 다시 계산하지 않는다.
     */
    bake(dur) {
      baked = { dur };
      const key = signature(dur);
      const hit = bakeCache.get(key);
      if (hit) { take(hit); return sim; }
      sim.notes = [];
      crowding();
      const crowd = [...sim.notes];
      sim.ready = bakeAsync(makeJob(dur)).then((result) => {
        if (!result) return;   // 더 새 요청에 밀렸다
        const entry = {
          bodies: result.bodies.map((r, i) => ({ ...r, at: bodies[i].at })),
          notes: [...crowd, ...result.bodies.map((r) => r.note).filter(Boolean)],
          impacts: result.bodies.flatMap((r, i) => r.hits.map((h) => ({ t: h.t, name: bodies[i].name, speed: Math.round(h.speed * 10) / 10 }))).sort((a, b) => a.t - b.t),
        };
        bakeCache.set(key, entry);
        if (bakeCache.size > 6) bakeCache.delete(bakeCache.keys().next().value);
        take(entry);
      });
      if (window.Stage) Stage.hooks.pending.push(sim.ready);
      return sim;
    },

    /** t초의 자세를 물체에 적용한다. draw 맨 앞에서 부른다. */
    apply(t) {
      if (!baked) throw new Error('[stage3d] physics: apply 전에 sim.bake(film.dur)');
      for (const k of kins) { const p = k.fn(t); k.obj.position.copy(p.pos); k.obj.quaternion.copy(p.quat); }
      for (const b of bodies) {
        let pos, quat;
        const res = b.table ? b : lastByName.get(b.name);   // 굽는 중이면 이전 결과
        if (t < b.at || !res) { const p = b.hold(t); pos = p.pos; quat = p.quat; }
        else {
          const f = Math.min(Math.max(t * hz, 0), res.n), i = Math.min(Math.floor(f), res.n - 1), a = f - i, T = res.table;
          const j = i * 7, k = j + 7;
          pos = _p.set(T[j] + (T[k] - T[j]) * a, T[j + 1] + (T[k + 1] - T[j + 1]) * a, T[j + 2] + (T[k + 2] - T[j + 2]) * a).clone();
          quat = _q.set(T[j + 3], T[j + 4], T[j + 5], T[j + 6]).slerp(_q2.set(T[k + 3], T[k + 4], T[k + 5], T[k + 6]), a).clone();
        }
        // 착지 찌그러짐: 가장 센 최근 충돌 하나를, 닿은 면 쪽을 기준점으로
        let s = 0, normal = null;
        if (b.squash > 0) for (const h of (res ? res.hits : [])) {
          const tau = t - h.t;
          if (tau < 0 || tau > 0.5) continue;
          const v = b.squash * Math.min(1.2, h.speed / 30) * Math.exp(-tau / 0.06) * Math.cos(tau * Math.PI * 2 / 0.16);
          if (Math.abs(v) > Math.abs(s)) { s = v; normal = h.normal; }
        }
        const { holder, obj } = b;
        // 화면 위에서 기다리는 물체(pos: 'above')는 놓기 직전까지 숨긴다: 안 보이는 곳에 있어도
        // 조명 그림자가 바닥에 미리 비친다 (빈 바닥의 얼룩)
        holder.visible = !b.above || t >= b.at - 0.05;
        holder.userData.waiting = t < b.at - 0.05;   // 검사(구도)가 기다리는 물체를 내용에서 뺀다
        holder.userData.waitingCustom = holder.userData.waiting && !b.above;
        if (Math.abs(s) < 1e-3) {
          holder.position.copy(pos); holder.quaternion.identity(); holder.scale.setScalar(1);
          obj.position.set(0, 0, 0); obj.quaternion.copy(quat);
        } else {
          _n.set(...normal);
          const h = reach(b.support, quat, _n.clone().negate());
          const qn = new THREE.Quaternion().setFromUnitVectors(UP, _n);
          holder.position.copy(pos).addScaledVector(_n, -h);
          holder.quaternion.copy(qn);
          holder.scale.set(1 + s * 0.3, 1 - s, 1 + s * 0.3);   // 옆으로는 조금만 (이웃과 닿지 않게)
          obj.position.set(0, h, 0);
          obj.quaternion.copy(qn.invert()).multiply(quat);
        }
      }
    },
  };

  sims.push(sim);

  /** 굽기 결과를 물체들에 넣는다 */
  function take(entry) {
    bodies.forEach((b, i) => { Object.assign(b, entry.bodies[i]); lastByName.set(b.name, entry.bodies[i]); });
    sim.notes = [...entry.notes];
    sim.impacts = entry.impacts;
  }

  /** vel·spin·land를 숫자로 (three.js 벡터·배열 모두 받는다). 못 바꾸면 무엇이 문제인지 알린다 */
  function plainMotion(b) {
    const vec = (v, what, n = 3) => {
      if (v == null) return null;
      const a = v.isVector3 || v.isEuler ? [v.x, v.y, v.z] : v.isVector2 ? [v.x, v.y] : Array.from(v);
      if (a.length < n || a.slice(0, n).some((x) => typeof x !== 'number' || !isFinite(x))) throw new Error(`[stage3d] physics ${b.name}: ${what}는 숫자 ${n}개여야 한다 (${JSON.stringify(v)})`);
      return a.slice(0, n);
    };
    let land = null;
    if (b.land) {
      if (b.land.on != null && typeof b.land.on !== 'number') throw new Error(`[stage3d] physics ${b.name}: land.on은 높이(숫자)나 다른 물체`);
      land = { at: +b.land.at, pos: vec(b.land.pos, 'land.pos', 2), ...(b.land.on != null ? { on: b.land.on } : {}) };
    }
    return { vel: vec(b.vel, 'vel'), spin: vec(b.spin, 'spin'), land };
  }

  /** 백그라운드로 보낼 숫자 데이터: 모양, 놓기 전 자세, 키프레임 움직임(1/hz마다 미리 계산) */
  function makeJob(dur) {
    const n = Math.ceil(dur * hz);
    const v3 = (v) => [v.x, v.y, v.z], q4 = (q) => [q.x, q.y, q.z, q.w];
    const plainShapes = (shapes) => shapes.map((sh) => (sh.ball ? { ball: { center: v3(sh.ball.center), r: sh.ball.r } }
      : sh.prim ? { prim: { ...sh.prim, center: v3(sh.prim.center), quat: q4(sh.prim.quat) } } : { points: sh.points }));
    const pose = (p) => ({ pos: v3(p.pos), quat: q4(p.quat) });
    const poses = (fn, count) => {
      const a = new Float64Array(count * 7);
      for (let i = 0; i < count; i++) { const p = fn(i / hz); a.set([p.pos.x, p.pos.y, p.pos.z, p.quat.x, p.quat.y, p.quat.z, p.quat.w], i * 7); }
      return a;
    };
    return {
      g, hz, dur, ground: W.floor ? W.ground : null, walls, friction: F.friction, bounce: F.bounce,
      kins: kins.map((k) => ({ shapes: plainShapes(k.shapes), poses: poses(k.fn, n + 1) })),
      bodies: bodies.map((b) => ({
        name: b.name, shapes: plainShapes(b.shapes), support: new Float64Array(b.support.flatMap(v3)),
        ...plainMotion(b),
        at: b.at, hold: b.customHold ? poses(b.hold, Math.min(n, Math.ceil(b.at * hz)) + 2) : poses(b.hold, 1),
        holdAt: pose(b.hold(b.at)), holdPrev: pose(b.hold(b.at - 1 / hz)),
        density: b.density, friction: b.friction, bounce: b.bounce, damp: b.damp, upright: b.upright,
      })),
    };
  }

  /** 굽기에 들어가는 모든 것을 글자로 → 해시. 같으면 같은 결과다(결정적). */
  function signature(dur) {
    const r = (v) => Math.round(v * 1e4) / 1e4;
    const pose = (p) => [p.pos.x, p.pos.y, p.pos.z, p.quat.x, p.quat.y, p.quat.z, p.quat.w].map(r).join(',');
    const shapeSum = (shapes) => shapes.map((sh) => (sh.ball ? `b${r(sh.ball.r)}` : `${sh.prim?.kind || 'h'}${sh.points.length}:${r(sh.points.reduce((a, v, i) => a + v * ((i % 7) + 1), 0))}`)).join('|');
    const parts = [g, hz, dur, F.bounce, F.friction, F.damp.join(), JSON.stringify(walls), W.floor ? W.ground : 'nofloor'];
    for (const k of kins) {
      const samples = [];
      for (let t = 0; t <= dur + 1e-9; t += 1 / 60) samples.push(pose(k.fn(t)));
      parts.push('K', shapeSum(k.shapes), samples.join(';'));
    }
    for (const b of bodies) {
      const holdSamples = [];
      for (let t = 0; t <= Math.min(b.at, dur) + 1e-9; t += 1 / 60) holdSamples.push(pose(b.hold(t)));
      parts.push('B', b.name, b.at, JSON.stringify(b.land || null), JSON.stringify(b.vel || null), JSON.stringify(b.spin || null),
        b.density, b.friction, b.bounce, b.damp.join(), b.upright, pose(b.hold(b.at)), holdSamples.join(';'), shapeSum(b.shapes));
    }
    let h1 = 0x811c9dc5, h2 = 0;
    const str = parts.join('#');
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (h2 * 31 + c) | 0; }
    return `${str.length}:${h1 >>> 0}:${h2 >>> 0}`;
  }

  /** 착지점이 겹치는 물체들: 같은 자리에 떨어지면 서로 끼어 계속 부딪힌다. 굽기 전에 알려 준다. */
  function crowding() {
    const landers = bodies.filter((b) => b.land).map((b) => {
      let r = 0, h = 0;
      for (const v of b.support) { r = Math.max(r, Math.hypot(v.x, v.z)); h = Math.max(h, Math.abs(v.y)); }
      return { b, x: b.land.pos[0], z: b.land.pos[1], on: b.land.on ?? W.ground, r: Math.min(r, Math.max(r * 0.6, h * 2)) };
    });
    const hit = new Set();
    let pairs = 0;
    for (let i = 0; i < landers.length; i++) for (let j = i + 1; j < landers.length; j++) {
      const a = landers[i], c = landers[j];
      if (Math.hypot(a.x - c.x, a.z - c.z) < (a.r + c.r) * 0.9 && Math.abs(a.on - c.on) < 0.05) { pairs++; hit.add(a.b.name); hit.add(c.b.name); }
    }
    if (pairs) sim.notes.push(`같은 높이·같은 자리에 떨어지는 물체 ${hit.size}개(겹치는 착지점 ${pairs}쌍) — 서로 끼어 계속 부딪힌다. pile()로 층을 나눠 자리를 잡거나 개수를 줄인다`);
  }

  return sim;
}
