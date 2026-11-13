/**
 * Full-text search across the chats on this PC, for the command palette.
 *
 * The palette answers as the user types, so a request normally reads the newest page of each
 * chat (server/pane-routes.ts's /api/pane/conversation): its parse is cached by file and signature
 * in conversation.ts, and a search therefore costs one herdr read per pane, not a transcript scan
 * per keystroke. A deeper request, sent once typing pauses, walks the pages before it newest
 * first until each pane's share is found or the page limit is reached, so a turn from days ago
 * can still answer. The page limit keeps that walk bounded on a very long session. The walk opens
 * one reader per pane rather than resolving that pane's transcript for every page, and the reader
 * keeps the transcript stream it resolved, so the pages share that one read.
 */
import type { ConversationSearchMatch, ConversationSearchResponse, ConversationTurn, HerdrPane } from "../shared/protocol.ts";
import type { TranscriptSources } from "./conversation-shared.ts";
import { openPaneConversation } from "./conversation.ts";

/** Characters kept around a match, before it and after it. */
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 140;
/** Panes one search reads, and matches one pane may add: a busy box still answers quickly. */
export const SEARCH_PANE_LIMIT = 32;
export const SEARCH_PER_PANE = 2;
/** Pages one request may read per pane, the newest page counted as page 0. */
export const MAX_SEARCH_PAGES = 50;

/**
 * The prose of one turn: what the user or the agent wrote. Tool calls, reasoning and images stay
 * out, so a search finds the conversation rather than a command's output.
 */
export function turnProse(turn: ConversationTurn): string {
  const lines: string[] = [];
  for (const part of turn.parts) {
    if (part.kind === "text" || part.kind === "compact" || part.kind === "notice") lines.push(part.text);
  }
  return lines.join("\n");
}

/** One line of the turn around a match, flattened to single spaces and cut with … at each end. */
export function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  const flat = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${flat}${end < text.length ? "…" : ""}`;
}

/** The turn's match for `query` (case-insensitive), or null when its prose does not hold it. */
export function turnMatch(turn: ConversationTurn, query: string, paneId: string, turnIndex: number, page = 0): ConversationSearchMatch | null {
  const prose = turnProse(turn);
  if (prose === "") return null;
  const at = prose.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  return { pane_id: paneId, page, turn: turnIndex, role: turn.role, ts: turn.ts, snippet: snippetAround(prose, at, query.length) };
}

/** A page's matches, newest turn first, one per turn. */
export function searchTurns(turns: readonly ConversationTurn[], query: string, paneId: string, limit: number, page = 0): ConversationSearchMatch[] {
  const found: ConversationSearchMatch[] = [];
  for (let index = turns.length - 1; index >= 0 && found.length < limit; index -= 1) {
    const match = turnMatch(turns[index]!, query, paneId, index, page);
    if (match !== null) found.push(match);
  }
  return found;
}

type Page = { turns: readonly ConversationTurn[]; cursor?: string | null };
type ReadPage = (paneId: string, before?: string) => Promise<Page>;
/** One pane's pages: opened once, then read newest first and backwards. */
type PageReader = (before?: string) => Promise<Page>;

/** What one search's walk cost, for the server's timing line. */
export interface ConversationSearchTiming {
  /** pages actually read, across every pane, not the page limit asked for */
  pages: number;
  /** panes with an agent that the search read */
  panes: number;
  /** wall time from opening the readers through the last page */
  elapsedMs: number;
}

/**
 * One pane's matches: its newest page first, then the pages before it until its share is found.
 * A page the walk can no longer read (the transcript changed under it) ends the walk; the pages
 * already read still stand, and only a first page that fails makes the pane unavailable.
 */
async function searchPane(read: ReadPage, paneId: string, query: string, pages: number, signal?: AbortSignal): Promise<{ matches: ConversationSearchMatch[]; pages: number }> {
  const found: ConversationSearchMatch[] = [];
  let readPages = 0;
  let before: string | undefined;
  for (let page = 0; page < pages && found.length < SEARCH_PER_PANE; page += 1) {
    if (signal?.aborted) break;
    let answer: Page;
    try {
      answer = await read(paneId, before);
    } catch (error) {
      if (page === 0) throw error;
      break;
    }
    readPages += 1;
    found.push(...searchTurns(answer.turns, query, paneId, SEARCH_PER_PANE - found.length, page));
    const cursor = answer.cursor;
    if (cursor === null || cursor === undefined || cursor === before) break;
    before = cursor;
  }
  return { matches: found, pages: readPages };
}

function pageCount(pages: number | undefined): number {
  return pages === undefined || !Number.isFinite(pages) ? 1 : Math.min(MAX_SEARCH_PAGES, Math.max(1, Math.trunc(pages)));
}

/**
 * Every chat pane on this PC that holds the query. A pane whose conversation cannot be read (no
 * session yet, an agent that writes none) adds to `unavailable` rather than failing the search, and
 * one pane's answer never blocks another's.
 */
export async function searchConversations(input: {
  panes: readonly HerdrPane[];
  query: string;
  limit: number;
  /** pages per pane, the newest counted as page 0; 1 reads the newest page alone */
  pages?: number;
  /** the request's abort signal: a keystroke that superseded this search stops its walk */
  signal?: AbortSignal;
  stores?: TranscriptSources;
  /** the page reader; tests pass their own so the search is checked without herdr */
  read?: ReadPage;
  /** opens a pane's reader; tests pass their own to count how often a pane's transcript is opened */
  open?: (paneId: string) => Promise<PageReader>;
  /** receives what the walk cost when it finishes; the server's timing line logs it */
  onTiming?: (timing: ConversationSearchTiming) => void;
}): Promise<ConversationSearchResponse> {
  const started = performance.now();
  const stores = input.stores ?? {};
  const open = input.open ?? (async (paneId: string) => {
    const reader = await openPaneConversation(paneId, stores);
    return (before?: string) => reader.read(before === undefined ? {} : { before });
  });
  // A pane's transcript is opened on its first page and shared by every page after it.
  const readers = new Map<string, Promise<PageReader>>();
  const read = input.read ?? ((paneId: string, before?: string) => {
    let pending = readers.get(paneId);
    if (pending === undefined) {
      pending = open(paneId);
      readers.set(paneId, pending);
    }
    return pending.then((reader) => reader(before));
  });
  const pages = pageCount(input.pages);
  const panes = input.panes.filter((pane) => (pane.agent ?? "") !== "").slice(0, SEARCH_PANE_LIMIT);
  const answers = await Promise.all(panes.map(async (pane): Promise<{ matches: ConversationSearchMatch[]; pages: number; unavailable: number }> => {
    try {
      const answer = await searchPane(read, pane.pane_id, input.query, pages, input.signal);
      return { matches: answer.matches, pages: answer.pages, unavailable: 0 };
    } catch {
      return { matches: [], pages: 0, unavailable: 1 };
    }
  }));
  const matches = answers.flatMap((answer) => answer.matches);
  const unavailable = answers.reduce((count, answer) => count + answer.unavailable, 0);
  input.onTiming?.({ pages: answers.reduce((count, answer) => count + answer.pages, 0), panes: answers.length, elapsedMs: Math.round(performance.now() - started) });
  // newest first; a turn without a timestamp goes after the dated ones rather than ahead of them
  matches.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
  return { matches: matches.slice(0, Math.max(0, input.limit)), unavailable };
}
