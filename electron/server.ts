import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import chokidar from "chokidar";
import { filmsPlugin } from "../server/films";
import { mailboxPlugin } from "../server/mailbox";
import { renderPlugin, type WorkerCommand } from "../server/render";
import { WORKSPACE_ENV } from "../server/workspace";

/**
 * Hosts the studio plugins without Vite.
 *
 * `films` and `mailbox` only ever touch four things on the Vite dev server —
 * `middlewares.use` and `ws.send` (films runs its own file watcher) — so the
 * packaged app can serve a production bundle and still give those plugins
 * exactly the surface they expect. The plugins themselves are shared verbatim
 * with `npm run dev`; there is no second implementation to keep in sync.
 */

type Next = (err?: unknown) => void;
type Middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: Next) => void;

/** Connect's mount semantics: prefix match on a segment boundary, prefix stripped. */
function matchRoute(url: string, route: string): string | null {
  if (route === "/") return url;
  if (!url.startsWith(route)) return null;
  const rest = url.slice(route.length);
  if (rest === "" || rest.startsWith("/") || rest.startsWith("?")) return rest === "" ? "/" : rest;
  return null;
}

class MiddlewareStack {
  private entries: { route: string; handler: Middleware }[] = [];

  use(routeOrHandler: string | Middleware, maybeHandler?: Middleware): void {
    if (typeof routeOrHandler === "string") {
      this.entries.push({ route: routeOrHandler, handler: maybeHandler! });
    } else {
      this.entries.push({ route: "/", handler: routeOrHandler });
    }
  }

  run(req: http.IncomingMessage, res: http.ServerResponse, done: Next): void {
    const originalUrl = req.url ?? "/";
    let index = 0;
    const next: Next = (err) => {
      if (err) return done(err);
      const entry = this.entries[index++];
      if (!entry) return done();
      const remainder = matchRoute(originalUrl, entry.route);
      if (remainder === null) return next();
      req.url = remainder;
      try {
        entry.handler(req, res, (e) => {
          req.url = originalUrl;
          next(e);
        });
      } catch (e) {
        req.url = originalUrl;
        next(e);
      }
    };
    next();
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface StudioServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface StudioServerOptions {
  /** Directory holding the built frontend (index.html, assets/…). */
  distDir: string;
  /** Workspace root — the agent's cwd and the home of films/. */
  workspaceRoot: string;
  /** First port to try; later ports are used when it is taken. */
  port?: number;
  /** How many ports to try before giving up. */
  portAttempts?: number;
  /**
   * Opens the app's sign-in window. Handed to the mailbox so a session that
   * expires while the app is open can be fixed from the chat panel.
   */
  onSignInRequested?: () => void;
  /** Environment for the agent process (see MailboxOptions.agentEnv). */
  agentEnv?: () => NodeJS.ProcessEnv;
  /** How to start a render worker — the app's own executable (see main.ts). */
  workerCommand: () => WorkerCommand;
}

/**
 * Whether anything is already answering on a port.
 *
 * Binding alone is not enough to tell: `npm run dev` listens on [::1] only, so
 * a packaged app can bind 127.0.0.1 on the same port number and both end up
 * live behind one `localhost:<port>` URL, with the browser picking a winner.
 * Both stacks are probed so the app moves to the next port instead.
 */
function portTaken(port: number): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      const settle = (taken: boolean) => {
        socket.destroy();
        resolve(taken);
      };
      socket.setTimeout(400);
      socket.once("connect", () => settle(true));
      socket.once("timeout", () => settle(false));
      socket.once("error", () => settle(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((r) => r.some(Boolean));
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startStudioServer(options: StudioServerOptions): Promise<StudioServer> {
  const { distDir, workspaceRoot } = options;
  const firstPort = options.port ?? 3040;
  const attempts = options.portAttempts ?? 20;

  // resolveWorkspace() reads this; setting it here keeps the plugins unaware
  // that they are running anywhere other than a dev server.
  process.env[WORKSPACE_ENV] = workspaceRoot;

  const middlewares = new MiddlewareStack();
  const sockets = new Set<WebSocket>();
  const watcher = chokidar.watch([], { ignoreInitial: true });

  const fakeServer = {
    middlewares,
    watcher,
    ws: {
      send(payload: { type?: string; event?: string; data?: unknown }) {
        if (payload?.type !== "custom" || !payload.event) return;
        const frame = JSON.stringify({ event: payload.event, data: payload.data });
        for (const socket of sockets) {
          if (socket.readyState === socket.OPEN) socket.send(frame);
        }
      },
    },
  };

  const fakeConfig = { root: workspaceRoot, build: { outDir: distDir } };

  for (const plugin of [
    filmsPlugin(),
    mailboxPlugin({ signIn: options.onSignInRequested, agentEnv: options.agentEnv }),
    renderPlugin({ workerCommand: options.workerCommand }),
  ]) {
    const configResolved = plugin.configResolved;
    const configureServer = plugin.configureServer;
    if (typeof configResolved === "function") {
      await configResolved.call(null as never, fakeConfig as never);
    }
    if (typeof configureServer === "function") {
      await configureServer.call(null as never, fakeServer as never);
    }
  }

  // Static bundle, then SPA fallback: routes are paths (`/<film>`),
  // so anything that is not a real file has to resolve to index.html.
  const indexHtml = path.join(distDir, "index.html");
  middlewares.use((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const candidate = path.join(distDir, requestPath);
    const inside = candidate === distDir || candidate.startsWith(distDir + path.sep);
    if (inside && requestPath !== "/") {
      try {
        if (fs.statSync(candidate).isFile()) {
          res.setHeader("Content-Type", contentTypeFor(candidate));
          fs.createReadStream(candidate).pipe(res);
          return;
        }
      } catch {
        // fall through to the SPA entry point
      }
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    fs.createReadStream(indexHtml).pipe(res);
  });

  const server = http.createServer((req, res) => {
    middlewares.run(req, res, (err) => {
      if (err) {
        console.error("[studio-server]", err);
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/__live")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
    });
  });

  let port = 0;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const candidate = firstPort + i;
    if (await portTaken(candidate)) continue;
    try {
      port = await listen(server, candidate);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") break;
    }
  }
  if (lastError) throw lastError;
  if (!port) {
    throw new Error(
      `No free port in ${firstPort}-${firstPort + attempts - 1}; is another copy of the studio already running?`,
    );
  }

  // The agent's tools/render.mjs hands renders to this server's queue (server/render.ts).
  process.env.MOTION_STUDIO_URL = `http://127.0.0.1:${port}`;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    async close() {
      await watcher.close();
      for (const socket of sockets) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
