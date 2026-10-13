import { createMemo, createSignal, For, Index, Show } from "solid-js";
import { Button } from "@/components/ui/button";
import type { FilmQuestion } from "@/types";

/** What the designer picked for one question: option indexes, and the 직접 입력 text when that is picked. */
interface Answer {
  picked: number[];
  custom: string | null;
}

/** A custom answer is the extra choice after the agent's options. */
const CUSTOM = -1;

/** "어디에 올리나요? → 인스타 릴스" — one line per question, so the agent reads the answer as plainly as a typed one. */
export function formatAnswers(questions: FilmQuestion[], answers: Answer[]): string {
  return questions
    .map((q, i) => {
      const a = answers[i];
      const parts = a.picked.map((p) => q.options[p]);
      if (a.custom !== null && a.custom.trim()) parts.push(q.options.length ? `직접 입력: ${a.custom.trim()}` : a.custom.trim());
      return `${q.q} → ${parts.join(", ")}`;
    })
    .join("\n");
}

/**
 * The agent's brief questions (tools/ask.mjs) as choices: pick one (or several
 * for a multi question), or type an answer. Sending posts the answers as an
 * ordinary chat message.
 */
export function QuestionCard(props: { questions: FilmQuestion[]; disabled?: boolean; onSubmit: (text: string) => void }) {
  const [answers, setAnswers] = createSignal<Answer[]>(props.questions.map(() => ({ picked: [], custom: null })));

  const update = (i: number, next: (a: Answer) => Answer) => setAnswers((list) => list.map((a, j) => (j === i ? next(a) : a)));

  const pick = (i: number, option: number) =>
    update(i, (a) => {
      const q = props.questions[i];
      if (option === CUSTOM) {
        // Single choice: typing replaces the pick. Multi: it is one more answer.
        return a.custom === null ? { picked: q.multi ? a.picked : [], custom: "" } : { ...a, custom: null };
      }
      if (q.multi) return { ...a, picked: a.picked.includes(option) ? a.picked.filter((p) => p !== option) : [...a.picked, option].sort() };
      return { picked: [option], custom: null };
    });

  const answered = (a: Answer) => a.picked.length > 0 || !!a.custom?.trim();
  const ready = createMemo(() => answers().every(answered));

  return (
    <div class="flex flex-col gap-3 rounded-lg border border-border bg-background px-3 py-3">
      <Index each={props.questions}>
        {(q, i) => {
          const a = () => answers()[i];
          return (
            <div class="flex flex-col gap-1.5">
              <div class="flex flex-col gap-0.5">
                <span class="text-xxs font-strong text-foreground">
                  {props.questions.length > 1 && <span class="mr-1 text-muted-foreground">{i + 1}.</span>}
                  {q().q}
                  <Show when={q().multi}>
                    <span class="ml-1 font-normal text-muted-foreground">(여러 개)</span>
                  </Show>
                </span>
                <Show when={q().hint}>
                  <span class="text-[10px] text-muted-foreground">{q().hint}</span>
                </Show>
              </div>
              <Show when={q().options.length > 0}>
                <div class="flex flex-col gap-1">
                  <For each={q().options}>
                    {(option, o) => (
                      <button
                        type="button"
                        disabled={props.disabled}
                        onClick={() => pick(i, o())}
                        aria-pressed={a().picked.includes(o())}
                        class="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xxs focus-ring disabled:opacity-50"
                        classList={{
                          "border-foreground bg-muted text-foreground": a().picked.includes(o()),
                          "border-border text-foreground hover:bg-accent": !a().picked.includes(o()),
                        }}
                      >
                        <span class="min-w-0 break-words">{option}</span>
                        <Show when={q().recommended === o()}>
                          <span class="shrink-0 text-[10px] text-muted-foreground">추천</span>
                        </Show>
                      </button>
                    )}
                  </For>
                  <button
                    type="button"
                    disabled={props.disabled}
                    onClick={() => pick(i, CUSTOM)}
                    aria-pressed={a().custom !== null}
                    class="rounded-md border px-2 py-1.5 text-left text-xxs focus-ring disabled:opacity-50"
                    classList={{
                      "border-foreground bg-muted text-foreground": a().custom !== null,
                      "border-dashed border-border text-muted-foreground hover:bg-accent": a().custom === null,
                    }}
                  >
                    직접 입력
                  </button>
                </div>
              </Show>
              <Show when={q().options.length === 0 || a().custom !== null}>
                <input
                  ref={(el) => q().options.length > 0 && queueMicrotask(() => el.focus())}
                  type="text"
                  disabled={props.disabled}
                  value={a().custom ?? ""}
                  onInput={(e) => update(i, (prev) => ({ ...prev, custom: e.currentTarget.value }))}
                  onKeyDown={(e) => {
                    if (e.isComposing || e.key !== "Enter") return;
                    e.preventDefault();
                    if (ready() && !props.disabled) props.onSubmit(formatAnswers(props.questions, answers()));
                  }}
                  placeholder="답을 입력해 주세요"
                  class="h-7 rounded-md bg-input px-2 text-xxs text-foreground outline-none focus-ring"
                />
              </Show>
            </div>
          );
        }}
      </Index>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] text-muted-foreground">
          {ready() ? "" : `${answers().filter(answered).length}/${props.questions.length} 답함`}
        </span>
        <Button size="sm" disabled={!ready() || props.disabled} onClick={() => props.onSubmit(formatAnswers(props.questions, answers()))}>
          답 보내기
        </Button>
      </div>
    </div>
  );
}
