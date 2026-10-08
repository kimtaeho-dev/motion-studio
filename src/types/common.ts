/** One row of the film list. Read from `films/<slug>/film.json`. */
export interface FilmSummary {
  /** Folder name, kept verbatim. Used as the URL segment and the chat thread key. */
  slug: string;
  /** `title` from film.json, or the slug when film.json is missing or unreadable. */
  title: string;
  dur?: number;
  bpm?: number;
  formats: string[];
  /** "lottie": the deliverable is films/<slug>/lottie.json (prompts/lottie.md); otherwise a video film. */
  kind?: FilmKind;
  /** Set when film.json is missing or does not parse; the film still lists so it can be fixed or deleted. */
  error?: string;
  /** Epoch ms of the newest file in the film folder — the list is sorted by it. */
  updatedAt: number;
}

export interface FilmsTree {
  films: FilmSummary[];
}

/** film.json as the app reads it. The full contract lives in lib/stage.js. */
export interface FilmParam {
  type: "text" | "color" | "number";
  value: string | number;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}

export type FilmKind = "film" | "lottie";

/** Canvas sizes offered for a new Lottie film (the agent can change w/h in lottie.json). */
export const LOTTIE_SIZES = [
  { value: "512x512", label: "아이콘·상태", size: [512, 512] },
  { value: "1080x1080", label: "정사각 장면", size: [1080, 1080] },
  { value: "1920x1080", label: "가로", size: [1920, 1080] },
  { value: "1080x1920", label: "세로", size: [1080, 1920] },
] as const;
export const LOTTIE_DUR = { min: 0.5, max: 30 } as const;

export interface FilmJson {
  title?: string;
  /** "lottie" films are written by tools/lottie.mjs sync from lottie.json; their length is not edited in the app. */
  kind?: FilmKind;
  dur: number;
  bpm?: number;
  beatOffset?: number;
  fps?: number;
  formats?: Record<string, [number, number]>;
  transparent?: boolean;
  params?: Record<string, FilmParam>;
  timeline?: Record<string, { t: number; label?: string }>;
}

/** window.FILM inside a loaded film page (lib/stage.js). */
export interface StageFilm {
  title: string;
  dur: number;
  bpm: number;
  beatOffset: number;
  fps: number;
  W: number;
  H: number;
  format: string;
  formats: string[];
  transparent: boolean;
}

/** Pushed as `film:changed` when files inside a film folder (or its renders) change. */
export interface FilmChange {
  slug: string;
  /**
   * "json": film.json (re-apply in place) · "code": anything the page loads (reload)
   * · "doc": briefs, shotlists, refs · "out": renders under out/<slug>/.
   */
  kind: "json" | "code" | "doc" | "out";
}

/** How much critique a film gets — chosen when it is created, kept in state.json. */
export type FilmQuality = "fast" | "standard" | "launch";

/** The pipeline in CLAUDE.md, in order. */
export const FILM_STAGES = ["brief", "shotlist", "stills", "draft", "critique", "deliver"] as const;
export type FilmStage = (typeof FILM_STAGES)[number];

export interface FilmFile {
  url: string;
  mtime: number;
}

/** Renders for one format, under out/<slug>/<format>/. */
export interface FilmOutput {
  format: string;
  final?: FilmFile;
  /** The latest quick render (--draft): half size, 30fps. */
  draft?: FilmFile;
  poster?: FilmFile;
  contact?: FilmFile;
  /** Images tools/critique.mjs makes for review: contact, strip, phone, seam. */
  critique: (FilmFile & { name: string })[];
}

/** Everything around a film the app shows besides the film itself. */
export interface FilmFiles {
  docs: Partial<Record<"brief" | "shotlist" | "review" | "style", FilmFile>>;
  outputs: FilmOutput[];
  /** The pipeline step: what the agent recorded in state.json, or — with none recorded — what the files show. */
  stage: FilmStage;
  quality: FilmQuality;
  /** The agent stopped for the designer: to approve the shotlist, or to answer its questions. */
  waiting: FilmWaiting | null;
  /** Critique round in progress or last finished (1-based), when the agent recorded one. */
  round: number | null;
}

export type FilmWaiting = "approval" | "answer";

/** films/<slug>/state.json — written by the app (quality, approvals) and the agent (tools/state.mjs). */
export interface FilmState {
  stage?: FilmStage;
  waiting?: FilmWaiting | null;
  round?: number;
  quality?: FilmQuality;
  /** Gates the designer has passed, e.g. ["shotlist"]. */
  approved?: string[];
}

/** One render in the studio's queue (server/render.ts), pushed as `render:update`. */
export interface RenderJob {
  id: string;
  film: string;
  /** "최종 렌더", "초안 · 2–4초", "비트 스틸", … */
  label: string;
  mode: "video" | "stills";
  status: "queued" | "running" | "done" | "error" | "cancelled";
  /** The format being rendered right now (an --all-formats job goes through several). */
  format: string | null;
  /** Frames (or stills) done and total, for the current format. */
  done: number;
  total: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** Workspace-relative paths of what the job wrote. */
  files: string[];
}

/** What the export dialog can deliver (server/export.ts). */
export type ExportKind = "lottie" | "mp4" | "gif" | "prores" | "webm" | "png";

export interface ExportStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
}

/** The one export at a time, pushed as `export:update`. */
export interface ExportJob {
  id: string;
  film: string;
  title: string;
  status: "running" | "done" | "error" | "cancelled";
  steps: ExportStep[];
  startedAt: number;
  error?: string;
  /** The folder the files went to, once done. */
  dest?: string;
  /** The zip next to it, when one was asked for. */
  zip?: string;
}

/** A file the user attached to a chat message, already saved inside the film folder. */
export interface ChatAttachment {
  /** Original filename as picked/dropped by the user. */
  name: string;
  /** Workspace-relative path of the saved copy, e.g. "films/<slug>/refs/<file>.png". */
  path: string;
  /** URL the app can show it from. */
  url: string;
  kind: "image" | "video" | "model";
  /**
   * What the agent does with it: "reference" borrows only the style (CLAUDE.md, 레퍼런스),
   * "asset" puts the file itself in the film (the designer's own logo, icon, screenshot, .glb).
   * Missing on attachments sent before this existed — read those as their kind's default.
   */
  role?: AttachmentRole;
}

export type AttachmentRole = "reference" | "asset";

/** The role an attachment starts with, and whether the designer may change it. */
export function defaultRole(a: Pick<ChatAttachment, "kind" | "name">): AttachmentRole {
  if (a.kind === "model") return "asset";
  if (a.kind === "image" && /\.svg$/i.test(a.name)) return "asset";
  return "reference";
}
export const roleFixed = (kind: ChatAttachment["kind"]) => kind !== "image";

/** Which Claude model a turn runs on. Mirrors the CLI's `--model` aliases. */
export type ChatModel = "haiku" | "sonnet" | "opus";

/** How much the model deliberates. Mirrors the CLI's `--effort` levels. */
export type ChatEffort = "low" | "medium" | "high" | "max";

/** The model settings a single turn was sent with. */
export interface ChatSettings {
  model: ChatModel;
  effort: ChatEffort;
}

/**
 * Why a turn failed, when the reason is that the agent has no signed-in
 * account. Present only on a failed assistant message.
 */
export interface ChatAuthFailure {
  /** True when the host can open a sign-in window itself — the packaged app can, a dev server cannot. */
  canSignIn: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  createdAt: string;
  attachments?: ChatAttachment[];
  /** Assistant messages only: the settings this turn actually ran with. */
  settings?: ChatSettings;
  /** Assistant messages only: wall-clock time of a finished turn, in ms. */
  durationMs?: number;
  /** Set when this turn failed because the agent is signed out; the request can be sent again. */
  auth?: ChatAuthFailure;
}

/**
 * Live status of an in-flight turn, pushed as `chat:progress` while the agent
 * works. Not persisted — one turn produces hundreds of these.
 */
export interface ChatProgress {
  film: string;
  /** The placeholder message this progress belongs to. */
  messageId: string;
  /** Short Korean label for what the agent is doing right now. */
  step: string;
  /** Optional second line: a filename, a plan step, the agent's own words. */
  detail?: string;
  /** Epoch ms the turn started, so the client can run its own timer. */
  startedAt: number;
}
