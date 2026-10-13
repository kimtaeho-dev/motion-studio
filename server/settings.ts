import type { Plugin } from "vite";
import type { AppSettings } from "../src/types/common";
import { readAccount, signOut } from "./claude-cli";
import { json } from "./http";
import { resolveWorkspace, type Workspace } from "./workspace";

export interface SettingsOptions {
  /** Opens the app's sign-in window (packaged app only). */
  signIn?: () => void;
  /** Shows a folder in Finder (packaged app only). */
  reveal?: (dir: string) => void;
  version?: string;
}

/**
 * Settings: the account the agent runs as, and the workspace.
 *
 * Switching accounts is offered only when the agent has a sign-in of its own
 * (CLAUDE_CONFIG_DIR, set by the packaged app). Under `npm run dev` the agent
 * shares the developer's sign-in, and signing out here would sign them out of
 * every Claude Code on the machine.
 */
export function settingsPlugin(options: SettingsOptions = {}): Plugin {
  let ws: Workspace;
  const canSwitch = () => !!options.signIn && !!process.env.CLAUDE_CONFIG_DIR;

  return {
    name: "motion-studio-settings",
    configResolved(config) {
      ws = resolveWorkspace(config.root);
    },
    configureServer(server) {
      server.middlewares.use("/__settings/sign-out", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!canSwitch()) return json(res, 403, { error: "이 실행 방식에서는 계정을 바꿀 수 없어요" });
        const result = await signOut();
        if (result.ok) options.signIn?.();
        json(res, result.ok ? 200 : 500, result);
      });

      server.middlewares.use("/__settings/reveal", (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!options.reveal) return json(res, 200, { ok: false });
        options.reveal(ws.root);
        json(res, 200, { ok: true });
      });

      server.middlewares.use("/__settings", async (req, res) => {
        if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
        const settings: AppSettings = {
          account: await readAccount(),
          canSwitch: canSwitch(),
          canReveal: !!options.reveal,
          workspace: ws.root,
          version: options.version ?? null,
        };
        json(res, 200, settings);
      });
    },
  };
}
