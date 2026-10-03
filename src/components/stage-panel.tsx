import { For, Show } from "solid-js";
import { useFiles } from "@/context/files";
import { FILM_STAGES, type FilmQuality, type FilmStage } from "@/types";

const STAGE_LABEL: Record<FilmStage, string> = {
  brief: "브리프",
  shotlist: "숏리스트",
  stills: "스틸",
  draft: "초안",
  critique: "검수",
  deliver: "전달",
};

/** What the designer can expect next, per stage — said once, under the steps. */
const STAGE_HINT: Record<FilmStage, string> = {
  brief: "에이전트가 무엇을 만들지 묻고 브리프를 채워요.",
  shotlist: "비트별 장면 목록을 확인하고 승인하면 만들기 시작해요.",
  stills: "비트마다 한 장씩 렌더해서 화면 구성을 다듬는 중이에요.",
  draft: "빠른 초안으로 타이밍을 확인하는 단계예요.",
  critique: "완성본을 렌더하고 점수를 매겨 고치는 중이에요.",
  deliver: "완성됐어요. 아래 결과물에서 영상을 받을 수 있어요.",
};

export const QUALITY_LABEL: Record<FilmQuality, { label: string; hint: string }> = {
  fast: { label: "빠르게", hint: "검수 1라운드" },
  standard: { label: "기본", hint: "검수 3라운드" },
  launch: { label: "런칭용", hint: "모든 항목 8점 이상까지" },
};

/** Where the open film is in the pipeline (CLAUDE.md, 작업 순서). */
export function StagePanel() {
  const { files } = useFiles();
  const index = () => {
    const stage = files()?.stage;
    return stage ? FILM_STAGES.indexOf(stage) : -1;
  };

  return (
    <section class="flex w-[380px] shrink-0 flex-col gap-2.5 rounded-2xl border border-border bg-background px-4 py-3">
      <div class="flex items-center justify-between">
        <span class="text-xxs font-strong text-foreground">진행 단계</span>
        <Show when={files()}>
          {(f) => (
            <span class="text-[10px] text-muted-foreground">
              품질 {QUALITY_LABEL[f().quality].label} · {QUALITY_LABEL[f().quality].hint}
            </span>
          )}
        </Show>
      </div>

      <ol class="grid grid-cols-6 gap-1">
        <For each={FILM_STAGES}>
          {(stage, i) => {
            const state = () => (i() < index() ? "done" : i() === index() ? "current" : "todo");
            return (
              <li class="flex flex-col gap-1">
                <span
                  class="h-1 rounded-full"
                  classList={{
                    "bg-foreground": state() === "done",
                    "bg-marker": state() === "current",
                    "bg-muted": state() === "todo",
                  }}
                />
                <span
                  class="text-[10px]"
                  classList={{
                    "text-foreground font-strong": state() === "current",
                    "text-muted-foreground": state() !== "current",
                  }}
                >
                  {STAGE_LABEL[stage]}
                </span>
              </li>
            );
          }}
        </For>
      </ol>

      <Show when={files()?.stage}>{(stage) => <span class="text-[10px] text-muted-foreground">{STAGE_HINT[stage()]}</span>}</Show>
    </section>
  );
}
