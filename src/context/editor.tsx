import { createContext, createEffect, createSignal, on, onCleanup, useContext, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import type { FilmJson } from "@/types";
import { useChat } from "@/context/chat";
import { usePlayer } from "@/context/player";

/** Long enough to coalesce a drag or a burst of typing into one write. */
const SAVE_DELAY_MS = 300;
const HISTORY_LIMIT = 100;

/**
 * Direct edits to film.json from the property panel and the timeline.
 *
 * Every change is applied to the open page first (Stage.reload validates it),
 * then saved a moment later. A drag or a run of keystrokes is one history step:
 * callers `preview` while it is going on and `commit` with the state from
 * before it started.
 *
 * While the agent works on this film, editing is locked — its next edit of
 * film.json would otherwise race the designer's (docs/APP_PLAN.md, 4단계).
 */
const EditorContext = createContext<{
  /** True while an agent turn for this film is queued or running. */
  locked: () => boolean;
  /** The last edit that could not be applied, said plainly. */
  editError: () => string | null;
  /** Show (and save) a change without making it an undo step — for drags and typing in progress. */
  preview: (next: FilmJson) => boolean;
  /** Finish a change: show and save it, and record `before` as the step to undo to. */
  commit: (next: FilmJson, before: FilmJson) => boolean;
  /** One-shot edit: copy, change, commit. */
  edit: (change: (draft: FilmJson) => void) => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
}>();

export const cloneFilm = (json: FilmJson): FilmJson => structuredClone(json);

export function EditorProvider(props: { children: JSX.Element }) {
  const params = useParams();
  const { json, applyLocal, markSaved, externalChanges } = usePlayer();
  const { messages } = useChat();
  const [editError, setEditError] = createSignal<string | null>(null);
  const [history, setHistory] = createSignal<FilmJson[]>([]);
  const [future, setFuture] = createSignal<FilmJson[]>([]);

  const locked = () => messages().some((m) => m.status === "pending" || m.status === "processing");

  // ── Saving ──────────────────────────────────────────────────────────
  let pending: { film: string; json: FilmJson } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    clearTimeout(timer);
    const job = pending;
    pending = null;
    if (!job) return;
    markSaved(job.json);
    const res = await fetch("/__films/json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    }).catch(() => null);
    if (!res?.ok) setEditError("바꾼 내용을 저장하지 못했어요. 다시 시도해 주세요.");
  };

  const schedule = (next: FilmJson) => {
    pending = { film: params.film ?? "", json: next };
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // Leaving a film (or the app) must not drop its last edit.
  createEffect(
    on(
      () => params.film,
      () => {
        void flush();
        setHistory([]);
        setFuture([]);
        setEditError(null);
      },
      { defer: true },
    ),
  );
  const onUnload = () => void flush();
  window.addEventListener("beforeunload", onUnload);
  onCleanup(() => {
    window.removeEventListener("beforeunload", onUnload);
    void flush();
  });

  // The agent rewrote film.json: undoing would quietly revert its work.
  createEffect(
    on(
      externalChanges,
      () => {
        setHistory([]);
        setFuture([]);
      },
      { defer: true },
    ),
  );

  // An agent turn is about to read film.json: hand it the designer's latest.
  createEffect(on(locked, (isLocked) => isLocked && void flush(), { defer: true }));

  // ── Editing ─────────────────────────────────────────────────────────
  const preview = (next: FilmJson) => {
    if (locked()) return false;
    const problem = applyLocal(next);
    setEditError(problem);
    if (problem) return false;
    schedule(next);
    return true;
  };

  const commit = (next: FilmJson, before: FilmJson) => {
    if (!preview(next)) return false;
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      setHistory((h) => [...h, before].slice(-HISTORY_LIMIT));
      setFuture([]);
    }
    return true;
  };

  const edit = (change: (draft: FilmJson) => void) => {
    const current = json();
    if (!current) return false;
    const draft = cloneFilm(current);
    change(draft);
    return commit(draft, current);
  };

  const step = (from: () => FilmJson[], setFrom: typeof setHistory, setTo: typeof setHistory) => {
    const current = json();
    const target = from().at(-1);
    if (!current || !target || locked()) return;
    if (!preview(target)) return;
    setFrom((list) => list.slice(0, -1));
    setTo((list) => [...list, current]);
  };

  return (
    <EditorContext.Provider
      value={{
        locked,
        editError,
        preview,
        commit,
        edit,
        canUndo: () => history().length > 0 && !locked(),
        canRedo: () => future().length > 0 && !locked(),
        undo: () => step(history, setHistory, setFuture),
        redo: () => step(future, setFuture, setHistory),
      }}
    >
      {props.children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (!context) throw new Error("useEditor must be used within an EditorProvider");
  return context;
}
