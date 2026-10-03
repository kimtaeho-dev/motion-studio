import { A, Navigate, Route, Router, useNavigate, useParams } from "@solidjs/router";
import { createSignal, Show, type JSX } from "solid-js";
import { Button } from "@/components/ui/button";
import { CenteredContainer } from "@/components/ui/container";
import { App } from "./app";
import { FilmsProvider, useFilms } from "./context/films";
import { NewFilmDialog } from "./components/new-film-dialog";

function Providers(props: { children?: JSX.Element }) {
  return <FilmsProvider>{props.children}</FilmsProvider>;
}

/**
 * Nothing to show, and — since the list and the agent only mount on a film
 * route — nothing to click either. So the empty state carries the one action
 * that gets out of it.
 */
function NoFilms() {
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);

  return (
    <CenteredContainer>
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="text-foreground">아직 필름이 하나도 없어요.</span>
        <span>새 필름을 만들면 에이전트에게 요청할 수 있어요.</span>
        <Button onClick={() => setOpen(true)}>새 필름 만들기</Button>
      </div>
      <NewFilmDialog open={open()} onOpenChange={setOpen} onCreated={(slug) => navigate(`/${slug}`)} />
    </CenteredContainer>
  );
}

function RedirectToFirst() {
  const { films, ready } = useFilms();
  return (
    <Show when={ready()} fallback={<CenteredContainer>불러오는 중…</CenteredContainer>}>
      <Show when={films()[0]} fallback={<NoFilms />}>
        {(film) => <Navigate href={`/${film().slug}`} />}
      </Show>
    </Show>
  );
}

function NotFound() {
  return (
    <CenteredContainer>
      <div class="flex flex-col items-center gap-2">
        <span>찾을 수 없는 필름이에요.</span>
        <A href="/" class="text-foreground underline">
          목록으로 돌아가기
        </A>
      </div>
    </CenteredContainer>
  );
}

function FilmRoute() {
  const params = useParams();
  const { findFilm, ready } = useFilms();
  return (
    <Show when={ready()} fallback={<CenteredContainer>불러오는 중…</CenteredContainer>}>
      <Show when={findFilm(params.film ?? "")} fallback={<NotFound />}>
        <App />
      </Show>
    </Show>
  );
}

export function Root() {
  return (
    <Router root={Providers}>
      <Route path="/" component={RedirectToFirst} />
      <Route path="/:film" component={FilmRoute} />
      <Route path="*" component={NotFound} />
    </Router>
  );
}
