import { createContext, createResource, useContext, type JSX } from "solid-js";
import type { FilmQuality, FilmSummary, FilmsTree } from "@/types";
import { onServerEvent } from "@/lib/live";

const FilmsContext = createContext<{
  films: () => FilmSummary[];
  /** True once the first list has arrived — before that, "no films" would be a lie. */
  ready: () => boolean;
  findFilm: (slug: string) => FilmSummary | undefined;
  /** Creates a film from the template; resolves to its slug. */
  createFilm: (options: NewFilmOptions) => Promise<string>;
  renameFilm: (slug: string, name: string) => Promise<void>;
  /** Moves the film (and its renders) to the workspace's .trash folder. */
  deleteFilm: (slug: string) => Promise<void>;
}>();

export interface NewFilmOptions {
  name: string;
  formats: string[];
  /** Seconds. */
  dur: number;
  quality: FilmQuality;
}

async function loadFilms(): Promise<FilmSummary[]> {
  const res = await fetch("/__films");
  if (!res.ok) throw new Error(`Failed to load films (HTTP ${res.status})`);
  return ((await res.json()) as FilmsTree).films;
}

async function send(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/__films", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  return data;
}

export function FilmsProvider(props: { children: JSX.Element }) {
  const [data, { mutate, refetch }] = createResource(loadFilms);

  onServerEvent<FilmsTree>("films:update", (payload) => mutate(payload.films));

  const films = () => data() ?? [];

  const createFilm = async (options: NewFilmOptions) => {
    const { film } = await send("POST", { ...options });
    await refetch();
    return film as string;
  };

  const renameFilm = async (slug: string, name: string) => {
    await send("PATCH", { film: slug, name });
    await refetch();
  };

  const deleteFilm = async (slug: string) => {
    await send("DELETE", { film: slug });
    await refetch();
  };

  return (
    <FilmsContext.Provider
      value={{
        films,
        ready: () => data.state === "ready" || data.state === "refreshing",
        findFilm: (slug) => films().find((f) => f.slug === slug),
        createFilm,
        renameFilm,
        deleteFilm,
      }}
    >
      {props.children}
    </FilmsContext.Provider>
  );
}

export function useFilms() {
  const context = useContext(FilmsContext);
  if (!context) throw new Error("useFilms must be used within a FilmsProvider");
  return context;
}
