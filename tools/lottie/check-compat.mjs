#!/usr/bin/env node
// 출처: diffusionstudio/lottie (MIT, tools/lottie/LICENSE-diffusionstudio-lottie)를 lottie-studio에서 다듬은 것. tools/lottie.mjs check가 부른다.
// Lottie 씬이 lottie-web 5.x SVG 렌더러에서도 미리보기(Skia Skottie)와 같게
// 나오는지 정적으로 검사한다.
//
//   node tools/lottie/check-compat.mjs [--max-kb N] <lottie.json...>
//
// BLOCK 이 하나라도 있으면 exit 1, WARN 만 있으면 exit 0.
// 의존성 없는 순수 Node ESM. 브라우저 없이 돌릴 수 있는 유일한 파리티 게이트다.

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";

const DEFAULT_MAX_KB = 150;
const REQUIRED_TOP_LEVEL = ["v", "fr", "ip", "op", "w", "h", "layers"];

const BLOCK = "BLOCK";
const WARN = "WARN";

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

/**
 * A shell that finds no matches passes the glob through literally, which would
 * otherwise be reported as an unreadable file. An empty studio is a normal
 * state — nothing to check is not a failure.
 */
function dropUnexpandedGlobs(paths) {
  return paths.filter((file) => !/[*?]/.test(file) || existsSync(file));
}

function parseArgs(argv) {
  const files = [];
  let maxKb = DEFAULT_MAX_KB;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-kb") {
      const raw = argv[++i];
      maxKb = readMaxKb(raw);
    } else if (arg.startsWith("--max-kb=")) {
      maxKb = readMaxKb(arg.slice("--max-kb=".length));
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      fail(`알 수 없는 옵션: ${arg}`);
    } else {
      files.push(arg);
    }
  }

  return { files, maxKb };
}

function readMaxKb(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    fail(`--max-kb 값이 올바르지 않다: ${raw ?? "(없음)"}`);
  }
  return n;
}

function usage() {
  console.log(
    [
      "사용법: node tools/lottie/check-compat.mjs [--max-kb N] <lottie.json...>",
      "",
      "  --max-kb N   씬 하나당 허용 용량(KB). 기본 " + DEFAULT_MAX_KB + ", 초과하면 BLOCK.",
      "",
      "BLOCK 이 하나라도 있으면 종료 코드 1.",
    ].join("\n"),
  );
}

function fail(message) {
  console.error(`오류: ${message}`);
  usage();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 규칙
// ---------------------------------------------------------------------------

const RULES = {
  "LW-JSON-PARSE": {
    level: BLOCK,
    text: "JSON 파싱에 실패했다. 플레이어도 이 씬을 열지 못한다.",
  },
  "LW-READ": {
    level: BLOCK,
    text: "파일을 읽지 못했다.",
  },
  "LW-NOT-OBJECT": {
    level: BLOCK,
    text: "최상위가 JSON 객체가 아니다. Lottie 문서가 아니다.",
  },
  "LW-MISSING-FIELD": {
    level: BLOCK,
    text: "최상위 필수 필드가 없다. 플레이어 계약 위반이라 로드 자체가 불안정하다.",
  },
  "LW-SIZE": {
    level: BLOCK,
    text: "씬 용량이 예산을 넘었다. 이미지는 base64 인라인(e:1) 대신 외부 파일로 빼라.",
  },
  "LW-MERGE-PATHS": {
    level: BLOCK,
    text: 'ty:"mm"(머지 패스)는 Skottie는 렌더하지만 lottie-web SVG 렌더러는 무시한다. 도형이 깨진 채 배포된다.',
  },
  "LW-EXPRESSION": {
    level: BLOCK,
    text: "문자열 x 속성(표현식)은 Skottie가 평가하지 않는다. 미리보기와 프로덕션이 조용히 갈린다.",
  },
  "LW-EFFECTS": {
    level: BLOCK,
    text: "ef(이펙트) 배열이 비어있지 않다. 두 렌더러의 이펙트 지원 집합이 서로 다르다.",
  },
  "LW-NATIVE-TEXT": {
    level: BLOCK,
    text: "ty:5(네이티브 텍스트) 레이어다. Skottie는 동봉 폰트 파일, lottie-web은 CSS @font-face로 그린다. 자간·베이스라인이 다르게 잡힌다.",
  },
  "LW-3D-LAYER": {
    level: WARN,
    text: "ddd:1(3D 레이어)이다. Skottie는 실제 3D, lottie-web SVG는 흉내라서 겹침 순서가 달라진다.",
  },
  "LW-BLEND-MODE": {
    level: WARN,
    text: "bm(블렌드 모드)이 0이 아니다. lottie-web은 CSS mix-blend-mode로 매핑해 합성 대상이 달라질 수 있다.",
  },
  "LW-TRACK-MATTE": {
    level: WARN,
    text: "tt(트랙 매트)가 있다. 특히 루마 매트 결과가 두 렌더러에서 다르다.",
  },
  "LW-DASH-STROKE": {
    level: WARN,
    text: "대시 스트로크(st/gs의 d 배열)다. lottie-web에 알려진 이슈가 있다.",
  },
  "LW-MULTI-TRIM": {
    level: WARN,
    text: '한 it 그룹 안에 ty:"tm"(트림 패스)이 2개 이상이다. 적용 순서 해석이 다르다.',
  },
  "LW-KEYFRAME-EASING-SPLIT": {
    level: BLOCK,
    text:
      "키프레임 이징(o/i)이 구간의 시작 키프레임 한쪽에만 있고 짝이 없다. o(out)와 i(in)는 항상 그 구간을 시작하는 키프레임에 함께 있어야 한다 " +
      "(다음 키프레임에 i를 나눠 넣는 건 틀린 형식이다). lottie-web은 이 값을 못 읽으면 해당 레이어를 통째로 렌더링하지 않는데 Skottie는 관대하게 넘어가서, " +
      "미리보기는 멀쩡한데 프로덕션에서만 레이어가 사라진다.",
  },
  "LW-MASK-NO-FEATHER": {
    level: BLOCK,
    text:
      "masksProperties 항목에 x(페더) 필드가 없다. lottie-web은 마스크 생성 중 x.k 를 바로 읽다가 예외를 던지고 그 레이어를 통째로 그리지 않는다 " +
      '(Skottie는 문제없이 렌더한다). 반드시 "x": { "a": 0, "k": 0 } 를 추가해라.',
  },
  "LW-MASK-CUSTOM-PATH": {
    level: WARN,
    text:
      "masksProperties 에 손으로 만든 베지어 패스가 있다. lottie-web의 마스크 렌더러는 정점의 i/o 베지어 핸들을 정점 기준 상대좌표가 아니라 " +
      "절대좌표로 그대로 쓰는 반면 Skottie는 표준대로 상대좌표로 해석해서, 같은 값이 한쪽에서는 맞고 한쪽에서는 뒤틀린다. 직선 위주의 클리핑이면 " +
      "마스크 대신 rc(사각형)+el(원)을 위치·크기 키프레임으로 조합하는 편이 두 렌더러 모두에서 안전하다.",
  },
};

// ---------------------------------------------------------------------------
// 순회
// ---------------------------------------------------------------------------

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lottie 문서를 재귀 순회하며 발견 항목을 모은다.
 * `layers` 배열의 원소만 레이어로 취급한다 — 이펙트 값에도 숫자 `ty`가 있어서
 * 문맥 없이 `ty === 5` 를 보면 네이티브 텍스트로 오검출한다.
 */
function scanDocument(doc) {
  const findings = [];
  const add = (code, path, detail) => findings.push({ code, path, detail });

  for (const key of REQUIRED_TOP_LEVEL) {
    if (doc[key] === undefined || doc[key] === null) {
      add("LW-MISSING-FIELD", "$", `누락: ${key}`);
    }
  }

  walkValue(doc, "$", false, add);
  return findings;
}

function walkValue(value, path, isLayer, add) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkValue(value[i], `${path}[${i}]`, isLayer, add);
    }
    return;
  }
  if (!isPlainObject(value)) return;

  checkObject(value, path, isLayer, add);

  for (const [key, child] of Object.entries(value)) {
    // `layers` 배열의 원소는 레이어다 (최상위, 그리고 프리컴프 asset 안쪽 모두).
    const childIsLayer = key === "layers" && Array.isArray(child);
    walkValue(child, `${path}.${key}`, childIsLayer, add);
  }
}

function checkObject(obj, path, isLayer, add) {
  // --- 레이어 문맥에서만 의미 있는 검사 -------------------------------------
  if (isLayer) {
    if (obj.ty === 5) {
      add("LW-NATIVE-TEXT", path, `nm: ${describeName(obj)}`);
    }
  }

  // --- 어디에 있든 잡아야 하는 검사 -----------------------------------------
  if (Array.isArray(obj.ef) && obj.ef.length > 0) {
    add("LW-EFFECTS", `${path}.ef`, `이펙트 ${obj.ef.length}개`);
  }

  if (obj.ty === "mm") {
    add("LW-MERGE-PATHS", path, `mm 모드 mm:${obj.mm ?? "?"}`);
  }

  if (obj.ddd === 1) {
    add("LW-3D-LAYER", path, isLayer ? `nm: ${describeName(obj)}` : undefined);
  }

  if (typeof obj.bm === "number" && obj.bm !== 0) {
    add("LW-BLEND-MODE", path, `bm:${obj.bm}`);
  }

  if (obj.tt !== undefined && obj.tt !== null) {
    add("LW-TRACK-MATTE", path, `tt:${obj.tt}`);
  }

  if ((obj.ty === "st" || obj.ty === "gs") && Array.isArray(obj.d) && obj.d.length > 0) {
    add("LW-DASH-STROKE", path, `ty:"${obj.ty}", d ${obj.d.length}개`);
  }

  if (Array.isArray(obj.it)) {
    const trims = obj.it.filter((item) => isPlainObject(item) && item.ty === "tm").length;
    if (trims >= 2) {
      add("LW-MULTI-TRIM", `${path}.it`, `트림 패스 ${trims}개`);
    }
  }

  // 표현식은 프로퍼티의 `x` 가 문자열일 때만이다. Lottie 에서 숫자/배열 `x`
  // (키프레임 이징, 분리된 위치 x축)는 정상이므로 문자열만 본다.
  if (typeof obj.x === "string") {
    add("LW-EXPRESSION", `${path}.x`, truncate(obj.x));
  }

  // 키프레임 이징(o/i)은 그 구간을 "시작하는" 키프레임 한쪽에 함께 있어야 한다.
  // 한쪽만 있으면(다음 키프레임에 잘못 나눠 넣은 경우) lottie-web은 해당
  // 레이어를 통째로 그리지 않는다. `t`(시간)와 `s`(구간 시작값)를 함께 가진
  // 객체만 키프레임으로 본다 — 일반 애니메이션 값, 마스크 pt 둘 다 같은 모양.
  if (typeof obj.t === "number" && Array.isArray(obj.s)) {
    const hasO = obj.o !== undefined;
    const hasI = obj.i !== undefined;
    if (hasO !== hasI) {
      add("LW-KEYFRAME-EASING-SPLIT", path, `t:${obj.t}, ${hasO ? "o만 있음" : "i만 있음"}`);
    }
  }

  // 마스크: x(페더) 누락은 lottie-web에서 예외를 던져 레이어가 통째로 안 그려진다.
  // 손으로 만든 패스(v/i/o 직접 작성)는 두 렌더러의 좌표 해석이 달라 WARN.
  if (Array.isArray(obj.masksProperties)) {
    obj.masksProperties.forEach((mask, idx) => {
      if (!isPlainObject(mask)) return;
      const maskPath = `${path}.masksProperties[${idx}]`;
      if (!isPlainObject(mask.x)) {
        add("LW-MASK-NO-FEATHER", maskPath);
      }
      add("LW-MASK-CUSTOM-PATH", maskPath);
    });
  }
}

function describeName(obj) {
  return typeof obj.nm === "string" ? obj.nm : "(이름 없음)";
}

function truncate(str, max = 60) {
  const oneLine = str.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// ---------------------------------------------------------------------------
// 파일 하나 검사
// ---------------------------------------------------------------------------

function checkFile(file, maxKb) {
  const findings = [];
  let bytes = 0;
  let doc = null;

  let raw;
  try {
    bytes = statSync(file).size;
    raw = readFileSync(file, "utf8");
  } catch (err) {
    findings.push({ code: "LW-READ", path: "$", detail: err.message });
    return { file, bytes, doc, findings };
  }

  const kb = bytes / 1024;
  if (kb > maxKb) {
    findings.push({
      code: "LW-SIZE",
      path: "$",
      detail: `${kb.toFixed(1)} KB > ${maxKb} KB`,
    });
  }

  try {
    doc = JSON.parse(raw);
  } catch (err) {
    findings.push({ code: "LW-JSON-PARSE", path: "$", detail: err.message });
    return { file, bytes, doc: null, findings };
  }

  if (!isPlainObject(doc)) {
    findings.push({ code: "LW-NOT-OBJECT", path: "$", detail: `실제 타입: ${Array.isArray(doc) ? "array" : typeof doc}` });
    return { file, bytes, doc: null, findings };
  }

  findings.push(...scanDocument(doc));
  return { file, bytes, doc, findings };
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

function formatHeader(result) {
  const { doc, bytes } = result;
  const kb = `${(bytes / 1024).toFixed(1)} KB`;
  if (!doc) return `  ${kb}`;

  const size = `${doc.w ?? "?"}×${doc.h ?? "?"}`;
  const fps = `${doc.fr ?? "?"}fps`;
  const ip = doc.ip ?? "?";
  const op = doc.op ?? "?";
  const span =
    typeof doc.ip === "number" && typeof doc.op === "number"
      ? ` (${doc.op - doc.ip}프레임)`
      : "";
  return `  ${kb} · ${size} · ${fps} · ${ip}–${op}${span}`;
}

function printResult(result) {
  // 레포 밖 경로면 relative() 가 ../../.. 로 길어진다. 그럴 땐 원본 인자를 쓴다.
  const rel = relative(process.cwd(), result.file);
  const shown = !rel || rel.startsWith("..") ? result.file : rel;
  console.log(shown);
  console.log(formatHeader(result));

  if (result.findings.length === 0) {
    console.log("  통과 — lottie-web SVG 렌더러와 어긋날 구간을 찾지 못했다.");
    console.log("");
    return;
  }

  // BLOCK 먼저.
  const ordered = [...result.findings].sort((a, b) => {
    const la = RULES[a.code].level === BLOCK ? 0 : 1;
    const lb = RULES[b.code].level === BLOCK ? 0 : 1;
    return la - lb;
  });

  for (const finding of ordered) {
    const rule = RULES[finding.code];
    const label = rule.level.padEnd(5);
    console.log(`  ${label} ${finding.code}`);
    console.log(`        ${rule.text}`);
    if (finding.detail) console.log(`        ${finding.detail}`);
    console.log(`        ${finding.path}`);
  }
  console.log("");
}

function countLevels(findings) {
  let block = 0;
  let warn = 0;
  for (const f of findings) {
    if (RULES[f.code].level === BLOCK) block++;
    else warn++;
  }
  return { block, warn };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const { files: requested, maxKb } = parseArgs(process.argv.slice(2));

if (requested.length === 0) {
  fail("검사할 lottie.json 경로를 하나 이상 넘겨야 한다.");
}

const files = dropUnexpandedGlobs(requested);

if (files.length === 0) {
  console.log("검사할 씬이 없다.");
  process.exit(0);
}

let totalBlock = 0;
let totalWarn = 0;

for (const file of files) {
  const result = checkFile(file, maxKb);
  printResult(result);
  const { block, warn } = countLevels(result.findings);
  totalBlock += block;
  totalWarn += warn;
}

const summary = `${files.length}개 파일 · BLOCK ${totalBlock} · WARN ${totalWarn} (예산 ${maxKb}KB)`;
if (totalBlock > 0) {
  console.log(`${summary} — 실패. BLOCK 을 0으로 만들어야 배포할 수 있다.`);
  process.exit(1);
}
console.log(`${summary} — 통과.`);
