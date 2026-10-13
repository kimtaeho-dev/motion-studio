#!/usr/bin/env node
/*
 * ask.mjs — 디자이너에게 묻는다. 질문을 films/<이름>/state.json에 남기고 waiting=answer로 기록한다.
 * Motion Studio 앱이 이걸 읽어 채팅에 선택지 카드로 보여준다(고르거나 직접 입력 → 답이 메시지로 온다).
 * 질문을 채팅 글로 쓰지 말고 이걸 쓴다. 실행한 뒤 채팅에는 한 줄만 쓰고 턴을 끝낸다.
 *
 *   node tools/ask.mjs films/<이름> \
 *     --q "어디에 올리나요?" --opt "인스타 릴스" --opt "앱스토어 미리보기" --rec 1 \
 *     --q "포인트 컬러는?" --hint "브랜드 색이 있으면 그걸 써요" --opt "브랜드 파랑 #2F6BFF" --opt "초록 #1DB954" \
 *     --q "강조할 기능을 모두 골라 주세요" --multi --opt "간편결제" --opt "포인트 적립" --opt "영수증" \
 *     --q "제품 페이지 URL이 있나요?"
 *
 *   --q      질문 (1~4개). 짧게, 디자이너가 쓰는 말로(파일 이름·코드 용어 없이).
 *   --opt    선택지 (질문마다 0개 또는 2~4개). 0개면 직접 입력만 받는다. "직접 입력"·"기타"는 앱이 붙이니 쓰지 않는다.
 *   --rec N  권장 선택지 번호 (1부터). 앱이 "추천"으로 표시한다.
 *   --hint   질문 아래 작은 설명 (선택).
 *   --multi  여러 개 고를 수 있다.
 *
 * 디자이너가 답하면 앱이 질문을 지운다. 질문 없이 waiting만 바꾸려면 tools/state.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MAX_QUESTION_LEN = 80;
const MAX_OPTION_LEN = 40;
const MAX_HINT_LEN = 120;
const ADDED_BY_APP = /^(직접\s*입력|기타|other)$/i;
// The designer never sees files or code: "지금 색을 그대로 쓸까요?", not "film.json 기본값을 쓸까요?".
const FILE_TALK = /\.(json|md|mjs|js|html)\b|films\/|tools\/|params|timeline/i;

const [filmArg, ...args] = process.argv.slice(2);
if (!filmArg || !existsSync(join(filmArg, 'film.json'))) {
  fail('사용법: node tools/ask.mjs films/<이름> --q "질문" [--opt "선택지" …] [--rec N] [--hint "설명"] [--multi] …');
}

const questions = [];
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const current = questions.at(-1);
  if (flag === '--multi') {
    if (!current) fail('--multi는 --q 다음에 쓴다');
    current.multi = true;
    continue;
  }
  const value = args[++i];
  if (value === undefined || value.startsWith('--')) fail(`${flag} 뒤에 값이 없다`);
  const text = value.trim();
  if (FILE_TALK.test(text)) fail(`디자이너는 파일·코드를 모른다. 화면에서 보이는 말로 바꾼다: ${text}`);
  if (flag === '--q') {
    if (!text) fail('빈 질문');
    if (text.length > MAX_QUESTION_LEN) fail(`질문이 길다(${text.length}자, ${MAX_QUESTION_LEN}자까지): ${text}`);
    questions.push({ q: text, options: [] });
  } else if (!current) {
    fail(`${flag}는 --q 다음에 쓴다`);
  } else if (flag === '--opt') {
    if (!text) fail(`"${current.q}": 빈 선택지`);
    if (text.length > MAX_OPTION_LEN) fail(`"${current.q}": 선택지가 길다(${text.length}자, ${MAX_OPTION_LEN}자까지): ${text}`);
    if (ADDED_BY_APP.test(text)) fail(`"${current.q}": "${text}"는 앱이 붙인다. 빼고 쓴다`);
    if (current.options.includes(text)) fail(`"${current.q}": 같은 선택지가 두 번: ${text}`);
    current.options.push(text);
  } else if (flag === '--rec') {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) fail(`"${current.q}": --rec는 1부터 시작하는 선택지 번호`);
    current.recommended = n - 1;
  } else if (flag === '--hint') {
    if (text.length > MAX_HINT_LEN) fail(`"${current.q}": 설명이 길다(${text.length}자, ${MAX_HINT_LEN}자까지)`);
    current.hint = text;
  } else {
    fail(`모르는 항목: ${flag} (--q, --opt, --rec, --hint, --multi만 쓴다)`);
  }
}

if (questions.length === 0) fail('질문이 없다. --q로 하나 이상');
if (questions.length > MAX_QUESTIONS) fail(`질문은 ${MAX_QUESTIONS}개까지(${questions.length}개). 답이 결과를 크게 바꾸는 것만 묻고 나머지는 기본값으로 정한다`);
for (const q of questions) {
  if (q.options.length === 1) fail(`"${q.q}": 선택지가 1개뿐이다. 0개(직접 입력만) 또는 2~${MAX_OPTIONS}개`);
  if (q.options.length > MAX_OPTIONS) fail(`"${q.q}": 선택지는 ${MAX_OPTIONS}개까지`);
  if (q.recommended !== undefined && q.recommended >= q.options.length) fail(`"${q.q}": --rec ${q.recommended + 1}번 선택지가 없다`);
  if (q.multi && q.options.length === 0) fail(`"${q.q}": --multi는 선택지가 있어야 한다`);
}

const file = join(filmArg, 'state.json');
let state = {};
try {
  state = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  // no state yet
}
state.waiting = 'answer';
state.questions = questions;
writeFileSync(file, JSON.stringify(state, null, 2) + '\n');

console.log(`✅ 질문 ${questions.length}개를 남겼다 — 앱이 선택지 카드로 보여준다.`);
console.log('채팅에는 질문을 다시 쓰지 말고 한 줄로 알린 뒤 턴을 끝낸다(예: "몇 가지만 정해 주세요.").');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}
