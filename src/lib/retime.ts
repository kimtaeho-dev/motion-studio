import type { FilmJson } from "@/types";

/** The same range the new-film dialog allows. */
export const MIN_DUR = 2;
export const MAX_DUR = 180;

/**
 * Changes a film's length and spreads its named scene times with it: 8s → 12s
 * moves a scene at 4s to 6s. Only the gaps change — every move inside a scene
 * is a spring or physics, which keeps its own speed (no slow motion).
 *
 * A scene that sat on a beat lands on the nearest beat of the same grid (the
 * BPM stays, it is the song's); one placed between beats keeps its proportion,
 * rounded to a frame. Snapping never lets one scene pass or swallow its neighbour.
 */
export function retime(draft: FilmJson, nextDur: number): void {
  const prev = draft.dur;
  const dur = Math.round(Math.min(MAX_DUR, Math.max(MIN_DUR, nextDur)) * 100) / 100;
  if (!(prev > 0) || dur === prev) return;
  const r = dur / prev;
  const bpm = draft.bpm ?? 120;
  const offset = draft.beatOffset ?? 0;
  const fps = draft.fps ?? 60;
  const len = 60 / bpm;
  const onBeat = (t: number) => Math.abs((t - offset) / len - Math.round((t - offset) / len)) < 1e-3;
  const toBeat = (t: number) => offset + Math.round((t - offset) / len) * len;
  const toFrame = (t: number) => Math.round(t * fps) / fps;
  const round3 = (t: number) => Math.round(t * 1000) / 1000;

  const entries = Object.values(draft.timeline ?? {}).sort((a, b) => a.t - b.t);
  let last = -Infinity;
  let lastOld = -Infinity;
  for (const m of entries) {
    const old = m.t;
    const scaled = old >= prev - 1e-6 ? dur : old * r;
    let t = onBeat(old) ? toBeat(scaled) : toFrame(scaled);
    // Two scenes at the same time stay together; distinct ones stay distinct and in order.
    if (old > lastOld + 1e-6 && t <= last + 1e-6) t = toFrame(scaled) > last + 1e-6 ? toFrame(scaled) : last + 1 / fps;
    t = round3(Math.min(dur, Math.max(0, t)));
    m.t = t;
    last = t;
    lastOld = old;
  }
  draft.dur = dur;
}
