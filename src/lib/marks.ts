/**
 * "고칠 곳 표시": a moment and an area of the film the designer marked on the stage.
 * It rides with the next message as a chip, and reaches the agent as a line
 * "▸ 4.86초 · 16x9 · 가운데 위 영역 (x 22~50%, y 18~45%)" (CLAUDE.md, 수정 요청이 오면).
 */
export interface FrameMark {
  id: string;
  /** Seconds into the film. */
  t: number;
  format: string;
  /** The area as fractions of the picture, x0 ≤ x1 and y0 ≤ y1; a spot has x0 = x1, y0 = y1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where on the film a mark sits, in words the agent and the designer both read: "가운데 위 영역". */
export function markPlace(m: FrameMark): string {
  const cx = (m.x0 + m.x1) / 2, cy = (m.y0 + m.y1) / 2;
  const col = cx < 1 / 3 ? "왼쪽" : cx < 2 / 3 ? "가운데" : "오른쪽";
  const row = cy < 1 / 3 ? "위" : cy < 2 / 3 ? "가운데" : "아래";
  const name = col === "가운데" && row === "가운데" ? "가운데" : col === "가운데" ? `가운데 ${row}` : row === "가운데" ? col : `${col} ${row}`;
  return isSpot(m) ? name : `${name} 영역`;
}

export const isSpot = (m: FrameMark) => m.x0 === m.x1 && m.y0 === m.y1;

/** The chip: "4.86초 · 가운데 위 영역". */
export const markLabel = (m: FrameMark) => `${m.t.toFixed(2)}초 · ${markPlace(m)}`;

/** The line the agent reads. */
export function markLine(m: FrameMark): string {
  const p = (v: number) => Math.round(v * 100);
  const where = isSpot(m) ? `(x ${p(m.x0)}%, y ${p(m.y0)}%)` : `(x ${p(m.x0)}~${p(m.x1)}%, y ${p(m.y0)}~${p(m.y1)}%)`;
  return `▸ ${m.t.toFixed(2)}초 · ${m.format} · ${markPlace(m)} ${where}`;
}

/** Reads a sent line back (for the chat bubble); null when the line is not a mark. */
export function parseMarkLine(line: string): { t: number; format: string; label: string } | null {
  const m = /^▸ (\d+(?:\.\d+)?)초 · (\S+) · (.+?) \(x [^)]*\)$/.exec(line.trim());
  return m ? { t: Number(m[1]), format: m[2], label: `${Number(m[1]).toFixed(2)}초 · ${m[3]}` } : null;
}
