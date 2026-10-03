import { createMemo, For, onCleanup, onMount, Show } from "solid-js";
import { Check, Film, Image, Pause, Play, X } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/context/player";
import { useFilms } from "@/context/films";
import { useFiles } from "@/context/files";
import { useRender } from "@/context/render";
import { openMedia } from "@/components/media-viewer";
import type { FilmFile, RenderJob } from "@/types";
import { useParams } from "@solidjs/router";

const pct = (t: number, dur: number) => `${(t / dur) * 100}%`;

/** Keys that drive the player — ignored while the user is typing anywhere. */
function usePlayerKeys() {
  const { toggle, stepFrames, stepBeats, seek } = usePlayer();
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
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

function Timeline() {
  const { film, markers, time, seek, playing, toggle } = usePlayer();
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

  let wasPlaying = false;
  const timeAt = (e: PointerEvent) => {
    const r = el!.getBoundingClientRect();
    let t = Math.min(Math.max(0, (e.clientX - r.left) / r.width), 0.99999) * dur();
    const f = film();
    if (e.shiftKey && f) {
      // Shift snaps to the beat grid, the unit everything in a film is laid out on.
      const len = 60 / f.bpm;
      t = f.beatOffset + Math.round((t - f.beatOffset) / len) * len;
    }
    return t;
  };
  const onDown = (e: PointerEvent) => {
    wasPlaying = playing();
    if (wasPlaying) toggle();
    el!.setPointerCapture(e.pointerId);
    seek(timeAt(e));
  };
  const onMove = (e: PointerEvent) => {
    if (el!.hasPointerCapture(e.pointerId)) seek(timeAt(e));
  };
  const onUp = (e: PointerEvent) => {
    el!.releasePointerCapture(e.pointerId);
    if (wasPlaying) toggle();
  };

  return (
    <div
      ref={el}
      class="relative h-14 flex-1 cursor-pointer select-none touch-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* Bars and beats */}
      <For each={beats()}>
        {(b) => (
          <div class="absolute top-0 h-full" style={{ left: pct(b.t, dur()) }}>
            <div class="absolute bottom-3 w-px" classList={{ "h-8 bg-muted-foreground/40": b.bar !== null, "h-2 bg-muted-foreground/20": b.bar === null }} />
            <Show when={b.bar !== null}>
              <span class="absolute top-0 left-1 font-mono text-[9px] text-muted-foreground">{b.bar}</span>
            </Show>
          </div>
        )}
      </For>
      {/* Named scene times from film.json */}
      <For each={markers()}>
        {(m) => (
          <div class="group absolute top-3 bottom-3 w-2 -translate-x-1" style={{ left: pct(m.t, dur()) }} title={`${m.label} · ${m.t.toFixed(2)}s`}>
            <div class="mx-auto h-full w-0.5 rounded-full bg-marker/50 group-hover:bg-marker" />
          </div>
        )}
      </For>
      {/* Sound cues */}
      <For each={film()?.cues ?? []}>
        {(c) => <div class="absolute bottom-1 size-1 -translate-x-1/2 rounded-full bg-cue" style={{ left: pct(c.t, dur()) }} title={c.type} />}
      </For>
      {/* Playhead */}
      <div class="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: pct(time(), dur()) }} />
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
        <span class="text-muted-foreground"> / {film()?.dur.toFixed(1) ?? "–"}s</span>
      </span>
      <span class="truncate text-[10px] text-muted-foreground">
        <Show when={beat()}>{(b) => <>{b().bar}마디 {b().beat}박</>}</Show>
        <Show when={scene()}>{(s) => <> · {s()}</>}</Show>
      </span>
    </div>
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
          <div class="h-full rounded-full bg-marker" style={{ width: `${pct() * 100}%` }} />
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
      <div class="flex min-h-7 items-center gap-2 overflow-x-auto px-1">
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

/** Renders under out/<film>/, per format: the final with sound, the latest silent render, the poster. */
function Outputs() {
  const { files } = useFiles();
  const items = () =>
    (files()?.outputs ?? []).flatMap((o) => {
      const list: { label: string; kind: "video" | "image"; file: FilmFile }[] = [];
      if (o.final) list.push({ label: `${o.format} 완성본`, kind: "video", file: o.final });
      // A silent render newer than the final is a work in progress worth looking at.
      if (o.silent && (!o.final || o.silent.mtime > o.final.mtime + 1000)) list.push({ label: `${o.format} 무음 영상`, kind: "video", file: o.silent });
      if (o.poster) list.push({ label: `${o.format} 포스터`, kind: "image", file: o.poster });
      return list;
    });

  return (
    <div class="flex min-h-7 items-center gap-2 overflow-x-auto px-1">
      <span class="shrink-0 text-[10px] font-strong text-muted-foreground">결과물</span>
      <Show when={items().length > 0} fallback={<span class="text-[10px] text-muted-foreground">아직 렌더한 영상이 없어요.</span>}>
        <For each={items()}>
          {(item) => (
            <button
              type="button"
              onClick={() => openMedia({ kind: item.kind, url: item.file.url, title: item.label })}
              class="flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[10px] text-foreground hover:bg-foreground/10 focus-ring"
            >
              <Show when={item.kind === "video"} fallback={<Image class="size-3" />}>
                <Film class="size-3" />
              </Show>
              {item.label}
              <span class="text-muted-foreground">{ago(item.file.mtime)}</span>
            </button>
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
    <main class="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-border bg-background p-3">
      <div class="flex h-6 items-center justify-between gap-3 px-1">
        <span class="truncate text-xxs font-strong text-foreground">{findFilm(params.film ?? "")?.title ?? params.film}</span>
        <div class="flex items-center gap-3">
          <Show when={film()}>
            {(f) => (
              <span class="font-mono text-[10px] text-muted-foreground">
                {f().W}×{f().H} · {f().bpm}BPM
              </span>
            )}
          </Show>
          <FormatSwitch />
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
