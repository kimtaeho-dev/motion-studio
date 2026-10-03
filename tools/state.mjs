#!/usr/bin/env node
/*
 * state.mjs — 필름의 진행 단계를 films/<이름>/state.json에 기록한다. Motion Studio 앱이 이걸 읽어서
 * 단계 표시와 승인 버튼을 보여준다. state.json을 손으로 고치지 말고 이걸 쓴다.
 *
 *   node tools/state.mjs films/<이름>                                # 지금 상태 보기
 *   node tools/state.mjs films/<이름> stage=shotlist waiting=approval # 숏리스트를 썼고 승인을 기다린다 → 턴을 끝낸다
 *   node tools/state.mjs films/<이름> waiting=answer                  # 디자이너에게 질문했다 → 턴을 끝낸다
 *   node tools/state.mjs films/<이름> stage=critique round=2          # 검수 2라운드
 *   node tools/state.mjs films/<이름> stage=deliver waiting=none      # 전달 완료
 *
 *   stage:   brief · shotlist · stills · draft · critique · deliver
 *   waiting: approval(승인 대기) · answer(답변 대기) · none
 *
 * quality(검수 라운드 수)와 approved(디자이너가 통과시킨 관문)는 앱이 쓴다. 여기서 바꾸지 않는다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STAGES = ['brief', 'shotlist', 'stills', 'draft', 'critique', 'deliver'];
const WAITING = ['approval', 'answer', 'none'];

const [filmArg, ...pairs] = process.argv.slice(2);
if (!filmArg || !existsSync(join(filmArg, 'film.json'))) {
  console.error('사용법: node tools/state.mjs films/<이름> [stage=…] [waiting=…] [round=…]');
  process.exit(1);
}
const file = join(filmArg, 'state.json');
let state = {};
try {
  state = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  // no state yet
}

for (const pair of pairs) {
  const [key, value] = pair.split('=');
  if (key === 'stage') {
    if (!STAGES.includes(value)) fail(`stage: ${STAGES.join(' | ')}`);
    state.stage = value;
  } else if (key === 'waiting') {
    if (!WAITING.includes(value)) fail(`waiting: ${WAITING.join(' | ')}`);
    state.waiting = value === 'none' ? null : value;
  } else if (key === 'round') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) fail('round: 1 이상의 정수');
    state.round = n;
  } else {
    fail(`모르는 항목: ${key} (stage, waiting, round만 쓴다)`);
  }
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (pairs.length) writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
console.log(`${filmArg}: ${JSON.stringify(state)}`);
