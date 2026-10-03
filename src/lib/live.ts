import { createSignal } from "solid-js";

/**
 * The studio backend — the plugin endpoints (`/__scenes`, `/__chat`, …) and the
 * push channel that keeps the player in sync with files on disk.
 *
 * In `npm run dev` that backend is the Vite dev server and pushes ride Vite's
 * HMR socket. In the packaged app the same plugins are hosted by a plain Node
 * server that pushes over its own socket at `/__live`. Presence is therefore a
 * runtime fact, not a build-time one: a production bundle served by that Node
 * server is fully live, while the same bundle deployed as static files is not.
 */

const DEV = import.meta.env.DEV;

const [live, setLive] = createSignal(DEV);

/** Whether a studio backend is answering — gates the agent chat panel. */
export const isLive = live;

export function markLive(value: boolean): void {
  setLive(value);
}

type Handler = (data: never) => void;

const handlers = new Map<string, Set<Handler>>();
let socket: WebSocket | null = null;
let retry = 0;

function dispatch(event: string, data: unknown): void {
  for (const handler of handlers.get(event) ?? []) (handler as (d: unknown) => void)(data);
}

function connect(): void {
  if (socket || typeof WebSocket === "undefined") return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/__live`);
  socket = ws;

  ws.addEventListener("open", () => {
    retry = 0;
    markLive(true);
  });
  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data as string) as { event: string; data: unknown };
      if (payload.event) dispatch(payload.event, payload.data);
    } catch {
      // a frame we don't understand is not worth tearing the socket down for
    }
  });
  ws.addEventListener("close", () => {
    socket = null;
    // The server is a local child process; a drop means it is restarting, so
    // keep trying, backing off to a couple of seconds.
    retry = Math.min(retry + 1, 10);
    setTimeout(connect, Math.min(250 * retry, 2000));
  });
  ws.addEventListener("error", () => ws.close());
}

/**
 * Subscribe to a server push. Same event names in both modes, so call sites do
 * not care which backend is behind them.
 */
export function onServerEvent<T>(event: string, handler: (data: T) => void): void {
  if (DEV) {
    import.meta.hot?.on(event, handler);
    return;
  }
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler as Handler);
  connect();
}
