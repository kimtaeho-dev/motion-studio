import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Button } from "@/components/ui/button";
import { showInspectorTab } from "@/components/inspector";
import { useChat } from "@/context/chat";
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

/** What the designer can expect, per stage, when nothing is waiting on them. */
const STAGE_HINT: Record<FilmStage, string> = {
  brief: "에이전트가 무엇을 만들지 묻고 브리프를 채워요.",
  shotlist: "비트별 장면 목록을 쓰고 있어요. 다 쓰면 승인을 부탁드릴게요.",
  stills: "비트마다 한 장씩 렌더해서 화면 구성을 다듬는 중이에요.",
  draft: "빠른 초안으로 타이밍을 확인하는 단계예요.",
  critique: "완성본을 렌더하고 점수를 매겨 고치는 중이에요.",
  deliver: "완성됐어요. 플레이어 아래 결과물에서 영상을 볼 수 있어요.",
};

export const QUALITY_LABEL: Record<FilmQuality, { label: string; hint: string; rounds: number | null }> = {
  fast: { label: "빠르게", hint: "검수 1라운드", rounds: 1 },
  standard: { label: "기본", hint: "검수 3라운드", rounds: 3 },
  launch: { label: "런칭용", hint: "모든 항목 8점 이상까지", rounds: null },
};

/** Where the open film is in the pipeline (CLAUDE.md, 작업 순서), and what it needs from the designer. */
export function StagePanel() {
  const { files } = useFiles();
  const { approve, compose, messages, progress } = useChat();
  const [approving, setApproving] = createSignal(false);

  const index = () => {
    const stage = files()?.stage;
    return stage ? FILM_STAGES.indexOf(stage) : -1;
  };
  const busy = () => messages().some((m) => m.status === "pending" || m.status === "processing");
  const waiting = () => (busy() ? null : files()?.waiting ?? null);
  const round = () => {
    const f = files();
    if (!f || f.stage !== "critique" || !f.round) return null;
    const total = QUALITY_LABEL[f.quality].rounds;
    return total ? `검수 ${f.round}/${total}라운드` : `검수 ${f.round}라운드`;
  };

  const onApprove = async () => {
    setApproving(true);
    try {
      await approve("shotlist");
    } finally {
      setApproving(false);
    }
  };

  const onRevise = () => {
    showInspectorTab("review");
    compose("숏리스트에서 바꿀 점: ");
  };

  return (
    <section
      class="flex w-[380px] shrink-0 flex-col gap-2.5 rounded-2xl border bg-background px-4 py-3"
      classList={{ "border-marker": waiting() === "approval", "border-border": waiting() !== "approval" }}
    >
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

      <Switch
        fallback={
          <Show when={files()?.stage}>
            {(stage) => (
              <span class="text-[10px] text-muted-foreground">
                <Show when={round()}>{(r) => <span class="text-foreground">{r()} · </span>}</Show>
                {STAGE_HINT[stage()]}
              </span>
            )}
          </Show>
        }
      >
        <Match when={busy()}>
          <span class="truncate text-[10px] text-muted-foreground">
            <span class="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-marker align-middle" />
            {progress()?.step ?? "에이전트가 작업을 준비하는 중"}
            <Show when={round()}>{(r) => <> · {r()}</>}</Show>
          </span>
        </Match>
        <Match when={waiting() === "approval"}>
          <div class="flex flex-col gap-2">
            <span class="text-xxs text-foreground">숏리스트를 확인해 주세요. 승인하면 화면을 만들기 시작해요.</span>
            <div class="flex gap-1.5">
              <Button size="sm" onClick={() => void onApprove()} disabled={approving()}>
                숏리스트 승인
              </Button>
              <Button size="sm" variant="secondary" onClick={onRevise}>
                수정 요청
              </Button>
            </div>
          </div>
        </Match>
        <Match when={waiting() === "answer"}>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xxs text-foreground">에이전트가 질문했어요. 채팅에서 답해 주세요.</span>
            <Button size="sm" variant="secondary" onClick={() => compose("")}>
              답하기
            </Button>
          </div>
        </Match>
      </Switch>
    </section>
  );
}
