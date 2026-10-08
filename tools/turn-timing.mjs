#!/usr/bin/env node
/*
 * turn-timing.mjs — 앱 채팅으로 에이전트가 돈 턴마다 시간이 어디로 갔는지 잰다(속도 개선 전후 비교용).
 *
 *   node tools/turn-timing.mjs films/<이름>            # 그 필름의 모든 턴
 *   node tools/turn-timing.mjs films/<이름> --last 2   # 마지막 2턴만
 *   node tools/turn-timing.mjs films/<이름> --json     # 숫자만 JSON으로 (비교 스크립트용)
 *
 * 읽는 것: .mailbox/<이름>/thread.json(세션 id) → ~/.claude/projects/<작업 폴더>/<세션>.jsonl(대화 기록).
 * 턴 = 디자이너 메시지 하나부터 에이전트가 답을 끝낼 때까지.
 *   모델   — 모델이 응답을 만드는 시간(생각 + 글 + 도구 입력 쓰기). 네트워크 멈춤은 뺀다
 *   도구   — 렌더·검사·파일 읽기 같은 도구가 실제로 돈 시간 (종류별)
 *   멈춤   — API가 첫 응답을 주지 않아 기다린 시간(재시도). 이 앱 밖의 문제지만 디자이너는 기다린다
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const filmArg = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const lastN = args.includes('--last') ? Number(args[args.indexOf('--last') + 1]) : null;
const asJson = args.includes('--json');
if (!filmArg) {
  console.error('사용법: node tools/turn-timing.mjs films/<이름> [--last N] [--json]');
  process.exit(1);
}

const root = process.cwd();
const slug = basename(resolve(filmArg));
const threadFile = join(root, '.mailbox', slug, 'thread.json');
if (!existsSync(threadFile)) {
  console.error(`채팅 기록이 없습니다: ${threadFile} (앱 채팅으로 돈 턴만 잴 수 있다)`);
  process.exit(1);
}
const thread = JSON.parse(readFileSync(threadFile, 'utf8'));
const project = join(homedir(), '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
const transcript = join(project, `${thread.sessionId}.jsonl`);
if (!thread.sessionId || !existsSync(transcript)) {
  console.error(`대화 기록 파일을 찾지 못했습니다: ${transcript}`);
  process.exit(1);
}

const rows = readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ts = (r) => Date.parse(r.timestamp);

/** 도구 호출을 종류로 묶는다. 앞의 것이 먼저 맞는다 */
function category(name, input = {}) {
  if (name === 'Read') {
    return /\.(png|jpe?g|gif|webp)$/i.test(input.file_path || '') ? '이미지 보기' : '파일 읽기';
  }
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') return '파일 쓰기';
  if (name !== 'Bash') return name;
  const c = input.command || '';
  const rules = [
    ['렌더 --parity', /render\.mjs.*--parity/],
    ['렌더 --check3d', /render\.mjs.*--check3d/],
    ['렌더 스틸', /render\.mjs.*--stills/],
    ['렌더 초안', /render\.mjs.*--draft/],
    ['렌더 영상', /render\.mjs/],
    ['critique.mjs', /critique\.mjs/],
    ['결정성 검사', /determinism\.mjs/],
    ['lottie check', /lottie\.mjs check/],
    ['lottie export', /lottie\.mjs export/],
    ['lottie text', /lottie\.mjs text/],
    ['build.mjs 실행', /build\.mjs/],
    ['lottie sync', /lottie\.mjs sync/],
    ['state.mjs', /state\.mjs/],
    ['문서 읽기', /^\s*(cat|sed|head|tail|grep|ls)\b/],
  ];
  // `render && critique`처럼 이어 붙인 명령은 시간을 나눌 수 없어서, 들어 있는 것을 모두 이름에 적는다
  const hits = [];
  for (const part of c.split(/&&|;|\|\|/)) {
    const hit = rules.find(([, re]) => re.test(part.trim()));
    if (hit && !hits.includes(hit[0])) hits.push(hit[0]);
  }
  return hits.length ? hits.join(' + ') : 'bash 기타';
}

// 디자이너 메시지(문자열 content)마다 턴을 연다. 이미지만 붙은 사용자 줄은 도구 결과의 일부다
const turns = [];
let turn = null;
const pending = new Map();
let lastEvent = 0;
for (const r of rows) {
  const m = r.message || {};
  if (r.type === 'user' && typeof m.content === 'string' && !m.content.startsWith('[Image')) {
    turn = { prompt: m.content, start: ts(r), end: ts(r), reqs: [], tools: [], stalls: 0 };
    turns.push(turn);
    lastEvent = ts(r);
    continue;
  }
  if (!turn || !r.timestamp) continue;
  if (r.type === 'system' && r.subtype === 'api_error') {
    // error는 문자열일 때도, 객체일 때도 있다
    const err = typeof r.error === 'string' ? r.error : JSON.stringify(r.error || {});
    const waited = /waitedMs['"]?\s*:\s*(\d+)/.exec(err);
    if (waited) turn.stalls += Number(waited[1]) / 1000;
    continue;
  }
  if (r.type === 'assistant') {
    const id = m.id;
    const last = turn.reqs[turn.reqs.length - 1];
    if (last && last.id === id) {
      last.end = ts(r);
    } else {
      const u = m.usage || {};
      turn.reqs.push({ id, start: lastEvent, end: ts(r), out: u.output_tokens || 0, ctx: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) });
    }
    for (const c of m.content || []) if (c.type === 'tool_use') pending.set(c.id, { t: ts(r), cat: category(c.name, c.input) });
    turn.end = Math.max(turn.end, ts(r));
    lastEvent = ts(r);
  } else if (r.type === 'user') {
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c && c.type === 'tool_result' && pending.has(c.tool_use_id)) {
        const p = pending.get(c.tool_use_id);
        pending.delete(c.tool_use_id);
        turn.tools.push({ cat: p.cat, sec: (ts(r) - p.t) / 1000 });
      }
    }
    turn.end = Math.max(turn.end, ts(r));
    lastEvent = ts(r);
  }
}

const summary = turns.map((t, i) => {
  const total = (t.end - t.start) / 1000;
  const reqSec = t.reqs.reduce((s, q) => s + (q.end - q.start) / 1000, 0);
  const model = Math.max(0, reqSec - t.stalls);
  const tool = t.tools.reduce((s, x) => s + x.sec, 0);
  const byCat = {};
  for (const x of t.tools) (byCat[x.cat] = byCat[x.cat] || { n: 0, sec: 0 }), byCat[x.cat].n++, (byCat[x.cat].sec += x.sec);
  // 앱이 붙이는 머리말(대상 필름·단계 안내)은 빼고 디자이너가 쓴 끝부분만
  const said = t.prompt.split(/(?<=다\.) /).pop().slice(0, 60);
  return {
    turn: i + 1, prompt: said, total: Math.round(total), model: Math.round(model), tools: Math.round(tool), stall: Math.round(t.stalls),
    requests: t.reqs.length, outputTokens: t.reqs.reduce((s, q) => s + q.out, 0),
    maxContext: Math.max(0, ...t.reqs.map((q) => q.ctx)),
    images: byCat['이미지 보기']?.n || 0,
    byCategory: Object.fromEntries(Object.entries(byCat).sort((a, b) => b[1].sec - a[1].sec).map(([k, v]) => [k, { n: v.n, sec: Math.round(v.sec * 10) / 10 }])),
  };
});
const shown = lastN ? summary.slice(-lastN) : summary;

if (asJson) {
  process.stdout.write(JSON.stringify(shown, null, 1) + '\n');
} else {
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  for (const s of shown) {
    console.log(`\n턴 ${s.turn}: "${s.prompt}"`);
    console.log(`  전체 ${s.total}초 = 모델 ${s.model}초(${pct(s.model, s.total)}) · 도구 ${s.tools}초(${pct(s.tools, s.total)})${s.stall ? ` · 네트워크 멈춤 ${s.stall}초` : ''}`);
    console.log(`  모델 요청 ${s.requests}번 · 출력 ${s.outputTokens.toLocaleString()} 토큰 · 최대 문맥 ${Math.round(s.maxContext / 1000)}k · 이미지 ${s.images}장`);
    for (const [k, v] of Object.entries(s.byCategory)) console.log(`    ${k.padEnd(24)} ${String(v.n).padStart(3)}번 ${String(v.sec).padStart(7)}초`);
  }
}
