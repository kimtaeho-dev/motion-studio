import fs from "node:fs";
import path from "node:path";
import type { FilmState } from "../src/types/common";

/**
 * films/<slug>/state.json: where the film is in the pipeline. The agent writes
 * stage/waiting/round through tools/state.mjs; the app writes quality and
 * approvals. Every write merges, so neither side drops the other's fields.
 */
export function readState(filmDir: string): FilmState & Record<string, unknown> {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(filmDir, "state.json"), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function writeState(filmDir: string, patch: Partial<FilmState>): FilmState {
  const next = { ...readState(filmDir), ...patch };
  fs.writeFileSync(path.join(filmDir, "state.json"), JSON.stringify(next, null, 2) + "\n");
  return next;
}
