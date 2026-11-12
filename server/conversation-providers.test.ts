import { describe, expect, it } from "bun:test";
import { ConversationUnavailable } from "./conversation-shared.ts";
import type { TurnSource } from "./conversation-shared.ts";
import {
  providerFor,
  providerForRequired,
  transcriptProviderRegistry,
} from "./conversation-providers.ts";

// The 11 source literals in RecognizedConversation["source"]
const ALL_SOURCES: ReadonlyArray<TurnSource> = [
  "grok-transcript",
  "agy-transcript",
  "claude-transcript",
  "omp-transcript",
  "omo-transcript",
  "gjc-transcript",
  "pi-transcript",
  "codex-transcript",
  "devin-transcript",
  "opencode-transcript",
  "hermes-transcript",
];

describe("transcript provider registry", () => {
  it("maps every one of the 11 source literals to a descriptor", () => {
    for (const source of ALL_SOURCES) {
      const entry = transcriptProviderRegistry[source];
      expect(entry.source).toBe(source);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("holds exactly the 11 sources", () => {
    expect(Object.keys(transcriptProviderRegistry).length).toBe(11);
  });

  it("names 11 distinct providers", () => {
    const names = ALL_SOURCES.map((source) => transcriptProviderRegistry[source].name);
    expect(new Set(names).size).toBe(11);
  });

  it("returns undefined for an unknown source", () => {
    expect(providerFor("unknown-transcript" as TurnSource)).toBeUndefined();
  });

  it("throws ConversationUnavailable for an unknown source", () => {
    expect(() => providerForRequired("unknown-transcript" as TurnSource)).toThrow(
      ConversationUnavailable,
    );
  });
});
