import { createContext, createResource, createSignal, useContext, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import type { ChatAttachment, ChatMessage, ChatProgress, ChatSettings } from "@/types";
import { onServerEvent } from "@/lib/live";

const SETTINGS_KEY = "motion-studio.chat-settings";
const DEFAULT_SETTINGS: ChatSettings = { model: "opus", effort: "high" };

/** How many past turns the "usually takes about this long" hint averages over. */
const DURATION_SAMPLE = 5;

const ChatContext = createContext<{
  messages: () => ChatMessage[];
  sending: () => boolean;
  /** Live status of the turn currently running, when one is. */
  progress: () => ChatProgress | null;
  /** Median duration of recent successful turns, in ms; undefined until there are any. */
  typicalDurationMs: () => number | undefined;
  settings: () => ChatSettings;
  setSettings: (next: ChatSettings) => void;
  /** Saves a file into the current film's refs/ or audio/ folder, ready to attach. */
  upload: (file: File) => Promise<ChatAttachment>;
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  cancel: (messageId: string) => Promise<void>;
  /** Send a failed request again, unchanged. */
  retry: (messageId: string) => Promise<void>;
  /** Ask the host to open its sign-in window; false when it has none. */
  signIn: () => Promise<boolean>;
  reset: () => Promise<void>;
}>();

async function loadMessages(film: string | undefined): Promise<ChatMessage[]> {
  if (!film) return [];
  const res = await fetch(`/__chat?film=${encodeURIComponent(film)}`);
  if (!res.ok) throw new Error(`Failed to load chat for ${film} (HTTP ${res.status})`);
  return (await res.json()) as ChatMessage[];
}

/** The stored choice, ignoring anything this version no longer offers. */
function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    return { model: parsed.model ?? DEFAULT_SETTINGS.model, effort: parsed.effort ?? DEFAULT_SETTINGS.effort };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function ChatProvider(props: { children: JSX.Element }) {
  const params = useParams();
  // Keyed on the active film so switching films switches conversations.
  const [data, { mutate }] = createResource(() => params.film, loadMessages, { initialValue: [] });
  const [sending, setSending] = createSignal(false);
  const [progress, setProgress] = createSignal<ChatProgress | null>(null);
  const [settings, setSettingsSignal] = createSignal<ChatSettings>(loadSettings());

  const setSettings = (next: ChatSettings) => {
    setSettingsSignal(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // A browser with storage disabled just forgets the choice on reload.
    }
  };

  onServerEvent<{ film: string; messages: ChatMessage[] }>("chat:update", (payload) => {
    if (payload.film === params.film) mutate(payload.messages);
  });

  onServerEvent<ChatProgress>("chat:progress", (payload) => {
    if (payload.film !== params.film) return;
    // An empty step is the server saying this turn is over.
    setProgress(payload.step ? payload : null);
  });

  const upload = async (file: File) => {
    const film = params.film;
    if (!film) throw new Error("no film");
    const query = new URLSearchParams({ film, name: file.name });
    const res = await fetch(`/__films/upload?${query}`, { method: "POST", body: file });
    if (res.status === 413) throw new Error("파일이 너무 커요. 500MB 이하만 첨부할 수 있어요.");
    if (res.status === 400) throw new Error("이미지·영상·음악 파일만 첨부할 수 있어요.");
    if (!res.ok) throw new Error("파일을 저장하지 못했어요.");
    return (await res.json()) as ChatAttachment;
  };

  const send = async (text: string, attachments: ChatAttachment[] = []) => {
    const film = params.film;
    if (!film) return;
    setSending(true);
    try {
      await post("/__chat/send", { film, text, attachments, settings: settings() });
    } finally {
      setSending(false);
    }
  };

  const cancel = async (messageId: string) => {
    if (params.film) await post("/__chat/cancel", { film: params.film, messageId });
  };

  const retry = async (messageId: string) => {
    if (params.film) await post("/__chat/retry", { film: params.film, messageId });
  };

  const signIn = async () => {
    const res = await fetch("/__chat/signin", { method: "POST" });
    if (!res.ok) return false;
    return ((await res.json()) as { ok?: boolean }).ok === true;
  };

  const reset = async () => {
    if (!params.film) return;
    setProgress(null);
    await post("/__chat/reset", { film: params.film });
  };

  const messages = () => data() ?? [];

  // Median rather than mean: one long render-and-critique turn should not move
  // the hint the panel shows on every subsequent turn.
  const typicalDurationMs = () => {
    const samples = messages()
      .map((m) => m.durationMs)
      .filter((d): d is number => typeof d === "number" && d > 0)
      .slice(-DURATION_SAMPLE)
      .sort((a, b) => a - b);
    if (samples.length === 0) return undefined;
    return samples[Math.floor(samples.length / 2)];
  };

  return (
    <ChatContext.Provider
      value={{ messages, sending, progress, typicalDurationMs, settings, setSettings, upload, send, cancel, retry, signIn, reset }}
    >
      {props.children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within a ChatProvider");
  return context;
}
