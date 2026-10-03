import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { forgetClaudePath, isLoggedIn, resolveClaudePath } from "../server/claude-cli";

/**
 * First-run setup.
 *
 * The app carries its own Node runtime but not the agent: the Claude Code CLI
 * is a ~200MB native binary, so it is fetched with Anthropic's own installer
 * rather than redistributed inside this bundle. The designer never opens a
 * terminal — the app runs the installer and reports progress in its own window.
 */

const INSTALLER_URL = "https://claude.ai/install.sh";

/**
 * Installer output aimed at terminal users: PATH setup advice and a "run
 * claude --help" pointer. Neither applies here — the app resolves the
 * executable by path and never goes through a shell — and telling a designer
 * to edit their shell config is exactly the thing this app exists to avoid.
 * Hidden from the window; the main process still logs everything.
 */
const TERMINAL_ADVICE = [
  /not in your PATH/i,
  /shell config/i,
  /export PATH=/,
  /^Next:/i,
  /claude --help/i,
  /^[⚠●]/,
  /Setup notes/i,
];

function isTerminalAdvice(line: string): boolean {
  return TERMINAL_ADVICE.some((pattern) => pattern.test(line));
}

export interface SetupStatus {
  /** The CLI is installed and executable. */
  claude: boolean;
  /** The CLI reports an authenticated account. */
  loggedIn: boolean;
  ready: boolean;
}

export function readSetupStatus(): SetupStatus {
  forgetClaudePath();
  const claude = resolveClaudePath() !== null;
  const loggedIn = claude && isLoggedIn();
  return { claude, loggedIn, ready: claude && loggedIn };
}

function run(
  command: string,
  args: string[],
  onLine: (line: string) => void,
  options: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const feed = (chunk: Buffer) => {
      tail += chunk.toString();
      const lines = tail.split("\n");
      tail = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", reject);
    child.on("close", (code) => {
      if (tail.trim()) onLine(tail.trim());
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

/**
 * Download the official installer, then run it. Fetching to a file first (rather
 * than piping straight into a shell) means a network failure is reported as a
 * download problem instead of surfacing as an opaque shell error.
 */
export async function installClaudeCode(onLine: (line: string) => void): Promise<void> {
  const scriptPath = path.join(os.tmpdir(), `claude-install-${Date.now()}.sh`);

  onLine("설치 파일을 내려받는 중…");
  const response = await fetch(INSTALLER_URL);
  if (!response.ok) throw new Error(`설치 파일을 받지 못했습니다 (HTTP ${response.status})`);
  const script = await response.text();
  if (!script.startsWith("#!")) throw new Error("설치 파일이 올바르지 않습니다.");
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });

  try {
    onLine("설치하는 중… 몇 분 걸릴 수 있어요.");
    await run("/bin/bash", [scriptPath], (line) => {
      console.log(`[install] ${line}`);
      if (!isTerminalAdvice(line)) onLine(line);
    });
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }

  forgetClaudePath();
  if (!resolveClaudePath()) {
    throw new Error("설치는 끝났지만 실행 파일을 찾지 못했습니다.");
  }
  onLine("설치가 끝났습니다.");
}


/**
 * Sign-in, driven entirely from the app.
 *
 * `claude auth login` works over pipes: it prints an authorization URL, opens
 * the browser itself, then waits on stdin for the code the browser hands back.
 * The setup window shows the URL and collects that code, so no terminal is
 * involved at any point.
 */

const URL_PATTERN = /(https:\/\/\S*oauth\S+)/;
const LOGIN_URL_TIMEOUT_MS = 30_000;

let loginChild: ChildProcess | null = null;

export interface LoginStart {
  ok: boolean;
  url?: string;
  error?: string;
}

export function startLogin(onLine: (line: string) => void): Promise<LoginStart> {
  cancelLogin();

  const claude = resolveClaudePath();
  if (!claude) return Promise.resolve({ ok: false, error: "Claude Code를 찾지 못했습니다." });

  return new Promise((resolve) => {
    const child = spawn(claude, ["auth", "login", "--claudeai"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    loginChild = child;

    let settled = false;
    let buffer = "";

    const finish = (result: LoginStart) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: "로그인 주소를 받지 못했습니다." }),
      LOGIN_URL_TIMEOUT_MS,
    );

    const feed = (chunk: Buffer) => {
      const text = chunk.toString();
      buffer += text;
      for (const line of text.split("\n")) if (line.trim()) onLine(line.trim());
      const match = URL_PATTERN.exec(buffer);
      if (match) finish({ ok: true, url: match[1] });
    };

    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (err) => finish({ ok: false, error: err.message }));
    child.on("close", () => {
      if (loginChild === child) loginChild = null;
      finish({ ok: false, error: "로그인 과정이 예상보다 일찍 끝났습니다." });
    });
  });
}

/** Hand the browser's code back to the waiting login process. */
export function submitLoginCode(code: string): { ok: boolean; error?: string } {
  if (!loginChild?.stdin?.writable) {
    return { ok: false, error: "로그인 과정이 이미 끝났습니다. 다시 시도해 주세요." };
  }
  loginChild.stdin.write(`${code.trim()}\n`);
  return { ok: true };
}

export function cancelLogin(): void {
  loginChild?.kill();
  loginChild = null;
}
