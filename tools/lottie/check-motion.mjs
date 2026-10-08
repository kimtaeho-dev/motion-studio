#!/usr/bin/env node
// 출처: diffusionstudio/lottie (MIT, tools/lottie/LICENSE-diffusionstudio-lottie)를 lottie-studio에서 다듬은 것. tools/lottie.mjs check가 부른다.
// 브라우저 없이, 키프레임 베지어 이징 자체의 수학적 성질을 점검한다.
//
//   node tools/lottie/check-motion.mjs <lottie.json...>
//
// 배경: travel-balanced 이징(1.00,.49,.00,.55)이 실제로 재생 중 값이 순간
// 튀는 버그였다. 원인은 시간축 함수 x(u)의 도함수 dx/du 가 구간 "중간"
// (u=0.5)에서 정확히 0이 되는 것 — 실제 시간은 멈춰있는데 값만 계속
// 바뀌는 구간이 생겨서, 재생 시 그 부분이 순간적으로 튄다.
//
// 반대로 dx/du 가 구간 "경계"(u=0 또는 u=1)에서 0이 되는 건 정상이다 —
// "천천히 시작해서 가속" 같은 흔한 이징 모양이고(예: settle-soft), 끝에서
// 부드럽게 멈추는 것도 마찬가지다. 그래서 이 스크립트는 dx/du 의 최솟값이
// 구간 "내부"에서 나오는 경우만 문제로 본다.
//
// 정지 프레임 몇 개만 보는 프리뷰 체크로는 이걸 못 잡는다 — 값 자체는
// 구간 끝에서 정상 범위 안에 있고, 문제는 그 사이 어딘가에서 순간적으로
// 일어나기 때문이다.

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const INTERIOR_MARGIN = 0.03; // u가 이 값보다 경계에 가까우면 "경계"로 본다
const MIN_SLOPE_THRESHOLD = 0.05; // dx/du 가 이 아래로 떨어지면 SNAP 후보
const DY_ALIVE_THRESHOLD = 0.05; // 그 지점에서 dy/du 가 이 이상이면 "값은 계속 움직인다"

// 3차 베지어 x(u)(또는 y(u))의 도함수: dx/du = 3(1-u)^2*ox + 6(1-u)u(ix-ox)
// + 3u^2(1-ix). y 에도 같은 형태를 oy/iy 로 적용한다.
function bezierDeriv(u, p1, p2) {
  return 3 * (1 - u) ** 2 * p1 + 6 * (1 - u) * u * (p2 - p1) + 3 * u ** 2 * (1 - p2);
}

// x(u) 의 도함수가 최소가 되는 지점을 찾고, 그 "같은 시각(u)"에 y(u) 의
// 도함수가 얼마나 살아있는지 함께 본다. dx/du 만 0에 가까운데 그 자리에서
// dy/du 는 여전히 크면(=시간은 멈췄는데 값은 계속 바뀜) 진짜 스냅이다.
// 반대로 dx/du 와 dy/du 가 같이 0으로 떨어지면(예: 회전 스피너의 선형
// 이징 표현) 정상 — 그 지점에서 dy/dx 는 잘 정의된 유한한 값이다.
function findSnap(ox, oy, ix, iy, samples = 2000) {
  let minDx = Infinity;
  let argmin = 0;
  for (let s = 0; s <= samples; s++) {
    const u = s / samples;
    const dx = bezierDeriv(u, ox, ix);
    if (dx < minDx) {
      minDx = dx;
      argmin = u;
    }
  }
  const dyAtArgmin = bezierDeriv(argmin, oy, iy);
  return { minDx, argmin, dyAtArgmin };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isKeyframeArray(arr) {
  return Array.isArray(arr) && arr.length >= 2 && arr.every((k) => isPlainObject(k) && typeof k.t === "number" && Array.isArray(k.s));
}

function findAnimatedProps(doc) {
  const found = [];
  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (!isPlainObject(value)) return;
    if (value.a === 1 && isKeyframeArray(value.k)) {
      found.push({ path, keyframes: value.k });
    }
    for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  }
  walk(doc, "$");
  return found;
}

function checkProp(prop) {
  const findings = [];
  const { keyframes } = prop;
  for (let idx = 0; idx < keyframes.length - 1; idx++) {
    const kf = keyframes[idx];
    if (!kf.o || !kf.i) continue; // 짝 안 맞는 건 check-lottie-web-compat.mjs 가 이미 BLOCK
    const dims = kf.o.x.length;
    for (let d = 0; d < dims; d++) {
      const ox = kf.o.x[d] ?? kf.o.x[0];
      const oy = kf.o.y[d] ?? kf.o.y[0];
      const ix = kf.i.x[d] ?? kf.i.x[0];
      const iy = kf.i.y[d] ?? kf.i.y[0];
      const { minDx, argmin, dyAtArgmin } = findSnap(ox, oy, ix, iy);
      const isInterior = argmin > INTERIOR_MARGIN && argmin < 1 - INTERIOR_MARGIN;
      const valueStillMoving = Math.abs(dyAtArgmin) > DY_ALIVE_THRESHOLD;
      if (isInterior && minDx < MIN_SLOPE_THRESHOLD && valueStillMoving) {
        findings.push({
          segment: `t:${kf.t}→${keyframes[idx + 1].t}`,
          dim: d,
          ox: ox.toFixed(2),
          ix: ix.toFixed(2),
          minDx: minDx.toFixed(4),
          argmin: argmin.toFixed(3),
          dyAtArgmin: dyAtArgmin.toFixed(4),
        });
      }
    }
  }
  return findings;
}

function checkFile(file) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const props = findAnimatedProps(doc);
  const allFindings = [];
  for (const prop of props) {
    for (const f of checkProp(prop)) allFindings.push({ ...f, prop: prop.path });
  }
  return { file, propCount: props.length, findings: allFindings };
}

/**
 * A shell that finds no matches passes the glob through literally, which would
 * otherwise be reported as an unreadable file. An empty studio is a normal
 * state — nothing to check is not a failure.
 */
function dropUnexpandedGlobs(paths) {
  return paths.filter((file) => !/[*?]/.test(file) || existsSync(file));
}

const requested = process.argv.slice(2);
if (requested.length === 0) {
  console.error("사용법: node tools/lottie/check-motion.mjs <lottie.json...>");
  process.exit(2);
}

const files = dropUnexpandedGlobs(requested);
if (files.length === 0) {
  console.log("검사할 씬이 없다.");
  process.exit(0);
}

let totalFindings = 0;
for (const file of files) {
  const rel = relative(process.cwd(), file);
  const result = checkFile(file);
  console.log(rel || file);
  console.log(`  애니메이션 프로퍼티 ${result.propCount}개 검사`);
  if (result.findings.length === 0) {
    console.log("  통과 — 구간 내부에서 시간축이 멈추는 지점을 찾지 못했다.");
  } else {
    for (const f of result.findings) {
      console.log(`  SNAP ${f.prop} [dim ${f.dim}] ${f.segment}`);
      console.log(`        o.x=${f.ox}, i.x=${f.ix} → 구간 내부 u=${f.argmin}에서 dx/du=${f.minDx}(거의 정지)인데 dy/du=${f.dyAtArgmin}(값은 계속 움직임) — 실제 재생 시 그 지점에서 값이 순간적으로 튄다.`);
    }
    totalFindings += result.findings.length;
  }
  console.log("");
}

if (totalFindings > 0) {
  console.log(`총 ${totalFindings}건 — 해당 이징 값을 확인하고 travel-balanced 처럼 대칭적인 값으로 교체할 것.`);
  process.exit(1);
}
console.log("전체 통과.");
