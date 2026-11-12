/**
 * Transcript provider interface and exhaustive 11-source registry.
 *
 * This module defines the `TranscriptProvider` interface that every vendor
 * provider implements (todos 6-7) and the exhaustive registry that replaces the
 * `if (agent === ...)` chain in `resolveTranscript`.
 *
 * The interface declares shapes only: an interface has no bodies, and every
 * implementation arrives in todos 6-7. Until then the registry holds descriptors
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
 *   - Implement any provider behavior (todos 6-7 own that).
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
  RecognizedConversation,
  ResolvedTranscript,
  TranscriptSources,
  TranscriptStreamReuse,
  TurnSource,
} from "./conversation-shared.ts";

/**
 * The interface every provider implements (todos 6-7).
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
  resolve(pane: HerdrPane, cwd: string, sources: TranscriptSources, panes?: HerdrPane[]): Promise<ResolvedTranscript>;

  /** Mirrors transcriptPage: one page of this provider's transcript, reusing the hub's stream when handed one. */
  page(path: string, page: ConversationPage, sources: TranscriptSources, reuse?: TranscriptStreamReuse): RecognizedConversation;

  /** Mirrors transcriptImage: the image bytes behind a ref, or null when the transcript has none. */
  readImage(path: string, ref: string, sources: TranscriptSources): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null;

  /** Mirrors transcriptToolOutput: the tool result text behind a ref, or null when it is not there. */
  readToolOutput(path: string, ref: string, sources: TranscriptSources): string | null;

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
