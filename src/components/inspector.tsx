import { createResource, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { Markdown } from "@/lib/markdown";
import { useFiles } from "@/context/files";
import { usePlayer } from "@/context/player";
import { openMedia } from "@/components/media-viewer";
import type { FilmFile, FilmOutput } from "@/types";

type Tab = "props" | "review";

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

/** Values the agent opened up in film.json, and the named scene times. */
function PropsTab() {
  const { json, markers, time, seek } = usePlayer();
  const params = () => Object.entries(json()?.params ?? {});
  const current = () => [...markers()].reverse().find((m) => m.t <= time() + 1e-6)?.key;

  return (
    <div class="flex flex-col gap-4">
      <Section title="문구 · 색" when={params().length > 0} empty="이 필름에는 아직 바꿀 수 있게 열어 둔 값이 없어요.">
        <div class="flex flex-col">
          <For each={params()}>
            {([key, p]) => (
              <div class="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-xxs last:border-0">
                <span class="shrink-0 text-muted-foreground">{p.label || key}</span>
                <Switch fallback={<span class="truncate text-right text-foreground">{String(p.value)}</span>}>
                  <Match when={p.type === "color"}>
                    <span class="flex items-center gap-1.5 font-mono text-[10px] text-foreground">
                      <span class="size-3.5 rounded-sm border border-border" style={{ background: String(p.value) }} />
                      {String(p.value).toUpperCase()}
                    </span>
                  </Match>
                  <Match when={p.type === "number"}>
                    <span class="font-mono text-[10px] text-foreground">{String(p.value)}</span>
                  </Match>
                </Switch>
              </div>
            )}
          </For>
        </div>
        <span class="text-[10px] text-muted-foreground">값을 바꾸고 싶으면 에이전트에게 말해 주세요.</span>
      </Section>

      <Section title="장면" when={markers().length > 0} empty="장면 이름은 숏리스트가 확정되면 생겨요.">
        <div class="flex flex-col">
          <For each={markers()}>
            {(m) => (
              <button
                type="button"
                onClick={() => seek(m.t)}
                class="flex items-center justify-between gap-3 rounded-sm px-1 py-1 text-left text-xxs hover:bg-accent focus-ring"
                classList={{ "bg-muted": current() === m.key }}
              >
                <span class="truncate text-foreground">{m.label}</span>
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{m.t.toFixed(2)}s</span>
              </button>
            )}
          </For>
        </div>
      </Section>
    </div>
  );
}

/** Shotlist, contact sheet, critique and brief — what the agent wrote down, readable. */
function ReviewTab() {
  const { files } = useFiles();
  const { format } = usePlayer();
  // The format on screen, or whichever one has renders.
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
  const [tab, setTabSignal] = createSignal<Tab>("review");
  let body: HTMLDivElement | undefined;
  // Each tab starts at its top; the other tab's scroll position means nothing here.
  const setTab = (next: Tab) => {
    setTabSignal(next);
    body?.scrollTo({ top: 0 });
  };
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
      <div ref={body} class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Show when={tab() === "review"} fallback={<PropsTab />}>
          <ReviewTab />
        </Show>
      </div>
    </section>
  );
}
