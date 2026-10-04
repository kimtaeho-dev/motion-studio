import { createEffect, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";
import { useParams } from "@solidjs/router";
import { Check, Download, Loader, X } from "lucide-solid";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/context/player";
import { onServerEvent } from "@/lib/live";
import type { ExportJob, ExportKind } from "@/types";

const KINDS: { value: ExportKind; label: string; hint: string }[] = [
  { value: "mp4", label: "MP4", hint: "SNS·발표용" },
  { value: "gif", label: "GIF", hint: "소리 없음 · 슬랙·노션용" },
  { value: "prores", label: "ProRes 4444", hint: "편집 툴용 · 투명 배경 유지" },
  { value: "webm", label: "WebM", hint: "웹용 · 투명 배경 유지" },
  { value: "png", label: "포스터·컨택트 시트", hint: "대표 프레임 · 비트별 스틸" },
];

const label = "text-[10px] font-strong text-muted-foreground";

function Toggle(props: { on: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.on}
      class="flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left focus-ring"
      classList={{ "border-foreground bg-muted": props.on, "border-border hover:bg-accent": !props.on }}
    >
      <span class="text-xxs text-foreground">{props.title}</span>
      <Show when={props.hint}>
        <span class="text-[9px] text-muted-foreground">{props.hint}</span>
      </Show>
    </button>
  );
}

/** The player header's "내보내기": pick formats and kinds, then follow the export to its folder. */
export function ExportButton() {
  const params = useParams();
  const { film } = usePlayer();
  const [open, setOpen] = createSignal(false);
  const [formats, setFormats] = createSignal<string[]>([]);
  const [kinds, setKinds] = createSignal<ExportKind[]>(["mp4"]);
  const [zip, setZip] = createSignal(false);
  const [job, setJob] = createSignal<ExportJob | null>(null);
  const [canReveal, setCanReveal] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    void fetch("/__export")
      .then((r) => r.json() as Promise<{ job: ExportJob | null; canReveal: boolean }>)
      .then((data) => {
        setJob(data.job);
        setCanReveal(data.canReveal);
      });
  });
  onServerEvent<{ job: ExportJob | null }>("export:update", (payload) => setJob(payload.job));

  // Opening the dialog starts from every format the film has.
  createEffect(on(open, (isOpen) => isOpen && setFormats(film()?.formats ?? [])));

  // An export of this film: running, or finished and not yet dismissed.
  const mine = () => (job()?.film === params.film ? job() : null);
  const running = () => job()?.status === "running";

  const flip = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const start = async () => {
    setError(null);
    const res = await fetch("/__export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film: params.film, formats: formats(), kinds: kinds(), zip: zip() }),
    });
    const data = (await res.json()) as { job?: ExportJob; error?: string };
    if (!res.ok) setError(data.error ?? "내보내기를 시작하지 못했어요.");
    else if (data.job) setJob(data.job);
  };

  const cancel = () => void fetch("/__export/cancel", { method: "POST" });
  const reveal = () => void fetch("/__export/reveal", { method: "POST" });

  return (
    <>
      <Button size="sm" variant={running() && mine() ? "secondary" : "default"} onClick={() => setOpen(true)} disabled={!film()}>
        <Show when={running() && mine()} fallback={<Download />}>
          <Loader class="animate-spin" />
        </Show>
        내보내기
      </Button>

      <AlertDialog open={open()} onOpenChange={setOpen}>
        <AlertDialogContent class="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>내보내기</AlertDialogTitle>
            <AlertDialogDescription>
              다운로드 폴더의 Motion Studio 폴더에 모아 드려요. 필름이 바뀐 뒤라면 필요한 것만 다시 렌더해요.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Show
            when={mine()}
            fallback={
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1.5">
                  <span class={label}>포맷</span>
                  <div class="grid grid-cols-4 gap-1.5">
                    <For each={film()?.formats ?? []}>
                      {(f) => <Toggle on={formats().includes(f)} onClick={() => setFormats(flip(formats(), f))} title={f} />}
                    </For>
                  </div>
                </div>
                <div class="flex flex-col gap-1.5">
                  <span class={label}>형식</span>
                  <div class="grid grid-cols-2 gap-1.5">
                    <For each={KINDS}>
                      {(k) => <Toggle on={kinds().includes(k.value)} onClick={() => setKinds(flip(kinds(), k.value))} title={k.label} hint={k.hint} />}
                    </For>
                  </div>
                </div>
                <label class="flex items-center gap-2 text-xxs text-foreground">
                  <input type="checkbox" checked={zip()} onChange={(e) => setZip(e.currentTarget.checked)} class="accent-marker" />
                  zip 파일로도 묶기
                </label>
                <Show when={error()}>
                  <span class="text-xxs text-destructive">{error()}</span>
                </Show>
              </div>
            }
          >
            {(j) => (
              <div class="flex flex-col gap-3">
                <ol class="flex flex-col gap-1.5">
                  <For each={j().steps}>
                    {(step) => (
                      <li class="flex items-center gap-2 text-xxs">
                        <Switch fallback={<span class="size-3.5 rounded-full border border-border" />}>
                          <Match when={step.status === "running"}>
                            <Loader class="size-3.5 animate-spin text-marker" />
                          </Match>
                          <Match when={step.status === "done"}>
                            <Check class="size-3.5 text-foreground" />
                          </Match>
                          <Match when={step.status === "error"}>
                            <X class="size-3.5 text-destructive" />
                          </Match>
                        </Switch>
                        <span classList={{ "text-muted-foreground": step.status === "pending" }}>{step.label}</span>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={j().status === "running"}>
                  <span class="text-[10px] text-muted-foreground">렌더 진행률은 플레이어 아래 렌더 줄에서도 볼 수 있어요.</span>
                </Show>
                <Show when={j().status === "done"}>
                  <span class="text-xxs text-foreground">다 모았어요.</span>
                  <span class="break-all font-mono text-[10px] text-muted-foreground">{j().zip ?? j().dest}</span>
                </Show>
                <Show when={j().status === "error"}>
                  <pre class="whitespace-pre-wrap font-mono text-[10px] text-destructive">{j().error}</pre>
                </Show>
                <Show when={j().status === "cancelled"}>
                  <span class="text-xxs text-muted-foreground">내보내기를 취소했어요.</span>
                </Show>
              </div>
            )}
          </Show>

          <AlertDialogFooter>
            <Switch>
              <Match when={running() && mine()}>
                <Button variant="secondary" onClick={cancel}>
                  취소
                </Button>
                <Button onClick={() => setOpen(false)}>닫기</Button>
              </Match>
              <Match when={mine()}>
                <Button variant="secondary" onClick={() => setJob(null)}>
                  다시 내보내기
                </Button>
                <Show when={mine()?.status === "done" && canReveal()}>
                  <Button onClick={reveal}>Finder에서 보기</Button>
                </Show>
                <Show when={mine()?.status !== "done" || !canReveal()}>
                  <Button onClick={() => setOpen(false)}>닫기</Button>
                </Show>
              </Match>
              <Match when={true}>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  취소
                </Button>
                <Button onClick={() => void start()} disabled={!formats().length || !kinds().length || running()}>
                  내보내기
                </Button>
              </Match>
            </Switch>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
