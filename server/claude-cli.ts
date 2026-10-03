import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

/**
 * Locating the `claude` executable.
 *
 * `spawn("claude")` only works when the server inherits a login shell's PATH.
 * That holds for `npm run dev` in a terminal and nowhere else: a GUI-launched
 * process (a packaged app, an .app bundle) gets a bare
 * `/usr/bin:/bin:/usr/sbin:/sbin`, so version-manager and per-user install
 * locations are invisible. Every known install location is therefore probed
 * directly, with a login shell as the last resort.
 */

let cached: string | null | undefined;

function knownPaths(): string[] {
  const home = os.homedir();
  return [
    // Native installer (the common case) — a symlink into ~/.local/share/claude/versions/.
    path.join(home, ".local", "bin", "claude"),
    // Same install's desktop app: a hard link to the very same binary.
    path.join(home, ".local", "share", "claude", "ClaudeCode.app", "Contents", "MacOS", "claude"),
    // Legacy local install.
    path.join(home, ".claude", "local", "claude"),
    // npm global, Homebrew prefixes.
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Last resort: ask the user's login shell, which has their real PATH. */
function viaLoginShell(): string | null {
  const shell = process.env.SHELL;
  if (!shell) return null;
  try {
    const found = execFileSync(shell, ["-lc", "command -v claude"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return found && isExecutable(found) ? found : null;
  } catch {
    return null;
  }
}

/** Absolute path to the claude executable, or null when it is not installed. */
export function resolveClaudePath(): string | null {
  if (cached !== undefined) return cached;

  const explicit = process.env.CLAUDE_CLI_PATH?.trim();
  if (explicit && isExecutable(explicit)) return (cached = explicit);

  for (const candidate of knownPaths()) {
    if (isExecutable(candidate)) return (cached = candidate);
  }
  return (cached = viaLoginShell());
}

/** Forget a cached lookup, so a fresh install is picked up without a restart. */
export function forgetClaudePath(): void {
  cached = undefined;
}

/**
 * Whether Claude Code is signed in. Asked of the CLI itself rather than
 * inferred from a credential store, so it stays correct however the account
 * was authenticated.
 */
export function isLoggedIn(): boolean {
  const claude = resolveClaudePath();
  if (!claude) return false;
  try {
    const output = execFileSync(claude, ["auth", "status", "--json"], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (JSON.parse(output) as { loggedIn?: boolean }).loggedIn === true;
  } catch {
    return false;
  }
}

/**
 * Whether the CLI positively reports that no account is signed in.
 *
 * Asynchronous — unlike `isLoggedIn()`, which blocks and is only safe during
 * first-run setup — because this one runs inside the studio server, where a
 * blocked event loop would stall the player and every open socket.
 *
 * An inconclusive answer (the call times out, the output does not parse) is
 * reported as `false`, not as "signed out": telling someone their session
 * expired when it did not is worse than falling back to a generic failure.
 */
export function isSignedOut(): Promise<boolean> {
  const claude = resolveClaudePath();
  if (!claude) return Promise.resolve(false);

  return new Promise((resolve) => {
    execFile(claude, ["auth", "status", "--json"], { timeout: 15000 }, (_err, stdout) => {
      // Parsed regardless of the exit code: `auth status` can report a signed
      // out account and exit non-zero at the same time.
      try {
        resolve((JSON.parse(stdout) as { loggedIn?: boolean }).loggedIn === false);
      } catch {
        resolve(false);
      }
    });
  });
}
