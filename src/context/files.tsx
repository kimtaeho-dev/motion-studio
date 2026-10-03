import { createContext, createResource, useContext, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import type { FilmChange, FilmFiles } from "@/types";
import { onServerEvent } from "@/lib/live";

/** The open film's docs, renders and pipeline stage (server/films.ts → /__films/files). */
const FilesContext = createContext<{
  files: () => FilmFiles | undefined;
}>();

async function loadFiles(slug: string): Promise<FilmFiles | undefined> {
  const res = await fetch(`/__films/files?film=${encodeURIComponent(slug)}`);
  return res.ok ? ((await res.json()) as FilmFiles) : undefined;
}

export function FilesProvider(props: { children: JSX.Element }) {
  const params = useParams();
  const [files, { refetch }] = createResource(() => params.film, loadFiles);

  // Any change around the film can move the stage or add a render; the list is cheap to rebuild.
  onServerEvent<FilmChange>("film:changed", (change) => {
    if (change.slug === params.film && change.kind !== "code") void refetch();
  });

  return <FilesContext.Provider value={{ files: () => files.latest }}>{props.children}</FilesContext.Provider>;
}

export function useFiles() {
  const context = useContext(FilesContext);
  if (!context) throw new Error("useFiles must be used within a FilesProvider");
  return context;
}
