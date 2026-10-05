/*
 * stage3d-physics-core.js — 물리 굽기의 계산 부분. 숫자 데이터만 받고 숫자 데이터만 돌려준다(three.js 없음).
 * 화면 스레드를 멈추지 않게 stage3d-physics-worker.js가 백그라운드에서 부르고, Worker가 없을 때만
 * stage3d-physics.js가 직접 부른다. 같은 입력이면 어디서 돌려도 같은 결과(Rapier 결정적 빌드).
 *
 * job = {
 *   g, hz, dur, ground (null이면 바닥 없음), walls, friction, bounce,      // feel 프리셋 기본값
 *   kins:   [{ shapes, poses: Float32Array((n+1)*7) }]                       // i/hz 시각의 [x,y,z,qx,qy,qz,qw]
 *   bodies: [{ name, shapes, support: Float32Array, at, hold: Float32Array, holdAt, holdPrev,
 *              vel, spin, land, density, friction, bounce, damp, upright }]
 * }
 * shapes = [{ ball: { center, r } } | { prim: { kind: 'box'|'cylinder', center, quat, half|halfH,r } } | { points }]
 * 결과 = { bodies: [{ table, n, hits: [{ t, speed, normal }], note, landT }] }
 */

const rot = (q, v) => {   // 쿼터니언 q로 벡터 v 회전
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const poseAt = (arr, i) => { const j = i * 7; return { pos: [arr[j], arr[j + 1], arr[j + 2]], quat: [arr[j + 3], arr[j + 4], arr[j + 5], arr[j + 6]] }; };
const V = (a) => ({ x: a[0], y: a[1], z: a[2] });
const Q = (q) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

/** 회전 q에서 방향 n 쪽으로 가장 멀리 나간 점까지의 거리 */
export function reach(support, q, n) {
  let m = 0;
  for (let i = 0; i < support.length; i += 3) {
    const p = rot(q, [support[i], support[i + 1], support[i + 2]]);
    m = Math.max(m, p[0] * n[0] + p[1] * n[1] + p[2] * n[2]);
  }
  return m;
}

export function simulate(job, R) {
  const { g, hz, dur } = job;
  const dt = 1 / hz, n = Math.ceil(dur * hz);
  const bodies = job.bodies.map((b) => ({ ...b, landT: b.land ? b.land.at - b.at : 0 }));

  function colliders(world, rb, shapes, { density = 1, friction, bounce }) {
    for (const s of shapes) {
      let desc;
      if (s.ball) desc = R.ColliderDesc.ball(s.ball.r).setTranslation(...s.ball.center);
      else if (s.prim) {
        const p = s.prim;
        if (p.kind === 'box') desc = R.ColliderDesc.cuboid(...p.half);
        else { const b = Math.min(p.halfH, p.r) * 0.3; desc = R.ColliderDesc.roundCylinder(p.halfH - b, p.r - b, b); }   // 둥근 모서리 원기둥
        desc.setTranslation(...p.center).setRotation(Q(p.quat));
      } else desc = R.ColliderDesc.convexHull(s.points);
      if (!desc) continue;   // 껍질이 안 만들어지는 점 묶음(일직선 등)
      desc.setDensity(density).setFriction(friction).setRestitution(bounce);
      world.createCollider(desc, rb);
    }
  }

  // 놓기 전 자세: hold 배열(i/hz 시각) 안이면 그것, 넘으면 놓는 순간 자세
  const holdPose = (b, i) => (i * 7 < b.hold.length ? poseAt(b.hold, i) : b.holdAt);

  function release(b, rb, t) {
    const p = b.holdAt;
    rb.setBodyType(R.RigidBodyType.Dynamic, true);
    rb.setTranslation(V(p.pos), true); rb.setRotation(Q(p.quat), true);
    let vel = b.vel ? [...b.vel] : null, spin = b.spin ? [...b.spin] : null;
    b.note = null;
    if (b.land) {
      // 바닥(on)에 닿을 때 중심 높이 = 바닥 + 아래로 가장 멀리 나간 점까지 거리
      const on = b.land.on ?? job.ground, T = Math.max(0.05, b.landT);
      const cy = on + reach(b.support, p.quat, [0, -1, 0]);
      vel = [(b.land.pos[0] - p.pos[0]) / T, (cy - p.pos[1] + 0.5 * g * T * T) / T, (b.land.pos[1] - p.pos[2]) / T];
      const up = vel[1] > 0 ? (vel[1] * vel[1]) / (2 * g) : 0, fall = Math.sqrt(Math.max(0, (2 * (p.pos[1] - cy)) / g));
      if (up > 0.5) b.note = `${b.name}: ${b.at.toFixed(2)}s에 놓아 ${b.land.at.toFixed(2)}s에 닿게 하려고 위로 ${up.toFixed(1)}단위 던집니다. 그냥 떨어뜨리려면 at을 빼거나 ${(b.land.at - fall).toFixed(2)}s로`;
      else if (fall - T > 0.05) b.note = `${b.name}: 놓고 ${T.toFixed(2)}s 만에 닿게 하려고 아래로 세게 던집니다. 그냥 떨어지면 ${fall.toFixed(2)}s 걸립니다`;
    }
    if (!vel || !spin) {
      // hold로 움직이던 속도를 이어받는다
      const a = b.holdPrev;
      if (!vel) vel = [0, 1, 2].map((k) => (p.pos[k] - a.pos[k]) * hz);
      if (!spin) {
        const dq = qmul(p.quat, qinv(a.quat));
        const ang = 2 * Math.acos(Math.min(1, Math.abs(dq[3]))), s = Math.sqrt(1 - dq[3] * dq[3]) || 1;
        spin = [dq[0] / s, dq[1] / s, dq[2] / s].map((v) => v * ang * hz * Math.sign(dq[3] || 1));
      }
    }
    rb.setLinvel(V(vel), true); rb.setAngvel(V(spin), true);
    b.released = true;
    b.releaseT = t;
  }

  function run() {
    const world = new R.World({ x: 0, y: -g, z: 0 });
    world.timestep = dt;
    // 센 중력에서도 착지 순간 파고들지 않게 단단하게. (lengthUnit은 기본값 그대로 — 우리 단위로 키우면
    // 예측 접촉 여유가 커져서, 옆 물체 모서리를 스치며 떨어질 때 닿지도 않았는데 옆으로 튕긴다)
    world.numSolverIterations = 12;
    world.integrationParameters.maxCcdSubsteps = 4;
    world.integrationParameters.contact_natural_frequency = 120;   // 쌓인 무게에도 덜 눌리게 (60이면 코인 더미가 서로 파고든다)
    if (job.ground != null) world.createCollider(R.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, job.ground - 1, 0).setFriction(0.7).setRestitution(0.3));
    if (job.walls) {
      const [x0, x1] = job.walls.x || [-50, 50], [z0, z1] = job.walls.z || [-50, 50], cy = (job.ground ?? 0) + 50;
      for (const [x, z, hx, hz2] of [[x0 - 1, (z0 + z1) / 2, 1, 100], [x1 + 1, (z0 + z1) / 2, 1, 100], [(x0 + x1) / 2, z0 - 1, 100, 1], [(x0 + x1) / 2, z1 + 1, 100, 1]])
        world.createCollider(R.ColliderDesc.cuboid(hx, 50, hz2).setTranslation(x, cy, z));
    }
    const setPose = (rb, p, next) => {
      if (next) { rb.setNextKinematicTranslation(V(p.pos)); rb.setNextKinematicRotation(Q(p.quat)); }
      else { rb.setTranslation(V(p.pos), true); rb.setRotation(Q(p.quat), true); }
    };
    const kins = job.kins.map((k) => {
      const rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      setPose(rb, poseAt(k.poses, 0));
      colliders(world, rb, k.shapes, { friction: job.friction, bounce: job.bounce });
      return { rb, poses: k.poses };
    });
    const rbs = bodies.map((b) => {
      b.table = new Float32Array((n + 1) * 7); b.hits = []; b.released = false;
      const rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setCcdEnabled(true).setCanSleep(true).setLinearDamping(b.damp[0]).setAngularDamping(b.damp[1]));
      setPose(rb, holdPose(b, 0));
      colliders(world, rb, b.shapes, b);
      if (b.upright) rb.setEnabledRotations(false, true, false, true);
      return rb;
    });
    for (let i = 0; i <= n; i++) {
      const t = i * dt;
      bodies.forEach((b, bi) => {
        const tr = rbs[bi].translation(), r = rbs[bi].rotation();
        b.table.set([tr.x, tr.y, tr.z, r.x, r.y, r.z, r.w], i * 7);
      });
      if (i === n) break;
      for (const k of kins) setPose(k.rb, poseAt(k.poses, i + 1), true);
      bodies.forEach((b, bi) => {
        if (!b.released && t + dt >= b.at) release(b, rbs[bi], t);
        else if (!b.released) setPose(rbs[bi], holdPose(b, i + 1), true);
      });
      // 막 놓은 물체는 속도가 바뀐 게 충돌이 아니라 놓은 것이니 한 스텝 건너뛴다
      const before = bodies.map((b, bi) => (b.released && t - b.releaseT > dt / 2 ? rbs[bi].linvel() : null));
      world.step();
      bodies.forEach((b, bi) => {
        const v0 = before[bi];
        if (!v0) return;
        const v1 = rbs[bi].linvel();
        const dv = [v1.x - v0.x, v1.y - (v0.y - g * dt), v1.z - v0.z], m = Math.hypot(...dv);
        if (m < Math.max(2.5, g * dt * 2)) return;
        const normal = dv.map((v) => v / m);
        const last = b.hits[b.hits.length - 1];
        if (last && t + dt - last.t < 0.06) { if (m > last.speed) Object.assign(last, { speed: m, normal }); return; }
        b.hits.push({ t: t + dt, speed: m, normal });
      });
    }
    world.free();
  }

  run();
  // 착지 시각 맞추기 (스텝의 절반 오차까지). 느슨하게 하면 빨라지지만 이미 만든 필름의 결과가 바뀐다 —
  // 굽기는 백그라운드에서 하고 결과를 저장해 두므로 그대로 둔다
  for (let k = 0; k < 3; k++) {
    let off = false;
    for (const b of bodies) {
      if (!b.land) continue;
      const first = b.hits.find((h) => h.t > b.at + 0.02);
      const err = first ? first.t - b.land.at : 0;
      if (Math.abs(err) > 0.5 / hz) { b.landT -= err; off = true; }
    }
    if (!off) break;
    run();
  }
  return { bodies: bodies.map(({ table, hits, note, landT }) => ({ table, n, hits, note, landT })) };
}
