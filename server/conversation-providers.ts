/**
 * The transcript provider contract: the `TranscriptProvider` interface, the
 * `ProviderContext` every page/image/tool-output call carries, and the
 * exhaustive 11-source descriptor registry.
 *
 * This module defines the shapes that every vendor provider implements in todo
 * 6 and the exhaustive registry that replaces the `if (agent === ...)` chain in
 * `resolveTranscript`.
 *
 * The interface declares shapes only: an interface has no bodies, and every
 * implementation arrives in todo 6. Until then the registry holds descriptors
 * (source plus name), not placeholder providers, so nothing here claims to read
 * a store it cannot.
 *
 * Invariants:
 *   - Every literal in RecognizedConversation["source"] has exactly one entry.
 *   - No two entries share the same source name.
 *   - The module imports no provider reader, so providers can name these types
 *     without pulling the reader module in behind them.
 *
 * Must NOT:
 *   - Implement any provider behavior (todo 6 owns that).
 *   - Include a per-provider `stat` operation; ConversationMonitor stats are
 *     generic (server/conversation-monitor.ts).
 *   - Import server/conversation.ts (the hub), directly or transitively.
 *   - Add a provider for a vendor that has no module today.
 */

import type { ConversationMetadata, HerdrPane } from "../shared/protocol.ts";
import { ConversationUnavailable } from "./conversation-shared.ts";
import type {
  ConversationNotStarted,
  ConversationPage,
  NativeTranscript,
  RecognizedConversation,
  TranscriptSources,
  TranscriptStreamReuse,
  TurnSource,
} from "./conversation-shared.ts";

/**
 * What a page, image or tool-output call carries: the transcript the hub already
 * resolved, the store paths and snapshot it resolved with, the pane's working
 * directory, and optionally the pane id and the stream reuse token.
 *
 * One object instead of loose arguments because opencode and hermes need their
 * session/session id (only `resolved` has it), and codex's image ref must stay
 * inside the pane's cwd (only `cwd` says where that is).
 */
export interface ProviderContext {
  /** The transcript this call reads, resolved by the hub. */
  resolved: NativeTranscript;
  /** The store paths and the snapshot the hub read this conversation with. */
  sources: TranscriptSources;
  /** The pane's working directory: codex's image ref must not escape it. */
  cwd: string;
  /** The pane's id, for a provider that must remember what it read. */
  paneId?: string;
  /** The stream reuse token for this conversation, so pages after the first reuse the stream. */
  reuse?: TranscriptStreamReuse;
}

/**
 * The interface every provider implements (todo 6).
 *
 * Covers what the hub does per vendor today: resolve a pane to a transcript,
 * page it, read an image, read a tool output, invalidate its cache, expose
 * start-screen metadata, and map its own errors to ConversationUnavailable /
 * ConversationNotStarted.
 *
 * Each method mirrors the hub helper it replaces, so a provider never has to be
 * told which source it is: it already is that source.
 */
export interface TranscriptProvider {
  /** Mirrors resolveTranscript: the pane, its cwd, the store paths, and the panes to search for a session id. */
  resolve(pane: HerdrPane, cwd: string, sources: TranscriptSources, panes?: HerdrPane[]): Promise<NativeTranscript>;

  /** Mirrors transcriptPage: one page of this provider's transcript, reusing the hub's stream when handed one. */
  page(call: ProviderContext, page: ConversationPage): RecognizedConversation;

  /** Mirrors transcriptImage: the image bytes behind a ref, or null when the transcript has none. */
  readImage(call: ProviderContext, ref: string): Promise<{ mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null>;

  /** Mirrors transcriptToolOutput: the tool result text behind a ref, or null when it is not there. */
  readToolOutput(call: ProviderContext, ref: string): string | null;

  /** Mirrors the per-provider forget*State calls: one path's cache, or all of it when no path is given. */
  invalidateCache(path?: string): void;

  /** Mirrors startScreenMetadata: the model and effort the agent's own screen states before its first turn. */
  startScreenMetadata(screen: string): Pick<ConversationMetadata, "model" | "reasoning_effort">;

  /** Mirrors the provider's error mapping; null means the error is not this provider's to explain. */
  mapError(error: unknown): ConversationUnavailable | ConversationNotStarted | null;
}

/** A typed provider identity/descriptor matching the TranscriptProvider interface. */
type ProviderDescriptor = {
  /** The recognized conversation source this provider handles. */
  source: TurnSource;
  /** Human-readable name of the provider (e.g. "grok", "claude"). */
  name: string;
};

/** The exhaustive registry: maps every recognized source to a provider descriptor.
 *  Every literal in RecognizedConversation["source"] is a key. */
const transcriptProviderRegistry: Record<TurnSource, ProviderDescriptor> = {
  /** Grok native update log transcript. */
  "grok-transcript": { source: "grok-transcript", name: "grok" },
  /** Agy append-only step ledger transcript. */
  "agy-transcript": { source: "agy-transcript", name: "agy" },
  /** Claude Code project transcript. */
  "claude-transcript": { source: "claude-transcript", name: "claude" },
  /** OMP (Open Multi-Processing) session transcript. */
  "omp-transcript": { source: "omp-transcript", name: "omp" },
  /** OmO (OmO) session transcript. */
  "omo-transcript": { source: "omo-transcript", name: "omo" },
  /** GJC (GhostJob CLI) session transcript. */
  "gjc-transcript": { source: "gjc-transcript", name: "gjc" },
  /** Pi (Pi-coding-agent) session transcript. */
  "pi-transcript": { source: "pi-transcript", name: "pi" },
  /** Codex (OpenAI Codex) rollout transcript. */
  "codex-transcript": { source: "codex-transcript", name: "codex" },
  /** Devin CLI session transcript. */
  "devin-transcript": { source: "devin-transcript", name: "devin" },
  /** OpenCode session transcript. */
  "opencode-transcript": { source: "opencode-transcript", name: "opencode" },
  /** Hermes session transcript. */
  "hermes-transcript": { source: "hermes-transcript", name: "hermes" },
};

/** Look up a provider descriptor by its source literal.
 *  Returns undefined when the source is not recognized. */
export function providerFor(source: TurnSource): ProviderDescriptor | undefined {
  return transcriptProviderRegistry[source];
}

/** Look up a provider descriptor by its source literal.
 *  Throws ConversationUnavailable when the source is not recognized. */
export function providerForRequired(source: TurnSource): ProviderDescriptor {
  const entry = transcriptProviderRegistry[source];
  if (!entry) {
    throw new ConversationUnavailable("no_recognized_transcript");
  }
  return entry;
}

/** Re-export the shared transcript sources type. */
export type { TranscriptSources };
/** Export the exhaustive registry for compile-time checking. */
export { transcriptProviderRegistry };
