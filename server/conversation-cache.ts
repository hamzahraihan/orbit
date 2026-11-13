import { randomUUID } from "node:crypto";
import type { ConversationMetadata, ConversationTurn } from "../shared/protocol.ts";
import type { TurnSource } from "./conversation-shared.ts";

export const PI_PAGE_CACHE_BYTES = 4 * 1024 * 1024;

export class ConversationCache {
  readonly processVersion: string;

  readonly writtenSessions = new Set<string>();

  readonly pages = new Map<string, {
    source: TurnSource;
    signature: string;
    turns: ConversationTurn[];
    metadata: ConversationMetadata;
    cursor: string | null;
    abandoned?: { count: number; branches: number; summary: string | null };
  }>();

  readonly transcriptRevisions = new Map<string, {
    identity: string;
    size: number;
    changed: string;
    generation: string;
  }>();

  readonly clearScans = new Map<string, {
    id: string;
    scanned: number;
    floor: number;
    tail: string;
    settings: Record<string, { offset: number; end: number; line: string }>;
  }>();

  readonly pageWindowScans = new Map<string, {
    id: string;
    source: string;
    from: number;
    to: number;
    starts: number[];
  }>();

  readonly liveScans = new Map<string, {
    id: string;
    source: string;
    scanned: number;
    starts: number[];
    tail: string;
    chain: { parent: string | null; answered: boolean };
  }>();

  readonly settledTurns = new Map<string, {
    source: TurnSource;
    id: string;
    start: number;
    end: number;
    turns: ConversationTurn[];
    metadata: ConversationMetadata;
    tail: string;
    taskTitles: Map<string, string>;
    noticed: Set<string>;
    inherited: Map<string, string>;
    observedEnd: number;
  }>();

  readonly codexTurns = new Map<string, {
    id: string;
    start: number;
    scanned: number;
    boundary: string;
    parser: { write(text: string): void; snapshot(tail: string): ConversationTurn[] };
    metadata: ConversationMetadata;
  }>();

  readonly paneReads = new Map<string, {
    paths: Set<string>;
    sessions: Set<string>;
    devin: Map<string, { sessionId: string; cwd: string; dbPath?: string }>;
  }>();

  constructor(processVersion?: string) {
    this.processVersion = processVersion ?? randomUUID();
  }
}
