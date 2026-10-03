import { createContext, onMount, useContext, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { RenderJob } from "@/types";
import { onServerEvent } from "@/lib/live";

/** The studio's render queue (server/render.ts), live. */
const RenderContext = createContext<{
  jobs: () => RenderJob[];
  cancel: (id: string) => Promise<void>;
}>();

export function RenderProvider(props: { children: JSX.Element }) {
  // A store reconciled by id: progress arrives four times a second, and a job's
  // chip (with its cancel button) has to stay the same element throughout.
  const [state, setState] = createStore<{ jobs: RenderJob[] }>({ jobs: [] });
  const apply = (jobs: RenderJob[]) => setState("jobs", reconcile(jobs, { key: "id" }));

  onMount(() => {
    void fetch("/__render")
      .then((res) => (res.ok ? (res.json() as Promise<{ jobs: RenderJob[] }>) : { jobs: [] }))
      .then((data) => apply(data.jobs));
  });
  onServerEvent<{ jobs: RenderJob[] }>("render:update", (payload) => apply(payload.jobs));

  const cancel = async (id: string) => {
    await fetch("/__render/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  };

  return <RenderContext.Provider value={{ jobs: () => state.jobs, cancel }}>{props.children}</RenderContext.Provider>;
}

export function useRender() {
  const context = useContext(RenderContext);
  if (!context) throw new Error("useRender must be used within a RenderProvider");
  return context;
}
