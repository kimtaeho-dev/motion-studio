import { createSignal, For, Show } from "solid-js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { QUALITY_LABEL } from "@/components/stage-panel";
import { useFilms } from "@/context/films";
import { LOTTIE_DUR, LOTTIE_SIZES, type FilmKind, type FilmQuality } from "@/types";

// Kept in sync with FORMAT_SIZES in server/films.ts.
const FORMATS = [
  { value: "1x1", label: "정사각", size: "1080×1080" },
  { value: "9x16", label: "세로", size: "1080×1920" },
  { value: "16x9", label: "가로", size: "1920×1080" },
  { value: "4x5", label: "피드", size: "1080×1350" },
];

const QUALITIES: FilmQuality[] = ["fast", "standard", "launch"];

// Designers think in where the result goes, not in file formats.
const KINDS: { value: FilmKind; label: string; hint: string }[] = [
  { value: "film", label: "영상으로 올릴 것", hint: "MP4 · SNS · 발표 · 출시 릴" },
  { value: "lottie", label: "앱·웹에 넣을 것", hint: "Lottie · 개발자에게 전달" },
];

const label = "text-[10px] font-strong text-muted-foreground";

export function NewFilmDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (slug: string) => void }) {
  const { createFilm } = useFilms();
  const [kind, setKind] = createSignal<FilmKind>("film");
  const [size, setSize] = createSignal<string>(LOTTIE_SIZES[0].value);
  const [name, setName] = createSignal("새 필름");
  const [formats, setFormats] = createSignal<string[]>(["1x1"]);
  const [dur, setDur] = createSignal(12);
  const [quality, setQuality] = createSignal<FilmQuality>("standard");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const toggleFormat = (f: string) =>
    setFormats((list) => (list.includes(f) ? (list.length > 1 ? list.filter((x) => x !== f) : list) : [...list, f]));

  const lottie = () => kind() === "lottie";
  const durRange = () => (lottie() ? LOTTIE_DUR : { min: 2, max: 180 });
  const valid = () => name().trim().length > 0 && formats().length > 0 && dur() >= durRange().min && dur() <= durRange().max;
  const pickKind = (k: FilmKind) => {
    if (k === kind()) return;
    setKind(k);
    setDur(k === "lottie" ? 2 : 12);
  };

  const submit = async () => {
    if (!valid() || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const order = FORMATS.map((f) => f.value).filter((f) => formats().includes(f));
      const slug = await createFilm(
        lottie()
          ? { name: name().trim(), kind: "lottie", size: size(), formats: [size()], dur: dur(), quality: quality() }
          : { name: name().trim(), formats: order, dur: dur(), quality: quality() },
      );
      props.onOpenChange(false);
      props.onCreated(slug);
      setName("새 필름");
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent class="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>새 필름</AlertDialogTitle>
          <AlertDialogDescription>나머지는 에이전트가 브리프를 쓰면서 물어봐요. 나중에 바꿔도 돼요.</AlertDialogDescription>
        </AlertDialogHeader>

        <form
          class="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div class="flex flex-col gap-1.5">
            <span class={label}>어디에 쓰나요?</span>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={KINDS}>
                {(k) => (
                  <button
                    type="button"
                    onClick={() => pickKind(k.value)}
                    aria-pressed={kind() === k.value}
                    class="flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left focus-ring"
                    classList={{
                      "border-foreground bg-muted": kind() === k.value,
                      "border-border hover:bg-accent": kind() !== k.value,
                    }}
                  >
                    <span class="text-xxs text-foreground">{k.label}</span>
                    <span class="text-[9px] text-muted-foreground">{k.hint}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <label class="flex flex-col gap-1.5">
            <span class={label}>이름</span>
            <input
              ref={(el) => queueMicrotask(() => el.select())}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              class="h-8 rounded-md bg-input px-2 text-xxs text-foreground outline-none focus-ring"
            />
          </label>

          <Show when={lottie()}>
            <div class="flex flex-col gap-1.5">
              <span class={label}>크기</span>
              <div class="grid grid-cols-4 gap-1.5">
                <For each={LOTTIE_SIZES}>
                  {(s) => (
                    <button
                      type="button"
                      onClick={() => setSize(s.value)}
                      aria-pressed={size() === s.value}
                      class="flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left focus-ring"
                      classList={{
                        "border-foreground bg-muted": size() === s.value,
                        "border-border hover:bg-accent": size() !== s.value,
                      }}
                    >
                      <span class="text-xxs text-foreground">{s.label}</span>
                      <span class="font-mono text-[9px] text-muted-foreground">{s.value}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="flex flex-col gap-1.5" classList={{ hidden: lottie() }}>
            <span class={label}>포맷 (여러 개 고를 수 있어요)</span>
            <div class="grid grid-cols-4 gap-1.5">
              <For each={FORMATS}>
                {(f) => (
                  <button
                    type="button"
                    onClick={() => toggleFormat(f.value)}
                    aria-pressed={formats().includes(f.value)}
                    class="flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left focus-ring"
                    classList={{
                      "border-foreground bg-muted": formats().includes(f.value),
                      "border-border hover:bg-accent": !formats().includes(f.value),
                    }}
                  >
                    <span class="text-xxs text-foreground">{f.label}</span>
                    <span class="font-mono text-[9px] text-muted-foreground">{f.value}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <label class="flex flex-col gap-1.5">
            <span class={label}>길이</span>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min={durRange().min}
                max={durRange().max}
                step={lottie() ? 0.1 : 0.5}
                value={dur()}
                onInput={(e) => setDur(Number(e.currentTarget.value))}
                class="h-8 w-24 rounded-md bg-input px-2 font-mono text-xxs text-foreground outline-none focus-ring"
              />
              <span class="text-xxs text-muted-foreground">초</span>
            </div>
          </label>

          <div class="flex flex-col gap-1.5">
            <span class={label}>품질</span>
            <div class="grid grid-cols-3 gap-1.5">
              <For each={QUALITIES}>
                {(q) => (
                  <button
                    type="button"
                    onClick={() => setQuality(q)}
                    aria-pressed={quality() === q}
                    class="flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left focus-ring"
                    classList={{
                      "border-foreground bg-muted": quality() === q,
                      "border-border hover:bg-accent": quality() !== q,
                    }}
                  >
                    <span class="text-xxs text-foreground">{QUALITY_LABEL[q].label}</span>
                    <span class="text-[9px] text-muted-foreground">{QUALITY_LABEL[q].hint}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <Show when={error()}>
            <span class="text-xxs text-destructive">{error()}</span>
          </Show>

          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button type="submit" disabled={!valid() || busy()}>
              {busy() ? "만드는 중…" : "만들기"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
