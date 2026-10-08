#!/usr/bin/env node
/*
 * critique.mjs — 렌더 결과를 "보는" 용도의 이미지들을 만든다. Claude가 이 이미지들을 직접 열어 보고 점수를 매긴다.
 *
 *   node tools/critique.mjs films/<이름> [포맷] [빠른동작시각]
 *
 *   contact.png     0.5초마다 1장, 6열 — 전체 흐름, 죽은 구간 찾기
 *   strip.png       빠른 동작 주변 연속 12프레임 — 튐, 겹침, 미끄러짐 찾기
 *   phone.png       360px 폭으로 축소 — 폰에서 읽히는지
 *   seam.png        루프 이음새 (끝 6프레임 + 처음 6프레임) — 끊김 찾기
 *   loop_check.mp4  두 번 이어 붙인 영상 — 이음새를 눈으로 확인
 *
 * ffmpeg만 쓴다 (ffprobe 없이). 앱에서는 앱이 넣어 둔 ffmpeg가 PATH에 있다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [filmArg, formatArg, fastArg] = process.argv.slice(2);
if (!filmArg) {
  console.error('사용법: node tools/critique.mjs films/<이름> [포맷] [빠른동작시각]');
  process.exit(1);
}
const name = basename(resolve(filmArg));
const base = join('out', name);
if (!existsSync(base)) {
  console.error(`❌ ${base}가 없습니다. 먼저 node tools/render.mjs ${filmArg}`);
  process.exit(1);
}
// out/<이름>/lottie/는 Lottie 내보내기 폴더라 포맷이 아니다
const format = formatArg ?? readdirSync(base).filter((d) => d !== 'lottie').sort()[0];
const dir = join(base, format);
const video = [join(dir, 'final.mp4'), join(dir, 'draft.mp4')].find(existsSync);
if (!video) {
  console.error(`❌ ${dir}에 final.mp4나 draft.mp4가 없습니다.`);
  process.exit(1);
}

function ffmpeg(args, { allowFail = false } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error) {
    console.error(`❌ ffmpeg를 실행하지 못했습니다: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0 && !allowFail) {
    console.error(`❌ ffmpeg 실패: ${r.stderr.trim()}`);
    process.exit(1);
  }
  return r;
}

/** Duration and frame rate from ffmpeg's own banner — ffprobe is not shipped with the app. */
function probe(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr ?? '');
  const f = /, ([\d.]+) fps/.exec(r.stderr ?? '');
  if (!d || !f) {
    console.error(`❌ 영상 정보를 읽지 못했습니다: ${file}`);
    process.exit(1);
  }
  return { dur: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), fps: Number(f[1]) };
}

const { dur, fps } = probe(video);
const fast = fastArg !== undefined ? Number(fastArg) : dur / 3;
const out = join(dir, 'critique');
mkdirSync(out, { recursive: true });

const rows = (perRow, perSecond) => Math.max(1, Math.ceil((dur * perSecond) / perRow));
ffmpeg(['-i', video, '-vf', `fps=2,scale=270:-1,tile=6x${rows(6, 2)}:padding=6:color=0x111111`, '-frames:v', '1', join(out, 'contact.png')]);
ffmpeg(['-ss', String(Math.max(0, fast - 0.1)), '-i', video, '-vf', 'scale=320:-1,tile=12x1:padding=4', '-frames:v', '1', join(out, 'strip.png')]);
ffmpeg(['-i', video, '-vf', `fps=1,scale=360:-1,tile=5x${rows(5, 1)}:padding=6:color=0x111111`, '-frames:v', '1', join(out, 'phone.png')]);
// 이음새: 마지막 6프레임 + 처음 6프레임, 사이는 분홍 테두리
ffmpeg([
  '-sseof', String(-6.5 / fps), '-i', video, '-i', video,
  '-filter_complex', '[0:v]scale=240:-1,trim=end_frame=6,setpts=N/TB[a];[1:v]scale=240:-1,trim=end_frame=6,setpts=N/TB[b];[a][b]concat=n=2:v=1:a=0,tile=12x1:padding=4:color=0xff0050',
  '-frames:v', '1', join(out, 'seam.png'),
]);
ffmpeg(['-stream_loop', '1', '-i', video, '-c', 'copy', join(out, 'loop_check.mp4')]);

console.log(`👀 ${out}/{contact,strip,phone,seam}.png, loop_check.mp4`);
console.log('   다음: prompts/critique-pass.md 대로 채점한다.');
