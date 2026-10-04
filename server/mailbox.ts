import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import type { ChatAttachment, ChatAuthFailure, ChatEffort, ChatMessage, ChatModel, ChatProgress, ChatSettings } from "../src/types/common";
import { json, readJsonBody } from "./http";
import { readState, writeState } from "./state";
import { resolveWorkspace } from "./workspace";
import { isSignedOut, resolveClaudePath } from "./claude-cli";

// Ceiling for one `claude -p` turn. A film turn can include a full render and
// several critique rounds, so this is far longer than a Lottie edit — but still
// finite, so a stuck invocation can't wedge the queue forever.
const WORKER_TIMEOUT_MS = 60 * 60 * 1000;

const FALLBACK_ERROR_TEXT = "요청을 처리하는 중에 문제가 생겼어요. 잠시 후 다시 말씀해 주세요.";

/**
 * A session can expire while the app sits open for days. The agent then fails
 * every turn with nothing the user can act on, so say what happened and offer
 * the way back — which differs by host, hence the two texts.
 */
const SIGNED_OUT_TEXT_APP =
  "Claude 로그인이 풀렸어요. 아래 '다시 로그인'을 누르면 로그인 창이 열려요. " +
  "로그인한 뒤 '다시 보내기'를 누르면 방금 요청을 그대로 이어서 처리할게요.";

const SIGNED_OUT_TEXT_DEV =
  "Claude 로그인이 풀렸어요. 터미널에서 `claude`를 한 번 실행해 로그인한 뒤 " +
  "'다시 보내기'를 눌러 주세요.";

const CLAUDE_MISSING_TEXT =
  "이 컴퓨터에 Claude Code가 아직 설치되어 있지 않아서 요청을 처리할 수 없어요. " +
  "https://claude.com/download 에서 설치한 뒤 다시 말씀해 주세요.";

// Model settings a turn may be sent with. Validated against these lists rather
// than passed through: the request body reaches `claude`'s argv, so anything
// not on them is a value this UI cannot produce and is not worth trusting.
const MODELS: ChatModel[] = ["haiku", "sonnet", "opus"];
const EFFORTS: ChatEffort[] = ["low", "medium", "high", "max"];
// A film is designed, not tweaked: the default leans toward the careful end.
const DEFAULT_SETTINGS: ChatSettings = { model: "opus", effort: "high" };

const ATTACHMENT_KINDS: ChatAttachment["kind"][] = ["image", "video", "model"];

/** Gates the app can approve with a button (CLAUDE.md, 작업 순서). */
const APPROVALS = { shotlist: "숏리스트" } as const;
type Approval = keyof typeof APPROVALS;
const MAX_ATTACHMENTS = 10;

/**
 * Reply shape for the chat panel: a 380px column read by a designer, not a
 * terminal read by an engineer.
 */
const CHAT_STYLE_PROMPT = [
  "너는 지금 Motion Studio 앱 화면 안의 좁은 채팅 패널(380px)로 디자이너에게 답하고 있다.",
  "디자이너는 코드·터미널·파일 경로를 모른다. 명령어나 파일 경로를 답에 쓰지 말고, 화면에서 보이는 것(플레이어, 타임라인, 장면 이름)으로 말한다.",
  "답은 3~4문장 안으로 끝내고, 목록을 쓰면 항목 3개까지만 쓴다. 단, 디자이너가 답해야 하는 브리프 질문이나 승인받을 숏리스트는 빠짐없이 보여준다.",
  "마크다운은 **굵게**, 목록, 표, `코드` 정도만 쓰고 제목은 쓰지 않는다.",
  "렌더 로그, 점수 원본, JSON을 붙여넣지 않는다.",
].join(" ");

// How often progress is pushed to the browser while a turn runs. The agent
// emits events far faster than anyone can read them.
const PROGRESS_THROTTLE_MS = 400;

interface Thread {
  sessionId: string | null;
  messages: ChatMessage[];
}

interface QueueItem {
  film: string;
  placeholderId: string;
  userText: string;
  attachments: ChatAttachment[];
  /** Set when the message is the app's approve button rather than typed text. */
  approval?: Approval;
  /**
   * Carried on the item rather than read when the turn starts: the user can
   * change the setting while this message waits behind another film's turn,
   * and a message must run with the setting it was sent under.
   */
  settings: ChatSettings;
}

/**
 * One line of `--output-format stream-json`, narrowed to the fields used here.
 * The stream also carries token counts, per-tool results and partial deltas;
 * none of that is worth surfacing in a chat panel.
 */
interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: unknown[] };
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Only what a validated request body may contain. */
function readSettings(body: Record<string, unknown>): ChatSettings {
  const raw = body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : {};
  const model = MODELS.find((m) => m === raw.model) ?? DEFAULT_SETTINGS.model;
  const effort = EFFORTS.find((e) => e === raw.effort) ?? DEFAULT_SETTINGS.effort;
  return { model, effort };
}

/** Last non-empty line of the agent's own narration — its most recent thought. */
function lastLine(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1];
}

/**
 * A tool call, said the way a designer would describe it. The point of the
 * progress line is to answer "is it still doing something sensible?", so the
 * mapping stays coarse and follows the film pipeline in CLAUDE.md.
 */
function describeTool(name: string, input: Record<string, unknown> = {}): { step: string; detail?: string } {
  const raw = input.file_path ?? input.path ?? input.notebook_path;
  const filePath = typeof raw === "string" ? raw : "";
  const base = filePath.split("/").pop() ?? "";
  switch (name) {
    case "Read":
      if (/\.(png|jpe?g|webp|gif)$/i.test(base)) {
        if (filePath.includes("/refs/")) return { step: "레퍼런스를 보는 중", detail: base };
        if (/contact/i.test(base)) return { step: "컨택트 시트를 보는 중" };
        return { step: "렌더한 프레임을 보는 중" };
      }
      return { step: "자료를 읽는 중", detail: base || undefined };
    case "Glob":
    case "Grep":
      return { step: "파일을 찾아보는 중" };
    case "Write":
    case "Edit":
    case "NotebookEdit": {
      const verb = name === "Write" ? "쓰는" : "고치는";
      if (base === "brief.md") return { step: `브리프를 ${verb} 중` };
      if (base === "shotlist.md") return { step: `숏리스트를 ${verb} 중` };
      if (base === "film.json") return { step: "장면 시각과 문구를 정리하는 중" };
      if (base === "review_log.md") return { step: "검수 결과를 기록하는 중" };
      if (base === "style_guide.md") return { step: "레퍼런스 스타일을 정리하는 중" };
      if (base === "index.html") return { step: name === "Write" ? "움직임을 만드는 중" : "움직임을 다듬는 중" };
      return { step: `파일을 ${verb} 중`, detail: base || undefined };
    }
    case "TodoWrite":
      return { step: "할 일을 정리하는 중" };
    case "Task":
      return { step: "따로 살펴보는 중" };
    case "WebFetch":
    case "WebSearch":
      return { step: "자료를 찾아보는 중" };
    case "Bash": {
      const command = typeof input.command === "string" ? input.command : "";
      if (/render\.mjs[^|;&]*--stills/.test(command)) return { step: "스틸을 렌더하는 중" };
      if (/render\.mjs[^|;&]*--draft/.test(command)) return { step: "초안을 렌더하는 중" };
      if (/render\.mjs/.test(command)) return { step: "영상을 렌더하는 중", detail: "몇 분 걸릴 수 있어요" };
      if (/critique/.test(command)) return { step: "검수용 이미지를 만드는 중" };
      if (/determinism/.test(command)) return { step: "같은 프레임이 나오는지 검사하는 중" };
      if (/\bffmpeg\b|\bffprobe\b/.test(command)) return { step: "영상 파일을 다루는 중" };
      if (/^\s*(ls|cat|head|tail|find|grep|sed|node -e)\b/.test(command)) return { step: "파일을 살펴보는 중" };
      // Anything else is some one-off command; naming it would be a guess.
      return { step: "필요한 걸 확인하는 중" };
    }
    default:
      return { step: "작업하는 중" };
  }
}

const QUALITY_PROMPT: Record<string, string> = {
  fast: "fast(검수 1라운드)",
  standard: "standard(검수 3라운드)",
  launch: "launch(모든 항목 8점 이상까지, 6라운드 상한)",
};

/** The opening of every turn's prompt: which film, where it stands, and what the user attached or approved. */
function buildPrompt(item: QueueItem, filmsDir: string): string {
  let prompt = `현재 대상 필름은 films/${item.film} 이다. 다른 필름 폴더는 참고로 읽기만 하고 고치지 않는다. `;
  // state.json is written by the app (quality, approvals) and by the agent; a film made outside the app has none.
  const state = readState(path.join(filmsDir, item.film));
  if (state.quality && QUALITY_PROMPT[state.quality]) prompt += `이 필름의 품질 단계는 ${QUALITY_PROMPT[state.quality]}다. `;
  if (state.stage) prompt += `state.json의 현재 단계는 ${state.stage}${state.round ? ` (검수 ${state.round}라운드)` : ""}다. `;
  if (item.approval) {
    prompt += `디자이너가 앱의 승인 버튼으로 ${APPROVALS[item.approval]}를 승인했다. CLAUDE.md 작업 순서의 다음 단계부터 진행한다. `;
  }
  if (item.attachments.length > 0) {
    const lines = item.attachments.map((a) => `- ${a.path} (${a.kind}, 원본 파일명: ${a.name})`).join("\n");
    prompt += `디자이너가 파일을 첨부했다. 이미 필름 폴더에 저장돼 있다:\n${lines}\n`;
    if (item.attachments.some((a) => a.kind !== "model")) {
      prompt += "이미지·영상은 레퍼런스다. CLAUDE.md의 레퍼런스 규칙대로 문법만 가져온다. ";
    }
    if (item.attachments.some((a) => a.kind === "model")) {
      prompt += "3D 모델(.glb)은 필름에 직접 쓰는 소재다. lib/stage3d.js의 model()로 불러온다(CLAUDE.md, 3D). ";
    }
  }
  prompt += item.userText || "첨부한 파일을 보고 어떻게 쓰면 좋을지 제안해줘.";
  return prompt;
}

/**
 * Serves a chat mailbox at `/__chat`, one conversation per film so switching
 * films switches Claude sessions too: the app POSTs prompts to `/__chat/send`,
 * a headless `claude -p` process (spawned per message, one at a time across all
 * films) works on `films/<film>/…` exactly as it would from a terminal, and
 * replies are pushed back as `chat:update` — with `chat:progress` carrying what
 * the agent is doing while a turn is still running.
 */
export interface MailboxOptions {
  /**
   * Opens the host's sign-in flow. The packaged app passes one (it owns the
   * setup window); a dev server passes none, and its users are told to sign in
   * from a terminal instead.
   */
  signIn?: () => void;
  /**
   * Environment for the agent process. The packaged app prepends its own
   * bin/ (node, ffmpeg) so the tools in CLAUDE.md run on a machine that has
   * neither installed.
   */
  agentEnv?: () => NodeJS.ProcessEnv;
}

export function mailboxPlugin(options: MailboxOptions = {}): Plugin {
  const canSignIn = typeof options.signIn === "function";
  let workspaceRoot = "";
  let mailboxDir = "";
  let filmsDir = "";

  const queue: QueueItem[] = [];
  let busy = false;
  let activeItem: QueueItem | null = null;
  let activeChild: ChildProcess | null = null;
  // Placeholder ids the user cancelled — consulted both when a queued item
  // is about to start (skip it) and when the active one finishes (report it
  // as cancelled rather than as a generic failure).
  const cancelledIds = new Set<string>();

  /** `.mailbox/<film>/thread.json`, resolved and containment-checked. */
  function threadPath(film: string): string | null {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(film)) return null;
    const dir = path.resolve(mailboxDir, film);
    if (!dir.startsWith(mailboxDir + path.sep)) return null;
    return path.join(dir, "thread.json");
  }

  /**
   * Attachments as the request names them, kept only when they really are
   * files inside this film's folder — the paths end up in the agent's prompt.
   */
  function validAttachments(film: string, raw: unknown): ChatAttachment[] {
    if (!Array.isArray(raw)) return [];
    const filmDir = path.join(filmsDir, film) + path.sep;
    const out: ChatAttachment[] = [];
    for (const entry of raw.slice(0, MAX_ATTACHMENTS)) {
      if (!entry || typeof entry !== "object") continue;
      const a = entry as Record<string, unknown>;
      if (typeof a.path !== "string" || typeof a.name !== "string" || typeof a.url !== "string") continue;
      const kind = ATTACHMENT_KINDS.find((k) => k === a.kind);
      const file = path.resolve(workspaceRoot, a.path);
      if (!kind || !file.startsWith(filmDir) || !fs.existsSync(file)) continue;
      const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
      out.push({ name: a.name.slice(0, 200), path: rel, url: "/" + rel.split("/").map(encodeURIComponent).join("/"), kind });
    }
    return out;
  }

  function readThread(film: string): Thread {
    const file = threadPath(film);
    if (!file) return { sessionId: null, messages: [] };
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Thread;
    } catch {
      return { sessionId: null, messages: [] };
    }
  }

  function writeThread(film: string, thread: Thread): void {
    const file = threadPath(film);
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(thread, null, 2));
  }

  function broadcast(server: ViteDevServer, film: string): void {
    server.ws.send({
      type: "custom",
      event: "chat:update",
      data: { film, messages: readThread(film).messages },
    });
  }

  // Progress state for the single in-flight turn (the queue runs one at a
  // time). Pushed on its own event and never written to thread.json.
  let latestProgress: ChatProgress | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastProgressAt = 0;

  function sendProgress(server: ViteDevServer, progress: ChatProgress): void {
    lastProgressAt = Date.now();
    server.ws.send({ type: "custom", event: "chat:progress", data: progress });
  }

  /**
   * Push the newest progress line, at most one every PROGRESS_THROTTLE_MS.
   * Intermediate lines are dropped rather than queued: what the agent is doing
   * *now* is the only interesting one.
   */
  function publishProgress(server: ViteDevServer, progress: ChatProgress): void {
    latestProgress = progress;
    if (progressTimer) return;
    const wait = PROGRESS_THROTTLE_MS - (Date.now() - lastProgressAt);
    if (wait <= 0) {
      sendProgress(server, progress);
      return;
    }
    progressTimer = setTimeout(() => {
      progressTimer = null;
      if (latestProgress) sendProgress(server, latestProgress);
    }, wait);
  }

  /** An empty `step` tells the client this turn has no progress any more. */
  function clearProgress(server: ViteDevServer, item: QueueItem): void {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    latestProgress = null;
    sendProgress(server, { film: item.film, messageId: item.placeholderId, step: "", startedAt: 0 });
  }

  function processNext(server: ViteDevServer): void {
    if (busy) return;
    while (queue.length > 0 && cancelledIds.has(queue[0].placeholderId)) {
      cancelledIds.delete(queue.shift()!.placeholderId);
    }
    if (queue.length === 0) return;

    busy = true;
    const item = queue.shift()!;
    activeItem = item;

    // Only now — actually starting a `claude -p` process — does the
    // placeholder become "processing"; until this point it was "pending"
    // (queued behind another film's turn).
    const thread = readThread(item.film);
    const message = thread.messages.find((m) => m.id === item.placeholderId);
    if (message) message.status = "processing";
    writeThread(item.film, thread);
    broadcast(server, item.film);

    runClaude(server, item);
  }

  /** Write a final reply into the placeholder and let the queue move on. */
  function settleWith(server: ViteDevServer, item: QueueItem, text: string, isError: boolean): void {
    clearProgress(server, item);
    const thread = readThread(item.film);
    const message = thread.messages.find((m) => m.id === item.placeholderId);
    if (message) {
      message.text = text;
      message.status = isError ? "error" : "done";
    }
    writeThread(item.film, thread);
    broadcast(server, item.film);
    activeItem = null;
    busy = false;
    processNext(server);
  }

  function runClaude(server: ViteDevServer, item: QueueItem, forceNewSession = false): void {
    // Resolved up front rather than relying on PATH: a GUI-launched server has
    // none of the per-user install locations on it.
    const claudePath = resolveClaudePath();
    if (!claudePath) {
      console.error("[mailbox] claude executable not found — is Claude Code installed?");
      settleWith(server, item, CLAUDE_MISSING_TEXT, true);
      return;
    }

    const sessionId = forceNewSession ? null : readThread(item.film).sessionId;

    // `stream-json` rather than `json`: the panel needs to say what the agent
    // is doing while it does it, and a single end-of-turn blob cannot. It also
    // requires --verbose, which only affects what the stream carries.
    const args = [
      "-p",
      buildPrompt(item, filmsDir),
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      CHAT_STYLE_PROMPT,
      "--model",
      item.settings.model,
      "--dangerously-skip-permissions",
    ];
    // Haiku has no effort levels; passing one would fail the invocation.
    if (item.settings.model !== "haiku") args.push("--effort", item.settings.effort);
    if (sessionId) args.push("--resume", sessionId);

    const startedAt = Date.now();
    let stderr = "";
    let pending = ""; // partial trailing line of the NDJSON stream
    let settled = false;
    let result: StreamEvent | null = null;
    let nextSessionId = sessionId;

    const report = (step: string, detail?: string) =>
      publishProgress(server, { film: item.film, messageId: item.placeholderId, step, detail, startedAt });

    report("시작하는 중");

    const handleEvent = (event: StreamEvent): void => {
      if (typeof event.session_id === "string") nextSessionId = event.session_id;

      if (event.type === "system" && event.subtype === "init") {
        report("준비하는 중");
        return;
      }
      if (event.type === "result") {
        result = event;
        return;
      }
      if (event.type !== "assistant") return;

      for (const raw of event.message?.content ?? []) {
        const block = raw as ContentBlock;
        if (block.type === "text" && block.text) {
          // The agent narrating its own next step is the best label there is —
          // better than any mapping of tool names.
          const line = lastLine(block.text);
          if (line) report("작업하는 중", line);
        } else if (block.type === "tool_use" && block.name) {
          const { step, detail } = describeTool(block.name, block.input);
          report(step, detail);
        }
      }
    };

    const consume = (chunk: string): void => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleEvent(JSON.parse(trimmed) as StreamEvent);
        } catch {
          // A non-JSON line is startup noise, not something to fail a turn over.
        }
      }
    };

    const child = spawn(claudePath, args, {
      cwd: workspaceRoot,
      env: options.agentEnv?.() ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;

    const timer = setTimeout(() => child.kill(), WORKER_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => consume(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const finish = () => {
      if (settled) return;
      if (pending.trim()) consume("\n");

      // A stale/unknown session id (e.g. expired on Anthropic's side) makes
      // `claude -p --resume` fail before it ever produces a result event —
      // retry once as a brand-new session instead of surfacing an error the
      // user has no way to act on. Skipped if the user cancelled in the
      // meantime.
      if (
        !forceNewSession &&
        sessionId &&
        !result &&
        !cancelledIds.has(item.placeholderId) &&
        /no conversation found/i.test(stderr)
      ) {
        settled = true;
        clearTimeout(timer);
        activeChild = null;
        runClaude(server, item, true);
        return;
      }

      settled = true;
      clearTimeout(timer);
      activeChild = null;
      activeItem = null;
      clearProgress(server, item);

      if (cancelledIds.delete(item.placeholderId)) {
        const thread = readThread(item.film);
        thread.sessionId = nextSessionId;
        const message = thread.messages.find((m) => m.id === item.placeholderId);
        if (message) {
          message.status = "cancelled";
          message.text = "";
        }
        writeThread(item.film, thread);
        broadcast(server, item.film);
        busy = false;
        processNext(server);
        return;
      }

      let replyText = FALLBACK_ERROR_TEXT;
      let isError = true;
      let saysSignedOut = false;

      // `claude -p` can exit non-zero while still having streamed a valid
      // result event (e.g. "not logged in") — always go by the event, never
      // by the exit code.
      const final: StreamEvent | null = result;
      if (final && typeof final.result === "string" && final.result.length > 0) {
        isError = Boolean(final.is_error);
        if (!isError) {
          replyText = final.result;
        } else if (/not logged in/i.test(final.result)) {
          saysSignedOut = true;
        } else {
          console.error(`[mailbox] claude reported an error: ${final.result}`);
        }
      } else {
        console.error(`[mailbox] claude invocation produced no usable result event.\nstderr:\n${stderr}`);
      }

      /** Write the reply into the placeholder and let the queue move on. */
      const commit = (auth: ChatAuthFailure | null): void => {
        const thread = readThread(item.film);
        thread.sessionId = nextSessionId;
        const message = thread.messages.find((m) => m.id === item.placeholderId);
        if (message) {
          message.text = auth ? (auth.canSignIn ? SIGNED_OUT_TEXT_APP : SIGNED_OUT_TEXT_DEV) : replyText;
          message.status = isError ? "error" : "done";
          message.settings = item.settings;
          if (auth) message.auth = auth;
          // Recorded on success only: a failed turn's duration would poison the
          // "usually takes about this long" estimate the panel shows.
          if (!isError) message.durationMs = final?.duration_ms ?? Date.now() - startedAt;
        }
        writeThread(item.film, thread);
        broadcast(server, item.film);

        busy = false;
        processNext(server);
      };

      if (!isError) {
        commit(null);
        return;
      }

      // Every failure asks the CLI whether an account is still signed in,
      // rather than matching on the wording of the error: an expired session
      // is the one failure the user can actually fix, and it must not be
      // missed because the message was phrased differently.
      void isSignedOut().then((signedOut) => commit(signedOut || saysSignedOut ? { canSignIn } : null));
    };

    child.on("close", () => finish());
    child.on("error", (err) => {
      console.error("[mailbox] failed to spawn claude:", err);
      finish();
    });
  }

  return {
    name: "motion-mailbox",

    configResolved(config) {
      // The agent's cwd is the workspace, not the server root: in a packaged
      // app the bundle is read-only. In repo mode the two are the same.
      const ws = resolveWorkspace(config.root);
      workspaceRoot = ws.root;
      mailboxDir = ws.mailboxDir;
      filmsDir = ws.filmsDir;
    },

    configureServer(server) {
      fs.mkdirSync(mailboxDir, { recursive: true });

      // A message stuck "pending"/"processing" means a previous run was
      // killed mid-turn (or while queued) — the in-memory queue is gone on
      // restart, so surface that instead of leaving it stuck.
      for (const entry of fs.readdirSync(mailboxDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const thread = readThread(entry.name);
        let recovered = false;
        for (const message of thread.messages) {
          if (message.status === "pending" || message.status === "processing") {
            message.status = "error";
            message.text = "이전 요청이 처리되는 중에 앱이 멈췄어요. 다시 말씀해 주세요.";
            recovered = true;
          }
        }
        if (recovered) writeThread(entry.name, thread);
      }

      process.on("exit", () => activeChild?.kill());

      // Send a prompt (POST, body: { film, text, attachments?, settings? }).
      // Registered before the bare `/__chat` route since routes match by prefix.
      server.middlewares.use("/__chat/send", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const film = typeof body.film === "string" ? body.film : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!film || !threadPath(film) || !fs.existsSync(path.join(filmsDir, film))) {
          return json(res, 400, { error: "missing or invalid film" });
        }
        const attachments = validAttachments(film, body.attachments);
        const approval = (Object.keys(APPROVALS) as Approval[]).find((a) => a === body.approval);
        if (!text && attachments.length === 0 && !approval) return json(res, 400, { error: "missing text" });

        // Whatever the agent stopped for, the designer has now answered. An
        // approval is recorded here, not left to the agent, so the gate holds
        // even if the turn fails.
        const filmDir = path.join(filmsDir, film);
        const state = readState(filmDir);
        if (state.waiting || approval) {
          writeState(filmDir, {
            waiting: null,
            ...(approval && { approved: [...new Set([...(state.approved ?? []), approval])] }),
          });
        }

        const now = new Date().toISOString();
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text: text || (approval ? `${APPROVALS[approval]} 승인` : ""),
          status: "done",
          createdAt: now,
          ...(attachments.length > 0 && { attachments }),
        };
        const placeholder: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "",
          status: "pending",
          createdAt: now,
        };

        const thread = readThread(film);
        thread.messages.push(userMessage, placeholder);
        writeThread(film, thread);
        broadcast(server, film);

        const userText = text || (approval ? "승인합니다. 다음 단계로 진행해 주세요." : "");
        queue.push({ film, placeholderId: placeholder.id, userText, attachments, approval, settings: readSettings(body) });
        processNext(server);

        json(res, 201, { ok: true });
      });

      // Cancel an in-flight or still-queued turn (POST, body: { film, messageId }).
      server.middlewares.use("/__chat/cancel", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const film = typeof body.film === "string" ? body.film : "";
        const messageId = typeof body.messageId === "string" ? body.messageId : "";
        if (!film || !threadPath(film) || !messageId) {
          return json(res, 400, { error: "missing or invalid film/messageId" });
        }

        if (activeItem && activeItem.film === film && activeItem.placeholderId === messageId) {
          // Actually running: mark it, then kill — `finish()` sees the mark
          // and reports "cancelled" instead of the generic failure text.
          cancelledIds.add(messageId);
          activeChild?.kill();
        } else {
          const index = queue.findIndex((q) => q.film === film && q.placeholderId === messageId);
          if (index !== -1) queue.splice(index, 1);
          const thread = readThread(film);
          const message = thread.messages.find((m) => m.id === messageId);
          if (message && (message.status === "pending" || message.status === "processing")) {
            message.status = "cancelled";
            message.text = "";
            writeThread(film, thread);
            broadcast(server, film);
          }
        }

        json(res, 200, { ok: true });
      });

      // Start a fresh conversation for a film (POST, body: { film }):
      // drops its queued/in-flight turns, clears history and the session id.
      server.middlewares.use("/__chat/reset", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const film = typeof body.film === "string" ? body.film : "";
        if (!film || !threadPath(film)) return json(res, 400, { error: "missing or invalid film" });

        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].film === film) queue.splice(i, 1);
        }
        if (activeItem && activeItem.film === film) {
          cancelledIds.add(activeItem.placeholderId);
          activeChild?.kill();
        }

        writeThread(film, { sessionId: null, messages: [] });
        broadcast(server, film);

        json(res, 200, { ok: true });
      });

      // Send a failed request again, unchanged (POST, body: { film, messageId }).
      // Rebuilt from the thread rather than from a copy held in memory, so it
      // still works after a restart.
      server.middlewares.use("/__chat/retry", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const film = typeof body.film === "string" ? body.film : "";
        const messageId = typeof body.messageId === "string" ? body.messageId : "";
        if (!film || !threadPath(film) || !messageId) {
          return json(res, 400, { error: "missing or invalid film/messageId" });
        }

        const thread = readThread(film);
        const index = thread.messages.findIndex((m) => m.id === messageId);
        const placeholder = index === -1 ? undefined : thread.messages[index];
        const request = index > 0 ? thread.messages[index - 1] : undefined;
        if (!placeholder || placeholder.role !== "assistant" || request?.role !== "user") {
          return json(res, 404, { error: "nothing to retry" });
        }
        if (activeItem?.placeholderId === messageId || queue.some((q) => q.placeholderId === messageId)) {
          return json(res, 409, { error: "already queued" });
        }

        // The same placeholder is reused, so the thread does not grow a second
        // empty bubble every time a retry is needed.
        placeholder.status = "pending";
        placeholder.text = "";
        delete placeholder.auth;
        writeThread(film, thread);
        broadcast(server, film);

        queue.push({
          film,
          placeholderId: messageId,
          userText: request.text,
          attachments: validAttachments(film, request.attachments),
          settings: placeholder.settings ?? DEFAULT_SETTINGS,
        });
        processNext(server);

        json(res, 200, { ok: true });
      });

      // Ask the host to open its sign-in flow (POST). Only the packaged app
      // has one; a dev server answers `{ ok: false }`.
      server.middlewares.use("/__chat/signin", (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!options.signIn) return json(res, 200, { ok: false });
        options.signIn();
        json(res, 200, { ok: true });
      });

      // Initial load for one film's thread: GET /__chat?film=<slug>.
      server.middlewares.use("/__chat", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const film = url.searchParams.get("film") ?? "";
        if (!film || !threadPath(film)) return json(res, 200, []);
        json(res, 200, readThread(film).messages);
      });
    },
  };
}
