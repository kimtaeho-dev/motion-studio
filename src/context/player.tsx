import { createContext, createEffect, createMemo, createSignal, on, onCleanup, untrack, useContext, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import type { FilmChange, FilmJson, StageFilm } from "@/types";
import { onServerEvent } from "@/lib/live";

/** The parts of a loaded film page the player talks to (lib/stage.js). */
interface FilmWindow extends Window {
  READY?: boolean;
  LOAD_ERROR?: string;
  FILM?: StageFilm;
  seek?: (t: number) => boolean;
  Stage?: { reload: (json: FilmJson) => boolean };
}

/** A named scene time from film.json's timeline, for the markers under the player. */
export interface Marker {
  key: string;
  t: number;
  label: string;
}

type Status = "loading" | "ready" | "error";

/** A film that never reports READY is broken, not slow: fonts and film.json are local. */
const LOAD_TIMEOUT_MS = 15_000;

const FORMAT_KEY = "motion-studio.format";

const PlayerContext = createContext<{
  /** Hand the player its iframe; it drives everything from there. */
  attach: (frame: HTMLIFrameElement) => void;
  src: () => string;
  status: () => Status;
  /** Why the film did not load, or why the last film.json change was rejected. */
  error: () => string | null;
  film: () => StageFilm | null;
  /** film.json as last read from disk. */
  json: () => FilmJson | null;
  markers: () => Marker[];
  format: () => string | null;
  setFormat: (format: string) => void;
  time: () => number;
  playing: () => boolean;
  toggle: () => void;
  seek: (t: number) => void;
  /** Move by whole frames (±1) and pause. */
  stepFrames: (n: number) => void;
  /** Move to the previous/next beat on the grid and pause. */
  stepBeats: (n: number) => void;
  /**
   * Apply an edited film.json to the open page right away (no save). Returns
   * why it was rejected, or null — a rejected edit leaves the page as it was.
   */
  applyLocal: (next: FilmJson) => string | null;
  /** The app is about to save this film.json; its own echo from the file watcher is not news. */
  markSaved: (saved: FilmJson) => void;
  /** Bumped whenever film.json changes from outside the app (the agent): edit history no longer applies. */
  externalChanges: () => number;
}>();

function loadFormats(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FORMAT_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function markersOf(json: FilmJson | null): Marker[] {
  return Object.entries(json?.timeline ?? {})
    .filter(([, e]) => typeof e?.t === "number")
    .map(([key, e]) => ({ key, t: e.t, label: e.label || key }))
    .sort((a, b) => a.t - b.t);
}

async function fetchFilmJson(slug: string): Promise<FilmJson | null> {
  try {
    const res = await fetch(`/films/${encodeURIComponent(slug)}/film.json`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as FilmJson) : null;
  } catch {
    return null;
  }
}

export function PlayerProvider(props: { children: JSX.Element }) {
  const params = useParams();
  // The player only mounts on a /:film route, so the slug is always there.
  const slug = () => params.film ?? "";
  const [frame, setFrame] = createSignal<HTMLIFrameElement | null>(null);
  const [reloadKey, setReloadKey] = createSignal(0);
  const [status, setStatus] = createSignal<Status>("loading");
  const [error, setError] = createSignal<string | null>(null);
  const [film, setFilm] = createSignal<StageFilm | null>(null);
  // film.json as last read from disk: the property panel shows it, the timeline marks its scene times.
  const [json, setJson] = createSignal<FilmJson | null>(null);
  const markers = createMemo(() => markersOf(json()));
  const [format, setFormatSignal] = createSignal<string | null>(loadFormats()[slug()] ?? null);
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  const [externalChanges, setExternalChanges] = createSignal(0);
  // What the app last saved, serialised — the watcher reports our own writes too.
  let lastSaved: string | null = null;

  const win = () => frame()?.contentWindow as FilmWindow | null | undefined;

  // A memo, so the URL only changes when a new page is wanted. The iframe's
  // attributes share one render effect, and setting src — even to the same
  // page with a fresh `t` — navigates it: a plain function here reloaded the
  // film whenever its loading class flipped.
  const src = createMemo(() => {
    const query = new URLSearchParams({ embed: "1", v: String(reloadKey()) });
    const fmt = format();
    if (fmt) query.set("format", fmt);
    query.set("t", String(untrack(time)));
    return `/films/${encodeURIComponent(slug())}/index.html?${query}`;
  });

  /** Draw the current time into the page, if it is ready to draw. */
  const draw = (t: number) => {
    const w = win();
    if (status() !== "ready" || !w?.seek) return;
    try {
      w.seek(t);
    } catch (err) {
      // A draw that throws is a bug in the film's code — say so instead of freezing silently.
      setError(`필름 코드 오류: ${String((err as Error)?.message ?? err)}`);
      setPlaying(false);
    }
  };

  // ── Loading ─────────────────────────────────────────────────────────
  // A timer, not requestAnimationFrame: a hidden or minimised window pauses
  // animation frames, and a film reloaded while nobody looks must still finish.
  let pollId: ReturnType<typeof setTimeout> | undefined;
  const waitForFilm = () => {
    clearTimeout(pollId);
    setStatus("loading");
    const started = performance.now();
    const poll = () => {
      const w = win();
      if (w?.LOAD_ERROR && !w.READY) {
        setStatus("error");
        setError(w.LOAD_ERROR);
        return;
      }
      if (w?.READY && w.FILM) {
        setFilm({ ...w.FILM });
        setError(null);
        setStatus("ready");
        const t = Math.min(time(), w.FILM.dur - 1e-6);
        setTime(Math.max(0, t));
        // The clock starts now, not when the page began loading.
        anchor();
        draw(time());
        return;
      }
      if (performance.now() - started > LOAD_TIMEOUT_MS) {
        setStatus("error");
        setError("필름이 준비되지 않았어요. 코드가 Stage.film(...)을 부르는지 확인이 필요해요.");
        return;
      }
      pollId = setTimeout(poll, 30);
    };
    poll();
  };

  const attach = (el: HTMLIFrameElement) => {
    setFrame(el);
    el.addEventListener("load", waitForFilm);
  };

  // A new page is on its way: stop drawing into the old one until it reports READY.
  createEffect(on(src, () => setStatus("loading"), { defer: true }));

  // Switching films: forget the old one's clock and format, fetch its markers.
  createEffect(
    on(
      slug,
      (current) => {
        setFilm(null);
        setJson(null);
        lastSaved = null;
        setError(null);
        setTime(0);
        setPlaying(true);
        setFormatSignal(loadFormats()[current] ?? null);
        void fetchFilmJson(current).then((json) => {
          if (slug() === current) setJson(json);
        });
      },
    ),
  );

  const setFormat = (next: string) => {
    if (next === (format() ?? film()?.format)) return;
    setFormatSignal(next);
    try {
      localStorage.setItem(FORMAT_KEY, JSON.stringify({ ...loadFormats(), [slug()]: next }));
    } catch {
      // Not remembering a format is fine.
    }
  };

  // ── Live changes from the agent (or, later, the property panel) ────
  onServerEvent<FilmChange>("film:changed", async (change) => {
    if (change.slug !== slug() && change.slug !== "*") return;
    if (change.kind === "doc" || change.kind === "out") return;
    if (change.kind === "code" || status() !== "ready") {
      // A reload keeps the time (src() carries it) and play state.
      setReloadKey((k) => k + 1);
      void fetchFilmJson(slug()).then((next) => {
        setJson(next);
        if (next && JSON.stringify(next) !== lastSaved) setExternalChanges((n) => n + 1);
      });
      return;
    }
    const json = await fetchFilmJson(slug());
    const w = win();
    if (!json || !w?.Stage) return;
    // Our own save coming back: the page already shows it, and a newer local
    // edit may be on screen that this older copy would undo.
    if (JSON.stringify(json) === lastSaved) return;
    setExternalChanges((n) => n + 1);
    if (w.Stage.reload(json)) {
      setError(null);
      if (w.FILM) setFilm({ ...w.FILM });
      setJson(json);
      draw(time());
    } else {
      // Rejected: the page keeps drawing the last good version.
      setError(w.LOAD_ERROR ?? "film.json 형식이 맞지 않아요.");
    }
  });

  // ── Clock ───────────────────────────────────────────────────────────
  let rafId = 0;
  let clockBase = 0;
  let clockStart = 0;
  const tick = (now: number) => {
    const dur = film()?.dur;
    if (dur && playing() && status() === "ready") {
      const t = (clockBase + (now - clockStart) / 1000) % dur;
      setTime(t);
      draw(t);
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  onCleanup(() => {
    cancelAnimationFrame(rafId);
    clearTimeout(pollId);
  });

  // Re-anchor the clock whenever playback starts or the time is set by hand.
  const anchor = () => {
    clockBase = time();
    clockStart = performance.now();
  };
  createEffect(on(playing, anchor));

  const seek = (t: number) => {
    const dur = film()?.dur ?? 0;
    const clamped = dur > 0 ? ((t % dur) + dur) % dur : 0;
    setTime(clamped);
    anchor();
    draw(clamped);
  };

  const toggle = () => {
    anchor();
    setPlaying((p) => !p);
  };

  const stepFrames = (n: number) => {
    setPlaying(false);
    seek(time() + n / (film()?.fps ?? 60));
  };

  const applyLocal = (next: FilmJson): string | null => {
    const w = win();
    if (status() !== "ready" || !w?.Stage) return "필름이 아직 열리지 않았어요.";
    if (!w.Stage.reload(next)) return w.LOAD_ERROR ?? "film.json 형식이 맞지 않아요.";
    setJson(next);
    if (w.FILM) setFilm({ ...w.FILM });
    setError(null);
    draw(time());
    return null;
  };

  const markSaved = (saved: FilmJson) => {
    lastSaved = JSON.stringify(saved);
  };

  const stepBeats = (n: number) => {
    const f = film();
    if (!f) return;
    setPlaying(false);
    const beat = 60 / f.bpm;
    const current = Math.round((time() - f.beatOffset) / beat);
    seek(f.beatOffset + (current + n) * beat);
  };

  return (
    <PlayerContext.Provider
      value={{
        attach,
        src,
        status,
        error,
        film,
        json,
        markers,
        // No choice made yet means the film's first format — which is what the page shows.
        format: () => format() ?? film()?.format ?? null,
        setFormat,
        time,
        playing,
        toggle,
        seek,
        stepFrames,
        stepBeats,
        applyLocal,
        markSaved,
        externalChanges,
      }}
    >
      {props.children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
}
