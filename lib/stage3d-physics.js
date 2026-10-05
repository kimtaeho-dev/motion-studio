/*
 * stage3d-physics.js — 물리를 "미리 구워서" 쓴다. (Rapier, 결정적 빌드: lib/rapier)
 *
 * 물리 엔진은 앞 프레임을 이어받아 계산하지만, 필름은 t만 보고 바로 그려야 한다(렌더 계약).
 * 그래서 Stage.film 함수 안에서 0초부터 끝까지 1/960초 간격으로 한 번 돌려 모든 자세를 표로 만들고,
 * draw(t)는 그 표에서 꺼내 쓰기만 한다. 같은 입력이면 같은 표 → 여전히 t의 순수 함수.
 *
 *   import { world, physics, physicsReady, ... } from '../../lib/stage3d.js';
 *   await physicsReady();
 *   Stage.film((film) => {
 *     const W = world();
 *     W.add({ 폰: ph, 캡슐: cap, 공: ball });
 *     const sim = physics(W, { feel: 'snappy' });
 *     sim.kinematic(ph, (t) => ({ pos: [0, lift(t), 0], rot: [0, turn(t), 0] }));   // 키프레임으로 움직이는 물체도 부딪힌다
 *     sim.body(cap, { pos: [1, 3, 0], at: T.drop, land: { at: T.hit, pos: [0.8, 0.2] } });  // T.hit 비트에 그 자리에 떨어진다
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

let R = null;
/** 겹침 검사(stage3d-inspect.js)가 쓰는 Rapier */
export const rapier = () => R;
// 겹침 검사가 충돌 기록(impacts)을 그래프에 찍을 수 있게. film.json이 바뀌면 다시 만든다.
const sims = (window.__stage3dSims = []);
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
  const bodies = [], kins = [];
  let baked = null;

  /** 물체를 holder 그룹에 넣는다: holder가 위치와 착지 찌그러짐, 물체가 회전을 맡는다. */
  function wrap(obj) {
    const holder = new THREE.Group();
    holder.name = obj.name;
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

  function colliders(world, rb, shapes, { density = 1, friction, bounce }) {
    for (const s of shapes) {
      const desc = s.ball
        ? R.ColliderDesc.ball(s.ball.r).setTranslation(s.ball.center.x, s.ball.center.y, s.ball.center.z)
        : R.ColliderDesc.convexHull(s.points);
      if (!desc) continue;   // 껍질이 안 만들어지는 점 묶음(일직선 등)
      desc.setDensity(density).setFriction(friction).setRestitution(bounce);
      world.createCollider(desc, rb);
    }
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
     *   pos, rot      : 놓기 전 자리 (rot은 [x,y,z] 라디안)
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
      const rest = { pos: o.pos ? new THREE.Vector3(...o.pos) : obj.position.clone(), quat: o.rot ? toQuat(o.rot) : obj.quaternion.clone() };
      const holder = wrap(obj);
      const { shapes, support } = shapesFor(obj);
      const hold = o.hold ? (t) => poseOf(o.hold(t)) : () => rest;
      let at = o.at ?? 0;
      if (o.land && o.at === undefined) {
        // 그냥 떨어뜨려서 land.at에 닿으려면 언제 놓아야 하나: 낙하 높이 h = ½gT²
        const p = hold(o.land.at), cy = (o.land.on ?? W.ground) + reach(support, p.quat, new THREE.Vector3(0, -1, 0));
        at = o.land.at - Math.sqrt(Math.max(0, 2 * (p.pos.y - cy) / g));
      }
      bodies.push({
        obj, holder, shapes, support, name: obj.name || `물체${bodies.length + 1}`,
        at, hold,
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
      kins.push({ obj, fn: (t) => poseOf(fn(t)), shapes });
      baked = null;
      return sim;
    },

    /** 0초부터 dur초까지 미리 계산한다. land를 준 물체는 착지 시각이 맞도록 몇 번 다시 돈다. */
    bake(dur) {
      for (const b of bodies) if (b.land) b.landT = b.land.at - b.at;
      run(dur);
      for (let k = 0; k < 3; k++) {
        let off = false;
        for (const b of bodies) {
          if (!b.land) continue;
          const hit = b.hits.find((h) => h.t > b.at + 0.02);
          const err = hit ? hit.t - b.land.at : 0;
          if (Math.abs(err) > 0.5 / hz) { b.landT -= err; off = true; }
        }
        if (!off) break;
        run(dur);
      }
      sim.notes = bodies.filter((b) => b.note).map((b) => b.note);
      sim.impacts = bodies.flatMap((b) => b.hits.map((h) => ({ t: h.t, name: b.name, speed: Math.round(h.speed * 10) / 10 }))).sort((a, b) => a.t - b.t);
      baked = { dur };
      return sim;
    },

    /** t초의 자세를 물체에 적용한다. draw 맨 앞에서 부른다. */
    apply(t) {
      if (!baked) throw new Error('[stage3d] physics: apply 전에 sim.bake(film.dur)');
      for (const k of kins) { const p = k.fn(t); k.obj.position.copy(p.pos); k.obj.quaternion.copy(p.quat); }
      for (const b of bodies) {
        let pos, quat;
        if (t < b.at) { const p = b.hold(t); pos = p.pos; quat = p.quat; }
        else {
          const f = Math.min(Math.max(t * hz, 0), b.n), i = Math.min(Math.floor(f), b.n - 1), a = f - i, T = b.table;
          const j = i * 7, k = j + 7;
          pos = _p.set(T[j] + (T[k] - T[j]) * a, T[j + 1] + (T[k + 1] - T[j + 1]) * a, T[j + 2] + (T[k + 2] - T[j + 2]) * a).clone();
          quat = _q.set(T[j + 3], T[j + 4], T[j + 5], T[j + 6]).slerp(_q2.set(T[k + 3], T[k + 4], T[k + 5], T[k + 6]), a).clone();
        }
        // 착지 찌그러짐: 가장 센 최근 충돌 하나를, 닿은 면 쪽을 기준점으로
        let s = 0, normal = null;
        if (b.squash > 0) for (const h of b.hits) {
          const tau = t - h.t;
          if (tau < 0 || tau > 0.5) continue;
          const v = b.squash * Math.min(1.2, h.speed / 30) * Math.exp(-tau / 0.06) * Math.cos(tau * Math.PI * 2 / 0.16);
          if (Math.abs(v) > Math.abs(s)) { s = v; normal = h.normal; }
        }
        const { holder, obj } = b;
        if (Math.abs(s) < 1e-3) {
          holder.position.copy(pos); holder.quaternion.identity(); holder.scale.setScalar(1);
          obj.position.set(0, 0, 0); obj.quaternion.copy(quat);
        } else {
          _n.copy(normal);
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

  function run(dur) {
    const world = new R.World({ x: 0, y: -g, z: 0 });
    world.timestep = 1 / hz;
    // 센 중력에서도 착지 순간 파고들지 않게 단단하게. (lengthUnit은 기본값 그대로 — 우리 단위로 키우면
    // 예측 접촉 여유가 커져서, 옆 물체 모서리를 스치며 떨어질 때 닿지도 않았는데 옆으로 튕긴다)
    world.numSolverIterations = 12;
    world.integrationParameters.maxCcdSubsteps = 4;
    world.integrationParameters.contact_natural_frequency = 60;
    if (W.floor) world.createCollider(R.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, W.ground - 1, 0).setFriction(0.7).setRestitution(0.3));
    if (walls) {
      const [x0, x1] = walls.x || [-50, 50], [z0, z1] = walls.z || [-50, 50], cy = W.ground + 50;
      for (const [x, z, hx, hz2] of [[x0 - 1, (z0 + z1) / 2, 1, 100], [x1 + 1, (z0 + z1) / 2, 1, 100], [(x0 + x1) / 2, z0 - 1, 100, 1], [(x0 + x1) / 2, z1 + 1, 100, 1]])
        world.createCollider(R.ColliderDesc.cuboid(hx, 50, hz2).setTranslation(x, cy, z));
    }
    const setPose = (rb, p, next) => {
      if (next) { rb.setNextKinematicTranslation(p.pos); rb.setNextKinematicRotation(p.quat); }
      else { rb.setTranslation(p.pos, true); rb.setRotation(p.quat, true); }
    };
    for (const k of kins) {
      k.rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      setPose(k.rb, k.fn(0));
      colliders(world, k.rb, k.shapes, { friction: F.friction, bounce: F.bounce });
    }
    const n = Math.ceil(dur * hz);
    for (const b of bodies) {
      b.n = n; b.table = new Float32Array((n + 1) * 7); b.hits = []; b.released = false;
      b.rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setCcdEnabled(true).setCanSleep(true).setLinearDamping(b.damp[0]).setAngularDamping(b.damp[1]));
      setPose(b.rb, b.hold(0));
      colliders(world, b.rb, b.shapes, b);
      if (b.upright) b.rb.setEnabledRotations(false, true, false, true);
    }
    const dt = 1 / hz;
    for (let i = 0; i <= n; i++) {
      const t = i * dt;
      for (const b of bodies) {
        const tr = b.rb.translation(), r = b.rb.rotation(), j = i * 7;
        b.table.set([tr.x, tr.y, tr.z, r.x, r.y, r.z, r.w], j);
      }
      if (i === n) break;
      for (const k of kins) setPose(k.rb, k.fn(t + dt), true);
      for (const b of bodies) {
        if (!b.released && t + dt >= b.at) release(b, t);
        else if (!b.released) setPose(b.rb, b.hold(t + dt), true);
      }
      // 막 놓은 물체는 속도가 바뀐 게 충돌이 아니라 놓은 것이니 한 스텝 건너뛴다
      const before = bodies.map((b) => (b.released && t - b.releaseT > dt / 2 ? b.rb.linvel() : null));
      world.step();
      bodies.forEach((b, bi) => {
        const v0 = before[bi];
        if (!v0) return;
        const v1 = b.rb.linvel();
        const dv = new THREE.Vector3(v1.x - v0.x, v1.y - (v0.y - g * dt), v1.z - v0.z), m = dv.length();
        if (m < Math.max(2.5, g * dt * 2)) return;
        const last = b.hits[b.hits.length - 1];
        if (last && t + dt - last.t < 0.06) { if (m > last.speed) Object.assign(last, { speed: m, normal: dv.normalize() }); return; }
        b.hits.push({ t: t + dt, speed: m, normal: dv.normalize() });
      });
    }
    world.free();
  }

  function release(b, t) {
    const p = b.hold(b.at);
    b.rb.setBodyType(R.RigidBodyType.Dynamic, true);
    b.rb.setTranslation(p.pos, true); b.rb.setRotation(p.quat, true);
    let vel = b.vel ? new THREE.Vector3(...b.vel) : null, spin = b.spin ? new THREE.Vector3(...b.spin) : null;
    if (b.land) {
      // 바닥(on)에 닿을 때 중심 높이 = 바닥 + 아래로 가장 멀리 나간 점까지 거리
      const on = b.land.on ?? W.ground, T = Math.max(0.05, b.landT);
      const cy = on + reach(b.support, p.quat, new THREE.Vector3(0, -1, 0));
      vel = new THREE.Vector3((b.land.pos[0] - p.pos.x) / T, (cy - p.pos.y + 0.5 * g * T * T) / T, (b.land.pos[1] - p.pos.z) / T);
      const up = vel.y > 0 ? (vel.y * vel.y) / (2 * g) : 0, fall = Math.sqrt(Math.max(0, 2 * (p.pos.y - cy) / g));
      if (up > 0.5) b.note = `${b.name}: ${b.at.toFixed(2)}s에 놓아 ${b.land.at.toFixed(2)}s에 닿게 하려고 위로 ${up.toFixed(1)}단위 던집니다. 그냥 떨어뜨리려면 at을 빼거나 ${(b.land.at - fall).toFixed(2)}s로`;
      else if (fall - T > 0.05) b.note = `${b.name}: 놓고 ${T.toFixed(2)}s 만에 닿게 하려고 아래로 세게 던집니다. 그냥 떨어지면 ${fall.toFixed(2)}s 걸립니다`;
    }
    if (!vel || !spin) {
      // hold로 움직이던 속도를 이어받는다
      const e = 1 / hz, a = b.hold(b.at - e);
      if (!vel) vel = p.pos.clone().sub(a.pos).multiplyScalar(hz);
      if (!spin) {
        const dq = p.quat.clone().multiply(a.quat.clone().invert());
        const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w))), s = Math.sqrt(1 - dq.w * dq.w) || 1;
        spin = new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(ang * hz * Math.sign(dq.w || 1));
      }
    }
    b.rb.setLinvel(vel, true); b.rb.setAngvel(spin, true);
    b.released = true;
    b.releaseT = t;
  }

  return sim;
}
