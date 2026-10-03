#!/usr/bin/env node
/*
 * sound.mjs — 효과음 + 음악을 코드로 합성하고 영상과 합친다. 라우드니스 -14 LUFS.
 *
 *   node tools/sound.mjs films/<이름> [--format 1x1]
 *
 * 입력:  out/<이름>/<포맷>/silent.mp4, cues.json, film.json   (render.mjs 결과)
 *        films/<이름>/audio/track.wav 가 있으면 그 음악을 그대로 쓴다 (BPM·beatOffset은 디자이너가 알려준 값)
 *        없으면 film.json 의 bpm/dur 로 루프 가능한 음악 베드를 합성한다
 * 출력:  out/<이름>/<포맷>/sfx.wav, music.wav, final.mp4
 *
 * 효과음 종류 (cues의 type): click, tick, pop, thump, whoosh, type, toggle, success, swish, error
 * cue 옵션: { t, type, gain?: 0~2, pitch?: 배수, pan?: -1~1 }
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const filmDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--format'));
if (!filmDir) { console.error('사용법: node tools/sound.mjs films/<이름> [--format 1x1]'); process.exit(1); }
const name = basename(resolve(filmDir));
const fi = argv.indexOf('--format');
const fmt = fi >= 0 ? argv[fi + 1] : readdirSync(join('out', name)).find((d) => existsSync(join('out', name, d, 'silent.mp4')));
const dir = join('out', name, fmt);
const film = JSON.parse(readFileSync(join(dir, 'film.json'), 'utf8'));
const cues = JSON.parse(readFileSync(join(dir, 'cues.json'), 'utf8'));

const SR = 48000, TAU = Math.PI * 2;
const N = Math.ceil(film.dur * SR);
let seed = 42;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2147483648 - 1);

/* ── 효과음 보이스: [길이(초), (t, p) => 샘플] p = pitch 배수 ─────────────── */
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) * d));
const VOICES = {
  click:   [0.06, (t, p) => (Math.sin(TAU * 2400 * p * t) * 0.5 + noise() * 0.5) * Math.exp(-t * 140) * 0.55],
  tick:    [0.04, (t, p) => Math.sin(TAU * 3200 * p * t) * Math.exp(-t * 180) * 0.3],
  pop:     [0.14, (t, p) => Math.sin(TAU * (520 + 700 * Math.exp(-t * 40)) * p * t) * env(t, 0.003, 32) * 0.5],
  thump:   [0.45, (t, p) => Math.sin(TAU * (55 + 70 * Math.exp(-t * 18)) * p * t) * env(t, 0.004, 9) * 0.9],
  whoosh:  [0.4, (t) => { const s = Math.sin(Math.PI * Math.min(1, t / 0.4)); return lp('w', noise(), 0.06 + 0.25 * s) * s * s * 0.9; }],
  swish:   [0.22, (t) => { const s = Math.sin(Math.PI * Math.min(1, t / 0.22)); return hp('s', noise(), 0.5) * s * s * 0.28; }],
  type:    [0.035, (t, p) => (noise() * 0.6 + Math.sin(TAU * 1800 * p * t) * 0.4) * Math.exp(-t * 220) * 0.32],
  toggle:  [0.09, (t, p) => (Math.sin(TAU * 1300 * p * t) + 0.5 * Math.sin(TAU * 2600 * p * t)) * Math.exp(-t * 70) * 0.32],
  success: [0.7, (t, p) => {
    const n1 = Math.sin(TAU * 880 * p * t) * env(t, 0.004, 7);
    const t2 = t - 0.09, n2 = t2 > 0 ? Math.sin(TAU * 1318.5 * p * t2) * env(t2, 0.004, 6) : 0;
    return (n1 + n2) * 0.22;
  }],
  error:   [0.3, (t, p) => Math.sign(Math.sin(TAU * 220 * p * t)) * env(t, 0.003, 14) * 0.12],
};
// 아주 단순한 1-pole 필터 (보이스별 상태는 cue마다 초기화)
let fstate = {};
function lp(id, x, a) { fstate[id] = (fstate[id] || 0) + a * (x - (fstate[id] || 0)); return fstate[id]; }
function hp(id, x, a) { return x - lp(id + 'h', x, a); }

function writeWav(file, L, R) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, b);
}

// 루프 영상이면 끝에서 넘치는 꼬리를 앞으로 감는다 (이음새에서 소리가 끊기지 않게)
function add(L, R, start, len, fn, gain = 1, pan = 0) {
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = gain * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  for (let i = 0; i < len; i++) {
    const v = fn(i / SR), j = (start + i) % N;
    L[j] += v * gl; R[j] += v * gr;
  }
}

/* ── 효과음 ── */
const SL = new Float32Array(N), SR_ = new Float32Array(N);
for (const c of cues) {
  const v = VOICES[c.type];
  if (!v) { console.warn('알 수 없는 효과음:', c.type); continue; }
  fstate = {};
  add(SL, SR_, Math.round(c.t * SR), Math.round(v[0] * SR), (t) => v[1](t, c.pitch || 1), c.gain ?? 1, c.pan ?? 0);
}
writeWav(join(dir, 'sfx.wav'), SL, SR_);

/* ── 음악 ── */
const track = join(filmDir, 'audio', 'track.wav');
let musicFile = track;
if (!existsSync(track)) {
  musicFile = join(dir, 'music.wav');
  const ML = new Float32Array(N), MR = new Float32Array(N);
  const beat = 60 / film.bpm, off = film.beatOffset || 0;
  const nBeats = Math.round((film.dur - off) / beat);
  // 코드 진행 (마디마다): Fmaj9 – Am7 – Dm9 – Cmaj7 (루프 친화적, 차분한 UI 톤)
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PROG = [[53, 57, 60, 64, 67], [57, 60, 64, 67, 71], [50, 57, 60, 64, 65], [48, 55, 59, 62, 64]];
  for (let b = 0; b < nBeats; b++) {
    const t0 = off + b * beat, bar = Math.floor(b / 4), chord = PROG[bar % PROG.length], s = Math.round(t0 * SR);
    // 킥: 매 비트, 아주 부드럽게
    add(ML, MR, s, Math.round(0.35 * SR), (t) => Math.sin(TAU * (48 + 60 * Math.exp(-t * 25)) * t) * env(t, 0.003, 10) * 0.42);
    // 오프비트 하이햇
    fstate = {};
    add(ML, MR, Math.round((t0 + beat / 2) * SR), Math.round(0.05 * SR), (t) => hp('hh', noise(), 0.7) * Math.exp(-t * 90) * 0.12, 1, 0.3);
    // 베이스: 마디 첫 박과 셋째 박
    if (b % 2 === 0) {
      const f = mtof(chord[0] - 12);
      add(ML, MR, s, Math.round(beat * 1.9 * SR), (t) => (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t)) * env(t, 0.01, 2.2) * 0.32);
    }
    // 8분음표 아르페지오 (플럭)
    for (let h = 0; h < 2; h++) {
      const note = chord[1 + ((b * 2 + h) % 4)] + 12, f = mtof(note), pan = h ? 0.35 : -0.35;
      add(ML, MR, Math.round((t0 + h * beat / 2) * SR), Math.round(0.4 * SR),
        (t) => (Math.sin(TAU * f * t) * 0.7 + Math.sin(TAU * 2 * f * t) * 0.2 * Math.exp(-t * 20)) * env(t, 0.002, 9) * 0.085, 1, pan);
    }
    // 패드: 마디 첫 박에 코드 전체
    if (b % 4 === 0) {
      const len = beat * 4;
      add(ML, MR, s, Math.round(len * SR), (t) => {
        const e = Math.min(1, t / 0.25) * Math.min(1, (len - t) / 0.3);
        let v = 0; for (const m of chord.slice(1)) { const f = mtof(m); v += Math.sin(TAU * f * t + Math.sin(TAU * 0.3 * t) * 0.6); }
        return v * e * 0.03;
      });
    }
  }
  writeWav(musicFile, ML, MR);
}

/* ── 믹스: 음악 + 효과음 → -14 LUFS → 영상과 합치기 ── */
const final = join(dir, 'final.mp4');
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-i', join(dir, 'silent.mp4'), '-i', musicFile, '-i', join(dir, 'sfx.wav'),
  '-filter_complex', `[1:a]volume=0.8[m];[2:a]volume=1.0[s];[m][s]amix=inputs=2:normalize=0:duration=longest,atrim=0:${film.dur},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.71:attack=2:release=40:level=false[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status);
console.log(`🔊 ${final}  (음악: ${musicFile === track ? '제공된 트랙' : '합성'}, 효과음 ${cues.length}개)`);
