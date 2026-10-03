/** One row of the film list. Read from `films/<slug>/film.json`. */
export interface FilmSummary {
  /** Folder name, kept verbatim. Used as the URL segment and the chat thread key. */
  slug: string;
  /** `title` from film.json, or the slug when film.json is missing or unreadable. */
  title: string;
  dur?: number;
  bpm?: number;
  formats: string[];
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

export interface FilmJson {
  title?: string;
  dur: number;
  bpm?: number;
  beatOffset?: number;
  fps?: number;
  formats?: Record<string, [number, number]>;
  transparent?: boolean;
  params?: Record<string, FilmParam>;
  timeline?: Record<string, { t: number; label?: string }>;
  cues?: ({ t?: number; at?: string; dt?: number; type: string } & Record<string, unknown>)[];
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
  cues: { t: number; type: string }[];
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
  /** The latest video without sound — a draft or a full render before sound.mjs. */
  silent?: FilmFile;
  poster?: FilmFile;
  contact?: FilmFile;
  /** Images critique.sh makes for review: contact, strip, phone, seam. */
  critique: (FilmFile & { name: string })[];
}

/** Everything around a film the app shows besides the film itself. */
export interface FilmFiles {
  docs: Partial<Record<"brief" | "shotlist" | "review" | "style", FilmFile>>;
  outputs: FilmOutput[];
  /**
   * The furthest step of the pipeline the film has reached. Inferred from the
   * files that exist until the agent records it in state.json itself.
   */
  stage: FilmStage;
  quality: FilmQuality;
}

/** A file the user attached to a chat message, already saved inside the film folder. */
export interface ChatAttachment {
  /** Original filename as picked/dropped by the user. */
  name: string;
  /** Workspace-relative path of the saved copy, e.g. "films/<slug>/refs/<file>.png". */
  path: string;
  /** URL the app can show it from. */
  url: string;
  kind: "image" | "video" | "audio";
}

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
