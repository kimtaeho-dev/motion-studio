/*
 * stage3d-physics-worker.js — 물리 굽기를 백그라운드에서. 화면(앱 미리보기)이 멈추지 않는다.
 * stage3d-physics.js가 만들고, { id, job }을 받아 { id, result }를 돌려준다.
 */
import { simulate } from './stage3d-physics-core.js';

let R = null;
onmessage = async ({ data: { id, job } }) => {
  try {
    if (!R) { R = await import('./rapier/rapier.mjs'); await R.init(); }
    const result = simulate(job, R);
    postMessage({ id, result }, result.bodies.map((b) => b.table.buffer));
  } catch (e) {
    postMessage({ id, error: String(e && e.stack || e) });
  }
};
