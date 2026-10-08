import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Check, Film, Image, Pause, Play, Redo2, Undo2, X } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/context/player";
import { cloneFilm, useEditor } from "@/context/editor";
import { useFilms } from "@/context/films";
import { useFiles } from "@/context/files";
import { useRender } from "@/context/render";
import { openMedia } from "@/components/media-viewer";
import { ExportButton } from "@/components/export-dialog";
import type { FilmFile, FilmJson, RenderJob } from "@/types";
import { MAX_DUR, MIN_DUR, retime } from "@/lib/retime";
import { useParams } from "@solidjs/router";

const pct = (t: number, dur: number) => `${(t / dur) * 100}%`;

/** Keys that drive the player — ignored while the user is typing anywhere. */
function usePlayerKeys() {
  const { toggle, stepFrames, stepBeats, seek } = usePlayer();
  const { undo, redo } = useEditor();
  const onKey = (e: KeyboardEvent) => {
    // Inside a text field, ⌘Z is the field's own undo; everything else here is the player's.
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
    if ((e.metaKey || e.ctrlKey) && (e.code === "KeyZ" || e.code === "KeyY")) {
      e.preventDefault();
      if (e.code === "KeyY" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      toggle();
    } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
      const dir = e.code === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey) stepBeats(dir);
      else stepFrames(dir);
    } else if (e.code === "Home") {
      e.preventDefault();
      seek(0);
    }
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));
}

function HistoryButtons() {
  const { canUndo, canRedo, undo, redo } = useEditor();
  return (
    <div class="flex items-center">
      <Button size="icon-sm" variant="ghost" onClick={undo} disabled={!canUndo()} aria-label="되돌리기 (⌘Z)" title="되돌리기 (⌘Z)">
        <Undo2 />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={redo} disabled={!canRedo()} aria-label="다시 하기 (⇧⌘Z)" title="다시 하기 (⇧⌘Z)">
        <Redo2 />
      </Button>
    </div>
  );
}

function FormatSwitch() {
  const { film, format, setFormat } = usePlayer();
  return (
    <Show when={(film()?.formats.length ?? 0) > 1}>
      <div class="flex items-center gap-0.5 rounded-md bg-input p-0.5">
        <For each={film()!.formats}>
          {(f) => (
            <button
              type="button"
              onClick={() => setFormat(f)}
              class="rounded-sm px-2 py-0.5 font-mono text-[10px] focus-ring"
              classList={{
                "bg-background text-foreground shadow-xs": f === format(),
                "text-muted-foreground hover:text-foreground": f !== format(),
              }}
            >
              {f}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

function Stage() {
  const { attach, src, status, error, film } = usePlayer();
  return (
    <div
      class="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-stage"
      classList={{ "checkerboard": !!film()?.transparent }}
    >
      <iframe
        ref={attach}
        src={src()}
        title="필름 미리보기"
        // Same colour scheme as the film page inside: when they differ, Chrome
        // paints the frame opaque (white) instead of letting the stage show through.
        style={{ "color-scheme": "normal" }}
        class="absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] border-0 bg-transparent"
        classList={{ "opacity-0": status() !== "ready" }}
      />
      <Show when={status() === "loading"}>
        <div class="absolute inset-0 flex items-center justify-center text-xxs text-muted-foreground">불러오는 중…</div>
      </Show>
      <Show when={status() === "error"}>
        <div class="absolute inset-0 flex items-center justify-center p-8">
          <div class="flex max-w-lg flex-col gap-2 rounded-lg bg-background p-4 text-xxs">
            <span class="font-strong text-foreground">이 필름을 열 수 없어요</span>
            <pre class="whitespace-pre-wrap font-mono text-[10px] text-destructive">{error()}</pre>
            <span class="text-muted-foreground">에이전트에게 "필름이 안 열려"라고 말하면 고쳐 줄 거예요.</span>
          </div>
        </div>
      </Show>
      <Show when={status() === "ready" && error()}>
        <div class="absolute inset-x-4 top-4 rounded-md bg-background/95 px-3 py-2 text-xxs">
          <span class="text-destructive">방금 바뀐 내용을 적용하지 못해서 이전 상태를 보여주고 있어요.</span>
          <pre class="mt-1 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{error()}</pre>
        </div>
      </Show>
    </div>
  );
}

/** Pixels a press may wander before it counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

const round3 = (t: number) => Math.round(t * 1000) / 1000;

function Timeline() {
  const { film, json, markers, time, seek, playing, toggle } = usePlayer();
  const { locked, preview, commit } = useEditor();
  const [drag, setDrag] = createSignal<{ label: string; t: number } | null>(null);
  let el: HTMLDivElement | undefined;

  const dur = () => film()?.dur ?? 1;
  const beats = createMemo(() => {
    const f = film();
    if (!f) return [];
    const len = 60 / f.bpm;
    const out: { t: number; bar: number | null }[] = [];
    for (let i = 0; f.beatOffset + i * len <= f.dur + 1e-6; i++) out.push({ t: f.beatOffset + i * len, bar: i % 4 === 0 ? i / 4 + 1 : null });
    return out;
  });

  const rawTimeAt = (e: PointerEvent) => {
    const r = el!.getBoundingClientRect();
    return Math.min(Math.max(0, (e.clientX - r.left) / r.width), 0.99999) * dur();
  };
  /** The beat grid is the unit a film is laid out on; Alt drops to single frames. */
  const snap = (t: number, fine: boolean) => {
    const f = film();
    if (!f) return t;
    if (fine) return Math.round(t * f.fps) / f.fps;
    const len = 60 / f.bpm;
    return Math.min(f.dur, Math.max(0, f.beatOffset + Math.round((t - f.beatOffset) / len) * len));
  };

  // ── Scrubbing (the background) ──────────────────────────────────────
  let wasPlaying = false;
  const onDown = (e: PointerEvent) => {
    wasPlaying = playing();
    if (wasPlaying) toggle();
    el!.setPointerCapture(e.pointerId);
    const t = rawTimeAt(e);
    seek(e.shiftKey ? snap(t, false) : t);
  };
  const onMove = (e: PointerEvent) => {
    if (!el!.hasPointerCapture(e.pointerId)) return;
    const t = rawTimeAt(e);
    seek(e.shiftKey ? snap(t, false) : t);
  };
  const onUp = (e: PointerEvent) => {
    el!.releasePointerCapture(e.pointerId);
    if (wasPlaying) toggle();
  };

  // ── Dragging a scene time ────────────────────────────────────────────
  /**
   * A press on a handle: a click jumps to its time, a drag moves it. The whole
   * drag previews live and lands as one undo step.
   */
  const dragHandle = (label: string, current: () => number, write: (draft: FilmJson, t: number) => void) => (e: PointerEvent) => {
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const before = json();
    if (!before) return;
    if (playing()) toggle();
    const startX = e.clientX;
    let moved = false;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (locked()) return;
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const t = round3(snap(rawTimeAt(ev), ev.altKey));
      const draft = cloneFilm(before);
      write(draft, t);
      if (preview(draft)) {
        setDrag({ label, t });
        seek(t);
      }
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDrag(null);
      const after = json();
      if (moved && after) commit(after, before);
      else seek(current());
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };


  return (
    <div
      ref={el}
      class="relative h-16 flex-1 cursor-pointer select-none touch-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* Bars and beats */}
      <For each={beats()}>
        {(b) => (
          <div class="pointer-events-none absolute top-0 h-full" style={{ left: pct(b.t, dur()) }}>
            <div class="absolute bottom-4 w-px" classList={{ "h-8 bg-muted-foreground/40": b.bar !== null, "h-2 bg-muted-foreground/20": b.bar === null }} />
            <Show when={b.bar !== null}>
              <span class="absolute top-0 left-1 font-mono text-[9px] text-muted-foreground">{b.bar}</span>
            </Show>
          </div>
        )}
      </For>

      {/* Named scene times: drag to move, click to jump */}
      <For each={markers().map((m) => m.key)}>
        {(key) => {
          const m = () => markers().find((x) => x.key === key);
          return (
            <Show when={m()}>
              {(marker) => (
                <div class="absolute top-3 bottom-4 -translate-x-1/2" style={{ left: pct(marker().t, dur()) }}>
                  <div class="pointer-events-none absolute top-2 bottom-0 left-1/2 w-px -translate-x-1/2 bg-marker/50" />
                  <div
                    role="slider"
                    aria-label={`장면 '${marker().label}'`}
                    aria-valuenow={marker().t}
                    title={`${marker().label} · ${marker().t.toFixed(2)}s${locked() ? "" : " — 끌어서 옮기기"}`}
                    onPointerDown={dragHandle(marker().label, () => marker().t, (d, t) => (d.timeline![key].t = t))}
                    class="relative size-2.5 rounded-[3px] bg-marker hover:scale-125"
                    classList={{ "cursor-ew-resize": !locked() }}
                  />
                </div>
              )}
            </Show>
          );
        }}
      </For>

      {/* Playhead */}
      <div class="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-brand" style={{ left: pct(time(), dur()) }} />

      <Show when={drag()}>
        {(d) => (
          <div
            class="pointer-events-none absolute -top-6 -translate-x-1/2 rounded-md bg-brand-strong px-1.5 py-0.5 font-mono text-[10px] tabular-nums whitespace-nowrap text-brand-foreground"
            style={{ left: pct(d().t, dur()) }}
          >
            {d().label} · {d().t.toFixed(2)}s
          </div>
        )}
      </Show>
    </div>
  );
}

function Readout() {
  const { film, markers, time } = usePlayer();
  const beat = () => {
    const f = film();
    if (!f) return null;
    const b = Math.floor(((time() - f.beatOffset) * f.bpm) / 60 + 1e-6);
    return b < 0 ? null : { bar: Math.floor(b / 4) + 1, beat: (b % 4) + 1 };
  };
  // The scene the playhead is in: the last named time it has passed.
  const scene = () => [...markers()].reverse().find((m) => m.t <= time() + 1e-6)?.label;
  return (
    <div class="flex w-40 shrink-0 flex-col gap-0.5 text-right">
      <span class="font-mono text-xxs tabular-nums text-foreground">
        {time().toFixed(2)}s
        <span class="text-muted-foreground"> / </span>
        <DurationField />
      </span>
      <span class="truncate text-[10px] text-muted-foreground">
        <Show when={beat()}>{(b) => <>{b().bar}마디 {b().beat}박</>}</Show>
        <Show when={scene()}>{(s) => <> · {s()}</>}</Show>
      </span>
    </div>
  );
}

/**
 * The film's length, in the readout. A click turns it into a field; Enter (or
 * leaving it) stretches every scene time with it, as one undo step.
 */
function DurationField() {
  const { film } = usePlayer();
  const { locked, edit } = useEditor();
  const [editing, setEditing] = createSignal(false);
  let cancelled = false;
  const apply = (input: HTMLInputElement) => {
    setEditing(false);
    const n = Number(input.value);
    if (cancelled || input.value.trim() === "" || !Number.isFinite(n)) return;
    edit((d) => retime(d, n));
  };
  return (
    <Show
      when={editing()}
      fallback={
        <button
          type="button"
          disabled={locked() || !film()}
          onClick={() => {
            cancelled = false;
            setEditing(true);
          }}
          title={locked() ? "에이전트가 고치는 중이라 잠시 바꿀 수 없어요" : "전체 길이 바꾸기 — 장면 시각도 같은 비율로 늘거나 줄어요"}
          class="rounded-sm text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground disabled:no-underline focus-ring"
        >
          {film()?.dur.toFixed(1) ?? "–"}s
        </button>
      }
    >
      <input
        ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
        type="number"
        step="0.5"
        min={MIN_DUR}
        max={MAX_DUR}
        value={film()?.dur}
        aria-label="전체 길이(초)"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") cancelled = true;
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
        onBlur={(e) => apply(e.currentTarget)}
        class="h-5 w-14 rounded-sm bg-input px-1 text-right font-mono text-xxs text-foreground outline-none focus-ring"
      />
      <span class="text-muted-foreground">s</span>
    </Show>
  );
}

/** "3분 전", "어제" — enough to tell a fresh render from yesterday's. */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

/** "1분 20초" — rounded, it is an estimate. */
function eta(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60 ? `${s % 60}초` : ""}`.trim();
}

function JobChip(props: { job: RenderJob }) {
  const { cancel } = useRender();
  const pct = () => (props.job.total ? props.job.done / props.job.total : 0);
  const remaining = () => {
    const { startedAt, done, total } = props.job;
    if (!startedAt || done < 2) return null;
    return ((Date.now() - startedAt) / done) * (total - done);
  };
  const title = () => `${props.job.label}${props.job.format ? ` · ${props.job.format}` : ""}`;

  return (
    <div class="flex shrink-0 items-center gap-2 rounded-md bg-muted px-2 py-1 text-[10px] text-foreground">
      <Show when={props.job.status === "done"}>
        <Check class="size-3" />
      </Show>
      <span classList={{ "text-muted-foreground": props.job.status === "done" || props.job.status === "cancelled" }}>{title()}</span>
      <Show when={props.job.status === "running"}>
        <div class="h-1 w-24 overflow-hidden rounded-full bg-background">
          <div class="h-full rounded-full bg-brand" style={{ width: `${pct() * 100}%` }} />
        </div>
        <span class="font-mono tabular-nums text-muted-foreground">{Math.floor(pct() * 100)}%</span>
        <Show when={remaining()}>{(ms) => <span class="text-muted-foreground">남은 ~{eta(ms())}</span>}</Show>
      </Show>
      <Show when={props.job.status === "queued"}>
        <span class="text-muted-foreground">대기 중</span>
      </Show>
      <Show when={props.job.status === "done"}>
        <span class="text-muted-foreground">완료</span>
      </Show>
      <Show when={props.job.status === "cancelled"}>
        <span class="text-muted-foreground">취소됨</span>
      </Show>
      <Show when={props.job.status === "error"}>
        <span class="max-w-64 truncate text-destructive" title={props.job.error}>
          실패 · {props.job.error}
        </span>
      </Show>
      <Show when={props.job.status === "running" || props.job.status === "queued"}>
        <button
          type="button"
          onClick={() => void cancel(props.job.id)}
          class="rounded-sm text-muted-foreground hover:text-destructive focus-ring"
          aria-label="렌더 취소"
        >
          <X class="size-3" />
        </button>
      </Show>
    </div>
  );
}

/**
 * The render queue as it concerns this film: what is rendering, waiting, just
 * finished or failed — and, briefly, that another film is holding the queue.
 */
function RenderQueue() {
  const params = useParams();
  const { jobs } = useRender();
  const { findFilm } = useFilms();
  const mine = () => jobs().filter((j) => j.film === params.film);
  const elsewhere = () => jobs().find((j) => j.film !== params.film && j.status === "running");

  return (
    <Show when={mine().length > 0 || elsewhere()}>
      <div class="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <span class="shrink-0 text-[10px] font-strong text-muted-foreground">렌더</span>
        <For each={mine()}>{(job) => <JobChip job={job} />}</For>
        <Show when={elsewhere()}>
          {(job) => (
            <span class="shrink-0 text-[10px] text-muted-foreground">
              다른 필름 '{findFilm(job().film)?.title ?? job().film}' 렌더 중 · {job().total ? Math.floor((job().done / job().total) * 100) : 0}%
            </span>
          )}
        </Show>
      </div>
    </Show>
  );
}

/** Renders under out/<film>/, per format: the full render, the latest draft, the poster. */
function Outputs() {
  const { files } = useFiles();
  // One group per format, so two or three formats still fit on one line.
  const groups = () =>
    (files()?.outputs ?? [])
      .map((o) => {
        const items: { label: string; kind: "video" | "image"; file: FilmFile }[] = [];
        if (o.final) items.push({ label: "완성본", kind: "video", file: o.final });
        // A draft newer than the final is a work in progress worth looking at.
        if (o.draft && (!o.final || o.draft.mtime > o.final.mtime + 1000)) items.push({ label: "초안", kind: "video", file: o.draft });
        if (o.poster) items.push({ label: "포스터", kind: "image", file: o.poster });
        return { format: o.format, items };
      })
      .filter((g) => g.items.length > 0);

  return (
    <div class="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <span class="shrink-0 text-[10px] font-strong text-muted-foreground">결과물</span>
      <Show when={groups().length > 0} fallback={<span class="text-[10px] text-muted-foreground">아직 렌더한 영상이 없어요.</span>}>
        <For each={groups()}>
          {(group) => (
            <div class="flex shrink-0 items-center rounded-md bg-muted text-[10px]">
              <span class="pl-2 pr-1 font-mono text-muted-foreground">{group.format}</span>
              <For each={group.items}>
                {(item) => (
                  <button
                    type="button"
                    onClick={() => openMedia({ kind: item.kind, url: item.file.url, title: `${group.format} ${item.label}` })}
                    title={`${group.format} ${item.label} · ${ago(item.file.mtime)}`}
                    class="flex items-center gap-1 rounded-md px-1.5 py-1 text-foreground hover:bg-foreground/10 focus-ring"
                  >
                    <Show when={item.kind === "video"} fallback={<Image class="size-3" />}>
                      <Film class="size-3" />
                    </Show>
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export function Player() {
  const params = useParams();
  const { findFilm } = useFilms();
  const { playing, toggle, film } = usePlayer();
  usePlayerKeys();

  return (
    <main class="@container flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-border bg-background p-3">
      {/* A narrow player gives way from the least needed: the size readout first, then the export label. */}
      <div class="flex h-8 items-center justify-between gap-3 px-1">
        <span class="min-w-0 truncate text-xxs font-strong text-foreground">{findFilm(params.film ?? "")?.title ?? params.film}</span>
        <div class="flex shrink-0 items-center gap-3">
          <Show when={film()}>
            {(f) => (
              <span class="hidden whitespace-nowrap font-mono text-[10px] text-muted-foreground @min-[600px]:inline">
                {f().W}×{f().H} · {f().bpm}BPM
              </span>
            )}
          </Show>
          <HistoryButtons />
          <FormatSwitch />
          <ExportButton />
        </div>
      </div>

      <Stage />

      <div class="flex items-center gap-3 px-1">
        <Button size="icon" variant="secondary" onClick={toggle} aria-label={playing() ? "정지" : "재생"}>
          <Show when={playing()} fallback={<Play />}>
            <Pause />
          </Show>
        </Button>
        <Timeline />
        <Readout />
      </div>

      <RenderQueue />
      <Outputs />
    </main>
  );
}
