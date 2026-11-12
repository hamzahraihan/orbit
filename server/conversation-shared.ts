/**
 * The vocabulary every conversation provider shares: the resolved conversation
 * shapes, the paging and transcript-stream types, the error classes that tell a
 * route which gap it hit, and the one conversation cache the readers back onto.
 *
 * Nothing here parses a store. This module imports no provider reader, so a
 * provider can name these types without pulling the reader module in behind them.
 */

import { createHash } from "node:crypto";

import type { ConversationMetadata, ConversationTurn, SessionSnapshot } from "../shared/protocol.ts";
import type { AgyStore } from "./agy-store.ts";
import { ConversationCache } from "./conversation-cache.ts";

/**
 * A transcript is read a page at a time, the newest page re-read on every append
 * while an agent works: Codex rollouts reach hundreds of MB (a 400MB one took 1.1s
 * and 1.7GB of memory to parse whole). 16MB still holds dozens of turns of a
 * tool-heavy session; the chat asks for the pages before it as the reader scrolls up.
 */

/** Singleton conversation cache backing every pane reader. */
export const conversationCache = new ConversationCache();
export const TRANSCRIPT_WINDOW_BYTES = 16 * 1024 * 1024;

export class ConversationUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ConversationUnavailable";
  }
}

/** The pane's agent holds a session it has not written yet: a conversation with no turns, not a missing one. */
export class ConversationNotStarted extends ConversationUnavailable {
  constructor(readonly sessionId: string, readonly source: RecognizedConversation["source"] = "omo-transcript", readonly identity: string = sessionId) {
    super("session_not_written");
    this.name = "ConversationNotStarted";
  }
}

/** A cursor from another transcript: the pane started a new session, or a Codex backtrack replaced the file. */
export class HistoryChanged extends Error {
  constructor() {
    super("the conversation's transcript changed; reload it from its newest turns");
    this.name = "HistoryChanged";
  }
}

/** What paneConversation resolved: which store the turns came from, and where they start. */
export type RecognizedConversation = {
  activity?: "thinking" | "working" | "idle";
  source: "grok-transcript" | "agy-transcript" | "claude-transcript" | "omp-transcript" | "omo-transcript" | "gjc-transcript" | "pi-transcript" | "codex-transcript" | "devin-transcript" | "opencode-transcript" | "hermes-transcript";
  turns: ConversationTurn[];
  metadata: ConversationMetadata;
  /** the first turn's position, for the page before it; null at the conversation's beginning */
  cursor: string | null;
  /**
   * Turns the file holds on paths a `/tree` walked away from, which no page of this conversation
   * can reach; absent for every agent that keeps no entry tree. pi moves its leaf without writing
   * anything, so the chat would otherwise drop those turns with no sign they were ever there.
   */
  abandoned?: { count: number; branches: number; summary: string | null };
  history_id: string;
  /** changes whenever the answer could: the route's ETag, so an unchanged poll costs no body */
  version: string;
};

/** The one store list a recognized conversation can come from (RecognizedConversation["source"]). */
export type TurnSource = RecognizedConversation["source"];

/** The stores read as one append-only file: OpenCode's and Devin's databases are paged by opencode.ts and devin.ts. */
export type StreamSource = Exclude<RecognizedConversation["source"], "opencode-transcript" | "devin-transcript" | "hermes-transcript">;

/** A restart may parse the same files differently: its answers never match an earlier ETag. */
export function answerVersion(key: string, signature: string): string {
  return createHash("sha256").update(`${conversationCache.processVersion}\0${key}\0${signature}`).digest("base64url").slice(0, 22);
}

/**
 * Which turns: without `before`, the newest page (with `from`, from that held start
 * while it is still inside the newest page); with `before`, the page ending there,
 * never reaching back past `since`.
 */
export type ConversationPage = { before?: string; since?: string; from?: string };

/**
 * A transcript as one byte stream: for a paginated Codex rollout the history it
 * continues comes first (codexHistorySegments). Transcripts only grow at the end,
 * so a position in it keeps naming the same turn for as long as the file does.
 */
export interface TranscriptStream {
  /** the live file's identity: cursors from any other file are refused */
  id: string;
  /** `offset` is where the segment starts in its file: equal to `start` for a whole prefix */
  files: { path: string; start: number; length: number; offset: number }[];
  length: number;
  floor: number;
  promptStarts?: number[];
  fd?: number;
}

/** Where a pane's conversation is: a transcript file, or a session in OpenCode's database. */
export type ResolvedTranscript =
  | { source: StreamSource; path: string; codexHome?: string; agy?: AgyStore }
  | { source: "opencode-transcript"; path: string; session: string }
  | { source: "hermes-transcript"; path: string; sessionId: string };

/** A native file or database session, resolved without parsing conversation turns. */
export type NativeTranscript =
  | ResolvedTranscript
  | { source: "devin-transcript"; path: string; session: string; cwd: string };

/**
 * One pane's conversation, opened once and read page by page: the transcript behind it is
 * resolved (and, for a transcript file, its stream is kept) when the reader opens. A search that
 * walks many pages of one pane reuses that work instead of resolving the same session per page.
 */
export interface PaneConversationReader {
  read(page?: ConversationPage): Promise<RecognizedConversation>;
}

/** A reader's last transcript stream, kept while its file stays the same (see paneConversationReader). */
export interface TranscriptStreamReuse {
  source?: StreamSource;
  path?: string;
  stat?: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
  stream?: TranscriptStream;
}

/** Every store path a conversation provider may read, with the snapshot that named them. */
export type TranscriptSources = { codexHome?: string; devinDbPath?: string; opencodeDb?: string; hermesHome?: string; grokHome?: string; snapshot?: SessionSnapshot };
