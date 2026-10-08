import { createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Clapperboard, Pencil, Plus, Trash } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFilms } from "@/context/films";
import { NewFilmDialog } from "@/components/new-film-dialog";
import type { FilmSummary } from "@/types";

/** The brand mark (assets/brand/mark.svg): a timeline playhead, in the brand red. */
function Mark() {
  return (
    <svg viewBox="400 288 224 492" class="h-[13px] w-auto shrink-0 text-brand" aria-hidden="true">
      <path d="M512 500 V740" fill="none" stroke="currentColor" stroke-width="56" stroke-linecap="round" />
      <path d="M412 300 H612 V440 L512 520 L412 440 Z" fill="currentColor" stroke="currentColor" stroke-width="24" stroke-linejoin="round" />
    </svg>
  );
}

/** "12초 · 1x1 9x16" — what a designer needs to tell films apart at a glance. */
function subtitle(film: FilmSummary): string {
  if (film.error) return film.error;
  const parts: string[] = [];
  if (film.dur) parts.push(`${Math.round(film.dur * 10) / 10}초`);
  if (film.formats.length) parts.push(film.formats.join(" "));
  return parts.join(" · ");
}

function NameInput(props: { value: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = createSignal(props.value);
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const v = value().trim();
    if (commit && v) props.onCommit(v);
    else props.onCancel();
  };
  return (
    <input
      ref={(el) =>
        queueMicrotask(() => {
          el.focus();
          el.select();
        })
      }
      type="text"
      value={value()}
      onInput={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.isComposing) return;
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      class="h-8 w-full rounded-md bg-input px-2 text-xxs text-foreground outline-none focus-ring"
    />
  );
}

export function Sidebar() {
  const params = useParams();
  const navigate = useNavigate();
  const { films, renameFilm, deleteFilm } = useFilms();
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<FilmSummary | null>(null);

  const remove = async (film: FilmSummary) => {
    setDeleting(null);
    await deleteFilm(film.slug);
    if (film.slug === params.film) navigate("/");
  };

  return (
    <aside class="flex w-[232px] shrink-0 flex-col rounded-2xl border border-border bg-background text-muted-foreground">
      <div class="flex h-12 items-center justify-between px-4">
        <span class="flex items-center gap-1.5 text-xxs font-strong text-foreground">
          <Mark />
          Motion Studio
        </span>
        <Button size="icon" variant="ghost" onClick={() => setCreating(true)} aria-label="새 필름">
          <Plus />
        </Button>
      </div>

      <div class="panel-scroll flex min-h-0 flex-1 flex-col gap-0.5 border-t border-border px-2 py-2">
        <For each={films()}>
          {(film) => {
            const active = () => film.slug === params.film;
            return (
              <Show
                when={renaming() !== film.slug}
                fallback={
                  <div class="px-1 py-1">
                    <NameInput
                      value={film.title}
                      onCommit={(v) => {
                        setRenaming(null);
                        if (v !== film.title) void renameFilm(film.slug, v);
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  </div>
                }
              >
                <ContextMenu>
                  <ContextMenuTrigger
                    as="button"
                    type="button"
                    onClick={() => navigate(`/${film.slug}`)}
                    class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left focus-ring"
                    classList={{ "bg-muted text-foreground": active(), "hover:bg-accent": !active() }}
                  >
                    <Clapperboard class="mt-0.5 size-3.5 shrink-0" />
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate text-xxs" classList={{ "text-foreground": active() }}>
                        {film.title}
                      </span>
                      <span class="truncate text-[10px]" classList={{ "text-destructive": !!film.error }}>
                        {subtitle(film)}
                      </span>
                    </span>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => setRenaming(film.slug)}>
                      <Pencil />
                      <span>이름 바꾸기</span>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => setDeleting(film)}>
                      <Trash />
                      <span>필름 삭제</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </Show>
            );
          }}
        </For>
      </div>

      <NewFilmDialog open={creating()} onOpenChange={setCreating} onCreated={(slug) => navigate(`/${slug}`)} />

      <AlertDialog open={!!deleting()} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>'{deleting()?.title}'을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              필름과 렌더한 영상, 대화 기록이 목록에서 사라져요. 작업 폴더의 .trash에 보관되니 필요하면 되살릴 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting() && void remove(deleting()!)}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
