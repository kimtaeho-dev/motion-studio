import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { X } from "lucide-solid";

export interface Media {
  kind: "image" | "video";
  url: string;
  title: string;
}

const [media, setMedia] = createSignal<Media | null>(null);

/** Show a contact sheet, a critique image or a render full-size, inside the app. */
export const openMedia = (next: Media) => setMedia(next);

export function MediaViewer() {
  const close = () => setMedia(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && media()) {
      e.preventDefault();
      close();
    }
  };
  onMount(() => window.addEventListener("keydown", onKey, true));
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

  return (
    <Show when={media()}>
      {(m) => (
        <div class="fixed inset-0 z-50 flex flex-col bg-overlay p-6" onClick={close}>
          <div class="flex items-center justify-between pb-3 text-xxs text-white">
            <span class="font-strong">{m().title}</span>
            <button type="button" onClick={close} class="rounded-sm p-1 hover:bg-white/10 focus-ring" aria-label="닫기">
              <X class="size-4" />
            </button>
          </div>
          <div class="flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <Show
              when={m().kind === "video"}
              fallback={<img src={m().url} alt={m().title} class="max-h-full max-w-full rounded-md object-contain" />}
            >
              <video src={m().url} controls autoplay loop class="max-h-full max-w-full rounded-md" />
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
