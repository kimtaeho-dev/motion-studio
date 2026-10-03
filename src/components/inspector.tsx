import { createResource, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { Markdown } from "@/lib/markdown";
import { useFiles } from "@/context/files";
import { usePlayer, type Marker } from "@/context/player";
import { cloneFilm, useEditor } from "@/context/editor";
import { openMedia } from "@/components/media-viewer";
import type { FilmFile, FilmJson, FilmOutput, FilmParam } from "@/types";

type Tab = "props" | "review";

// Module-level so the stage panel can bring the shotlist into view when it asks for approval.
const [tab, setTabSignal] = createSignal<Tab>("review");
let scrollBody: HTMLDivElement | undefined;

/** Switch the inspector to a tab, scrolled to its top. */
export function showInspectorTab(next: Tab): void {
  setTabSignal(next);
  scrollBody?.scrollTo({ top: 0 });
}

async function loadText(url: string | undefined): Promise<string> {
  if (!url) return "";
  const res = await fetch(url, { cache: "no-store" });
  return res.ok ? res.text() : "";
}

/**
 * The brief is written in the XML-ish spec format (prompts/spec-template.md);
 * the section tags are for the agent, not for reading.
 */
function readable(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^\s*<\/?[a-z_]+>\s*$/i.test(line) && !/^>\s*`prompts\//.test(line))
    .join("\n");
}

function Section(props: { title: string; children: JSX.Element; empty?: string; when: unknown }) {
  return (
    <section class="flex flex-col gap-1.5">
      <span class="text-[10px] font-strong uppercase tracking-wide text-muted-foreground">{props.title}</span>
      <Show when={props.when} fallback={<span class="text-xxs text-muted-foreground">{props.empty}</span>}>
        {props.children}
      </Show>
    </section>
  );
}

function Doc(props: { file?: FilmFile; transform?: (text: string) => string }) {
  const [text] = createResource(() => props.file?.url, loadText);
  return (
    <div class="text-xxs text-foreground">
      <Markdown text={(props.transform ?? ((t: string) => t))(text.latest ?? "")} />
    </div>
  );
}

function Thumb(props: { file: FilmFile; title: string; class?: string }) {
  return (
    <button
      type="button"
      onClick={() => openMedia({ kind: "image", url: props.file.url, title: props.title })}
      class={`overflow-hidden rounded-md border border-border bg-stage focus-ring ${props.class ?? ""}`}
    >
      <img src={props.file.url} alt={props.title} class="block w-full" loading="lazy" />
    </button>
  );
}

/**
 * One editing gesture on a field: the state before it starts is remembered so
 * typing a whole word (or dragging a slider) undoes as one step.
 */
function useGesture() {
  const { json } = usePlayer();
  const { preview, commit } = useEditor();
  let before: FilmJson | null = null;
  return {
    change(mutate: (draft: FilmJson) => void) {
      const current = json();
      if (!current) return;
      before ??= cloneFilm(current);
      const draft = cloneFilm(current);
      mutate(draft);
      preview(draft);
    },
    end() {
      const current = json();
      if (before && current) commit(current, before);
      before = null;
    },
  };
}

const field = "h-7 rounded-md bg-input px-2 text-xxs text-foreground outline-none focus-ring disabled:opacity-50";

function ParamField(props: { name: string; param: FilmParam }) {
  const { locked } = useEditor();
  const gesture = useGesture();
  const set = (value: string | number) => gesture.change((d) => (d.params![props.name].value = value));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.isComposing) (e.currentTarget as HTMLInputElement).blur();
  };

  return (
    <div class="flex flex-col gap-1 border-b border-border/60 py-2 last:border-0">
      <span class="text-[10px] text-muted-foreground">{props.param.label || props.name}</span>
      <Switch>
        <Match when={props.param.type === "color"}>
          <div class="flex items-center gap-2">
            <input
              type="color"
              value={String(props.param.value)}
              disabled={locked()}
              onInput={(e) => set(e.currentTarget.value.toUpperCase())}
              onChange={() => gesture.end()}
              class="h-7 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
            />
            <input
              value={String(props.param.value).toUpperCase()}
              disabled={locked()}
              maxLength={7}
              onInput={(e) => {
                const v = e.currentTarget.value.trim();
                // Only a complete colour reaches the film; half-typed hex would be rejected anyway.
                if (/^#[0-9a-fA-F]{6}$/.test(v)) set(v.toUpperCase());
              }}
              onBlur={() => gesture.end()}
              onKeyDown={onKey}
              class={`${field} w-24 font-mono`}
            />
          </div>
        </Match>
        <Match when={props.param.type === "number"}>
          <div class="flex items-center gap-2">
            <Show when={props.param.min !== undefined && props.param.max !== undefined}>
              <input
                type="range"
                min={props.param.min}
                max={props.param.max}
                step={props.param.step ?? "any"}
                value={Number(props.param.value)}
                disabled={locked()}
                onInput={(e) => set(Number(e.currentTarget.value))}
                onChange={() => gesture.end()}
                class="min-w-0 flex-1 accent-marker"
              />
            </Show>
            <input
              type="number"
              min={props.param.min}
              max={props.param.max}
              step={props.param.step ?? "any"}
              value={Number(props.param.value)}
              disabled={locked()}
              onInput={(e) => {
                const n = Number(e.currentTarget.value);
                if (e.currentTarget.value !== "" && Number.isFinite(n)) set(n);
              }}
              onBlur={() => gesture.end()}
              onKeyDown={onKey}
              class={`${field} w-20 font-mono`}
            />
          </div>
        </Match>
        <Match when={props.param.type === "text"}>
          <input
            value={String(props.param.value)}
            disabled={locked()}
            onInput={(e) => set(e.currentTarget.value)}
            onBlur={() => gesture.end()}
            onKeyDown={onKey}
            class={`${field} w-full`}
          />
        </Match>
      </Switch>
    </div>
  );
}

function SceneRow(props: { marker: Marker; current: boolean }) {
  const { seek, film } = usePlayer();
  const { locked } = useEditor();
  const gesture = useGesture();
  const beat = () => {
    const f = film();
    if (!f) return "";
    const b = ((props.marker.t - f.beatOffset) * f.bpm) / 60;
    return `${Math.floor(b / 4) + 1}마디 ${(Math.floor(b + 1e-6) % 4) + 1}박`;
  };
  return (
    <div class="flex items-center gap-2 rounded-sm px-1 py-1 text-xxs" classList={{ "bg-muted": props.current }}>
      <button type="button" onClick={() => seek(props.marker.t)} class="min-w-0 flex-1 truncate text-left text-foreground hover:underline focus-ring">
        {props.marker.label}
      </button>
      <span class="shrink-0 text-[10px] text-muted-foreground">{beat()}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        max={film()?.dur}
        value={props.marker.t}
        disabled={locked()}
        onInput={(e) => {
          const t = Number(e.currentTarget.value);
          const dur = film()?.dur ?? Infinity;
          if (e.currentTarget.value !== "" && t >= 0 && t <= dur) gesture.change((d) => (d.timeline![props.marker.key].t = Math.round(t * 1000) / 1000));
        }}
        onBlur={() => gesture.end()}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        class={`${field} w-20 shrink-0 text-right font-mono`}
      />
    </div>
  );
}

/** Values the agent opened up in film.json, and the named scene times — both editable. */
function PropsTab() {
  const { json, markers, time } = usePlayer();
  const { locked, editError } = useEditor();
  // Keyed by name, not by object: every keystroke makes a new film.json, and
  // re-creating the field under the cursor would drop its focus.
  const names = () => Object.keys(json()?.params ?? {});
  const keys = () => markers().map((m) => m.key);
  const marker = (key: string) => markers().find((m) => m.key === key);
  const current = () => [...markers()].reverse().find((m) => m.t <= time() + 1e-6)?.key;

  return (
    <div class="flex flex-col gap-4">
      <Show when={locked()}>
        <span class="rounded-md bg-muted px-2 py-1.5 text-[10px] text-muted-foreground">
          에이전트가 이 필름을 고치는 중이라 잠시 편집을 잠갔어요. 답이 오면 다시 바꿀 수 있어요.
        </span>
      </Show>
      <Show when={editError()}>
        <span class="text-[10px] text-destructive">{editError()}</span>
      </Show>

      <Section title="문구 · 색" when={names().length > 0} empty="이 필름에는 아직 바꿀 수 있게 열어 둔 값이 없어요. 에이전트에게 열어 달라고 할 수 있어요.">
        <div class="flex flex-col">
          <For each={names()}>{(name) => <Show when={json()?.params?.[name]}>{(param) => <ParamField name={name} param={param()} />}</Show>}</For>
        </div>
      </Section>

      <Section title="장면" when={markers().length > 0} empty="장면 이름은 숏리스트가 확정되면 생겨요.">
        <div class="flex flex-col">
          <For each={keys()}>{(key) => <Show when={marker(key)}>{(m) => <SceneRow marker={m()} current={current() === key} />}</Show>}</For>
        </div>
        <span class="text-[10px] text-muted-foreground">타임라인의 장면 표시를 끌어서 옮길 수도 있어요. 비트에 맞춰 붙고, Alt를 누르면 프레임 단위로 움직여요.</span>
      </Section>
    </div>
  );
}

interface ScoreRound {
  round: number;
  scores: { name: string; score: number | null }[];
}

/**
 * The scores out of review_log.md: under each "## 라운드 N" heading, a line
 * "점수: 훅 8 · 가독성 7 · … · 사운드 —" (CLAUDE.md 6번, prompts/critique-pass.md).
 */
export function parseScores(markdown: string): ScoreRound[] {
  const rounds: ScoreRound[] = [];
  const parts = markdown.split(/^##\s*라운드\s*(\d+).*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    // The agent may bold the label ("**점수**: …"); the scores are what follows either way.
    const line = /^\s*\**\s*점수\s*\**\s*[:：]\s*\**\s*(.+?)\**\s*$/m.exec(parts[i + 1] ?? "");
    if (!line) continue;
    const scores = line[1]
      .split(/[·,|]/)
      .map((item) => /^\s*(.+?)\s+(\d+(?:\.\d+)?|—|-)\s*$/.exec(item))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1], score: /\d/.test(m[2]) ? Number(m[2]) : null }));
    if (scores.length) rounds.push({ round: Number(parts[i]), scores });
  }
  return rounds;
}

function ScoreTable(props: { rounds: ScoreRound[] }) {
  const names = () => props.rounds.at(-1)?.scores.map((s) => s.name) ?? [];
  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-center text-[10px]">
        <thead>
          <tr>
            <th class="px-1 py-1 text-left font-normal text-muted-foreground">라운드</th>
            <For each={names()}>{(n) => <th class="px-1 py-1 font-normal whitespace-nowrap text-muted-foreground">{n}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rounds}>
            {(r) => (
              <tr class="border-t border-border/60">
                <td class="px-1 py-1 text-left font-mono text-muted-foreground">{r.round}</td>
                <For each={names()}>
                  {(n) => {
                    const score = () => r.scores.find((s) => s.name === n)?.score ?? null;
                    return (
                      <td
                        class="px-1 py-1 font-mono"
                        classList={{
                          "text-foreground font-strong": score() !== null && score()! >= 8,
                          "text-destructive": score() !== null && score()! < 8,
                          "text-muted-foreground": score() === null,
                        }}
                      >
                        {score() ?? "—"}
                      </td>
                    );
                  }}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/** Shotlist, contact sheet, critique and brief — what the agent wrote down, readable. */
function ReviewTab() {
  const { files } = useFiles();
  const { format } = usePlayer();
  // The format on screen, or whichever one has renders.
  const [review] = createResource(() => files()?.docs.review?.url, loadText);
  const scores = () => parseScores(review.latest ?? "");
  const output = (): FilmOutput | undefined => {
    const outs = files()?.outputs ?? [];
    return outs.find((o) => o.format === format()) ?? outs[0];
  };

  return (
    <div class="flex flex-col gap-4">
      <Section title="숏리스트" when={files()?.docs.shotlist} empty="브리프가 정해지면 에이전트가 비트별 장면 목록을 써요.">
        <Doc file={files()?.docs.shotlist} />
      </Section>

      <Section title={`컨택트 시트${output() ? ` · ${output()!.format}` : ""}`} when={output()?.contact} empty="숏리스트가 승인되면 비트마다 한 장씩 렌더해요.">
        <Thumb file={output()!.contact!} title={`컨택트 시트 · ${output()!.format}`} />
      </Section>

      <Section title="검수" when={files()?.docs.review} empty="완성본을 렌더하면 점수와 고친 점이 여기에 쌓여요.">
        <Show when={scores().length > 0}>
          <ScoreTable rounds={scores()} />
        </Show>
        <Show when={output()?.critique.length}>
          <div class="grid grid-cols-2 gap-1.5">
            <For each={output()!.critique}>
              {(img) => (
                <div class="flex flex-col gap-0.5">
                  <Thumb file={img} title={`검수 · ${img.name} · ${output()!.format}`} />
                  <span class="font-mono text-[10px] text-muted-foreground">{img.name}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Doc file={files()?.docs.review} />
      </Section>

      <Section title="브리프" when={files()?.docs.brief} empty="">
        <Doc file={files()?.docs.brief} transform={readable} />
      </Section>
    </div>
  );
}

export function Inspector() {
  // Each tab starts at its top; the other tab's scroll position means nothing here.
  const setTab = showInspectorTab;
  const TABS: { value: Tab; label: string }[] = [
    { value: "review", label: "리뷰" },
    { value: "props", label: "속성" },
  ];

  return (
    <section class="flex min-h-0 w-[380px] flex-1 shrink-0 flex-col rounded-2xl border border-border bg-background">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
        <For each={TABS}>
          {(t) => (
            <button
              type="button"
              onClick={() => setTab(t.value)}
              class="rounded-md px-2 py-1 text-xxs focus-ring"
              classList={{
                "bg-muted text-foreground font-strong": tab() === t.value,
                "text-muted-foreground hover:text-foreground": tab() !== t.value,
              }}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <div ref={scrollBody} class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Show when={tab() === "review"} fallback={<PropsTab />}>
          <ReviewTab />
        </Show>
      </div>
    </section>
  );
}
