/**
 * The source-agnostic transcript reader: stream assembly, windowing and the page
 * assembly every file-backed conversation source pages through.
 *
 * Nothing here knows a store of its own. The per-source specifics arrive from the
 * caller: the byte segments and the chain suffix that make a stream's `history_id`
 * (`StreamSpec`), the parser that turns a page's text into turns (`ParseTurns`), and
 * the details that stay with the provider module that owns them (`PageSource`:
 * codex's metadata head and stateful live turn, pi's abandoned branches). The module
 * imports no provider and no `conversation.ts`, so a provider can implement `page`
 * through it without a cycle (server/conventions.test.ts enforces both edges).
 */

import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

import type { ConversationMetadata, ConversationTurn } from "../shared/protocol.ts";
import { PI_PAGE_CACHE_BYTES } from "./conversation-cache.ts";
import { answerVersion, conversationCache, ConversationUnavailable, HistoryChanged, TRANSCRIPT_WINDOW_BYTES, type ConversationPage, type RecognizedConversation, type StreamSource, type TranscriptStream, type TranscriptStreamReuse, type TurnSource } from "./conversation-shared.ts";
import { parseConversationMetadata } from "./conversation-metadata.ts";
import { withinRetentionBudget } from "./retention-budget.ts";
import { claudeCommandEcho } from "./skill-invocations/claude.ts";
import { claudePeerNotice, isContextClear, MAX_TURNS, piMessage } from "./transcript-records.ts";

/** A page never holds more prompts than this (each opens a user + assistant pair). */
const MAX_PAGE_PROMPTS = MAX_TURNS / 2;

/** A single turn longer than a window still gets a page of its own, up to this. */
const MAX_PAGE_BYTES = 4 * TRANSCRIPT_WINDOW_BYTES;

/** Settings recorded once at the start (an omp thinking level) sit before a tail window. */
export const METADATA_HEAD_BYTES = 64 * 1024;

/** What a file's identity is made of: the same fields a stream reuse compares. */
export interface StreamStat { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }

/** What one source's stream is made of: its byte ranges, its chain suffix and its prompt starts. */
export interface StreamSpec {
  segments: { path: string; start: number; end: number }[];
  /** the suffix that names the chain (earlier rollouts, a pi branch) and refuses another chain's cursors */
  chain: string;
  promptStarts?: number[];
}

/** A parsed JSONL line's message shape (only the fields we read). */
export interface TranscriptEntry {
  type?: string;
  subtype?: string;
  operation?: string;
  /** a `system` entry's own text; a message's is under `message` */
  content?: unknown;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  /** "updates": Claude Code shows the entry's thinking text as a progress message, not as reasoning */
  thinkingDisplay?: unknown;
  message?: { role?: string; content?: unknown; stop_reason?: unknown };
  attachment?: { type?: unknown; prompt?: unknown; commandMode?: unknown; origin?: { kind?: unknown } };
}

/** How a source turns one page's text into turns (the hub's parseTurns). */
export type ParseTurns = (source: StreamSource, path: string, text: string, taskTitles?: Map<string, string>, noticed?: Set<string>) => ConversationTurn[];

/**
 * The per-source details a provider module owns: they cannot move into this reader
 * without importing that provider, so the caller supplies them per page.
 */
export interface PageSource {
  /** codex: the model and effort settings of the live rollout (settings recorded in its own head). */
  head?(path: string): string;
  /** codex: the live turn, from the provider's stateful parser. */
  live?(path: string, stream: TranscriptStream, start: number, before: ConversationMetadata): { turns: ConversationTurn[]; metadata: ConversationMetadata };
  /** pi: the turns outside the active branch, on paths a `/tree` walked away from. */
  abandoned?(path: string, size: number): RecognizedConversation["abandoned"];
}

/** What a source's own reader must supply: a page of its kind cannot be built without it. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new TypeError(`the transcript reader needs ${what}`);
  return value;
}

// In-place rewrites keep the inode. Change the cursor generation when observed,
// invalidating settled turns and incremental parsers as well as the response cache.
function transcriptGeneration(path: string, stat: StreamStat): string {
  const identity = `${stat.dev}:${stat.ino}`;
  const changed = `${stat.mtimeMs}:${stat.ctimeMs}`;
  const previous = conversationCache.transcriptRevisions.get(path);
  const rewritten = previous && previous.identity === identity && (stat.size < previous.size || (stat.size === previous.size && changed !== previous.changed));
  const generation = rewritten ? randomUUID() : previous?.identity === identity ? previous.generation : "";
  remember(conversationCache.transcriptRevisions, path, { identity, size: stat.size, changed, generation }, 64);
  return generation ? `-${generation}` : "";
}

/**
 * The byte ranges a stream concatenates, in order: the caller computes the chain
 * suffix from these (a pi branch's layout, codex's rollouts before the live one).
 */
export function streamFiles(segments: StreamSpec["segments"], path: string, stat: StreamStat): TranscriptStream["files"] {
  const files: TranscriptStream["files"] = [];
  let stream = 0;
  for (const segment of segments) {
    // the live file is read to the size it had when it was identified
    const end = segment.path === path ? Math.min(segment.end, stat.size) : segment.end;
    const length = end - segment.start;
    if (length <= 0) continue;
    files.push({ path: segment.path, start: stream, length, offset: segment.start });
    stream += length;
  }
  return files;
}

/**
 * One source's stream: its files, length and identity. `source` names the store the
 * stream is read as; the ranges and the chain are the caller's, so this module needs
 * no provider to build one.
 */
export function buildStream(source: StreamSource, path: string, stat: StreamStat, spec: StreamSpec, fd?: number): TranscriptStream {
  const files = streamFiles(spec.segments, path, stat);
  const length = files.reduce((sum, file) => sum + file.length, 0);
  // Positions count from the start of the whole chain: a cursor names the live file AND
  // the rollouts before it, so one read against another chain (an earlier rollout found
  // later, a parent since archived) answers 409 instead of pointing at other turns.
  // A pi branch is laid out from one file, so its layout stands in for that chain: /tree
  // moves the conversation to other bytes while the file, its inode and its size all stay
  // put. Every range counts by where it starts, and by where it ends too except the last:
  // the last one grows with every append, and history_id must stay stable across appends.
  // Two /tree moves away from the same entry share their head ranges and differ only
  // where their tails begin, so the last range's start is what tells them apart.
  return { id: `${stat.dev.toString(36)}-${stat.ino.toString(36)}${spec.chain}${transcriptGeneration(path, stat)}`, files, length, floor: 0, promptStarts: spec.promptStarts, fd };
}

/**
 * The stream of a file that has not changed since the last page of the same walk:
 * identical dev/ino/size/mtimeMs/ctimeMs reuses it (and the reset boundary it already
 * has), anything else builds it again. A source whose chain cannot be walked throws
 * its own reason; an unreadable file has one answer.
 */
export function resolveStream(reuse: TranscriptStreamReuse | undefined, source: StreamSource, path: string, stat: StreamStat, spec: StreamSpec, fd?: number): TranscriptStream {
  try {
    const kept = reuse?.source === source && reuse.path === path && reuse.stream !== undefined
      && reuse.stat?.dev === stat.dev && reuse.stat.ino === stat.ino && reuse.stat.size === stat.size
      && reuse.stat.mtimeMs === stat.mtimeMs && reuse.stat.ctimeMs === stat.ctimeMs ? reuse.stream : null;
    if (kept !== null) return kept;
    const stream = buildStream(source, path, stat, spec, fd);
    applyHistoryBoundary(path, stream, source);
    if (reuse !== undefined) Object.assign(reuse, { source, path, stat, stream });
    return stream;
  } catch (error) {
    // a branch that cannot be walked says so; a file that went unreadable mid-read has
    // one answer, and an unreadable branch has its own
    if (error instanceof ConversationUnavailable) throw error;
    throw new ConversationUnavailable("transcript_missing");
  }
}

/** The bytes of a stream's `[from, to)` range, across its files. */
export function readStream(stream: TranscriptStream, from: number, to: number): Buffer {
  const chunks: Buffer[] = [];
  for (const file of stream.files) {
    const low = Math.max(from, file.start);
    const high = Math.min(to, file.start + file.length);
    if (low >= high) continue;
    const fd = stream.fd ?? openSync(file.path, "r");
    try {
      const buffer = Buffer.alloc(high - low);
      chunks.push(buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, file.offset + (low - file.start))));
    } finally {
      if (stream.fd === undefined) closeSync(fd);
    }
  }
  return Buffer.concat(chunks);
}

/** Reset markers are small native control records. Scan each appended byte once,
 * in bounded chunks; retain offsets, never a session-sized string.
 * The same pass keeps an omp-family transcript's latest model and thinking-level
 * records (small lines): a change between the metadata head and the newest page
 * is otherwise never read, and the chat showed the level the session started at. */
const SETTING_TYPES = ['"model_change"', '"thinking_level_change"'];
function applyHistoryBoundary(path: string, stream: TranscriptStream, source: StreamSource): void {
  if (source === "codex-transcript" || source === "grok-transcript" || source === "agy-transcript") return;
  let scan = conversationCache.clearScans.get(path);
  if (!scan || scan.id !== stream.id || scan.scanned > stream.length || bytesBefore(stream, scan.scanned) !== scan.tail) {
    scan = { id: stream.id, scanned: 0, floor: 0, tail: "", settings: {} };
  }
  let position = scan.scanned;
  let carry = Buffer.alloc(0);
  let skipping = false;
  const isClear = (line: Buffer): boolean => {
    if (!line.includes(source === "claude-transcript" ? "/clear" : "context_clear")) return false;
    try { return isContextClear(JSON.parse(line.toString("utf8")), source); } catch { return false; }
  };
  while (position < stream.length) {
    const end = Math.min(stream.length, position + TRANSCRIPT_WINDOW_BYTES);
    const bytes = Buffer.concat([carry, readStream(stream, position, end)]);
    const base = position - carry.length;
    let offset = 0;
    for (let newline = bytes.indexOf(0x0a); newline !== -1; newline = bytes.indexOf(0x0a, offset)) {
      const line = bytes.subarray(offset, newline);
      if (!skipping && isClear(line)) scan.floor = base + offset;
      else if (!skipping && source !== "claude-transcript" && SETTING_TYPES.some((type) => line.includes(type))) {
        try {
          const type: unknown = JSON.parse(line.toString("utf8"))?.type;
          if (type === "model_change" || type === "thinking_level_change") scan.settings[type] = { offset: base + offset, end: base + newline, line: line.toString("utf8") };
        } catch { /* not a record */ }
      }
      skipping = false;
      offset = newline + 1;
      scan.scanned = base + offset;
    }
    carry = bytes.subarray(offset);
    // An oversized data record cannot be a native clear control envelope.
    if (carry.length > METADATA_HEAD_BYTES) { carry = Buffer.alloc(0); skipping = true; }
    position = end;
  }
  scan.tail = bytesBefore(stream, scan.scanned);
  remember(conversationCache.clearScans, path, scan, 32);
  // A valid final JSON object is visible before its newline; rescan it on append.
  stream.floor = !skipping && carry.length > 0 && isClear(carry) ? stream.length - carry.length : scan.floor;
  if (stream.floor > 0) stream.id += `-clear-${stream.floor.toString(36)}`;
}

/** Slash-command and bookkeeping entries Claude logs as user turns — not conversations. */
export function isCommandEntry(text: string): boolean {
  if (claudeCommandEcho(text)) return false;
  return text.startsWith("<command-") || text.startsWith("<local-command") || text.startsWith("<task-");
}

/** Bytes that every line opening a turn contains: a cheap filter before JSON.parse. */
/** the mark of another session's message in a Claude record, in either of its forms (claudePeerNotice) */
const PEER_MARK = Buffer.from('"kind":"peer"');
const TURN_MARK: Record<StreamSource, Buffer> = {
  "grok-transcript": Buffer.from('"user_message_chunk"'),
  "agy-transcript": Buffer.from('"USER_INPUT"'),
  "codex-transcript": Buffer.from('"task_started"'),
  "claude-transcript": Buffer.from('"user"'),
  "omp-transcript": Buffer.from('"user"'),
  "omo-transcript": Buffer.from('"user"'),
  "gjc-transcript": Buffer.from('"user"'),
  "pi-transcript": Buffer.from('"user"'),
};

/**
 * Does this line open a turn? Pages start at such lines, so a page never splits
 * a turn: a Codex task (its prompt, duplicate records and tool calls all follow
 * task_started), a Claude or omp prompt (tool results answer the turn before it),
 * and the same for pi, whose prompts are `message` records with a user role.
 */
function opensTurn(source: StreamSource, line: string): boolean {
  let entry: { type?: unknown; isMeta?: unknown; isCompactSummary?: unknown; payload?: { type?: unknown }; message?: { role?: unknown; content?: unknown } };
  try { entry = JSON.parse(line); } catch { return false; }
  if (entry === null || typeof entry !== "object") return false;
  if (source === "codex-transcript") return entry.type === "event_msg" && entry.payload?.type === "task_started";
  if (source !== "claude-transcript") {
    const message = piMessage(entry);
    return message?.role === "user" && (message.content as Record<string, unknown>[]).some((part) => part.type === "text" && typeof part.text === "string" && part.text.length > 0);
  }
  // another session's message opens a turn in either of its forms, the meta entry and the queued attachment
  if (claudePeerNotice(entry) !== null) return true;
  if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary) return false;
  const content = entry.message?.content;
  if (typeof content === "string") return !isCommandEntry(content);
  return Array.isArray(content) && content.some((block: { type?: unknown; text?: unknown } | null) =>
    block?.type === "text" && typeof block.text === "string" && !isCommandEntry(block.text.trim()));
}

/**
 * Where the last turn-opening Claude prompt hangs, and whether an assistant entry has
 * answered it since. A prompt Claude Code cancelled before any reply is written again as
 * the re-send's sibling (same parentUuid): it continues the cancelled prompt's turn rather
 * than opening a new one, so the cancelled record never settles into a page that reparses
 * without it — the same sibling rule parseClaudeTranscript applies to the bytes.
 */
interface PromptChain { parent: string | null; answered: boolean }

function turnStarts(bytes: Buffer, source: StreamSource, chain: PromptChain = { parent: null, answered: true }): number[] {
  const starts: number[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline;
    const line = bytes.subarray(offset, end);
    if (source === "claude-transcript" && line.includes('"type":"assistant"')) chain.answered = true;
    // a queued attachment carrying another session's message has no "user" in it: its own mark
    const candidate = line.includes(TURN_MARK[source]) || (source === "claude-transcript" && line.includes(PEER_MARK));
    if (candidate && opensTurn(source, line.toString("utf8"))) {
      if (source === "claude-transcript") {
        let parent: string | null = null;
        let peer = false;
        try {
          const entry = JSON.parse(line.toString("utf8")) as TranscriptEntry | null;
          const uuid: unknown = entry?.parentUuid;
          parent = typeof uuid === "string" ? uuid : null;
          peer = claudePeerNotice(entry) !== null;
        } catch { /* opensTurn already read the line as JSON */ }
        // another session's message is never a re-send of this session's prompt: it opens a turn and
        // leaves the prompt chain as it was, so the human re-send rule below still sees its own prompts
        if (peer) { starts.push(offset); offset = end + 1; continue; }
        // a re-send of an unanswered prompt opens no turn of its own
        if (chain.answered || parent === null || parent !== chain.parent) starts.push(offset);
        chain.parent = parent;
        chain.answered = false;
      } else {
        starts.push(offset);
      }
    }
    offset = end + 1;
  }
  return starts;
}

/**
 * The turn starts of one page window, reused by the page before it. Walking backwards slides the
 * window left by one page's bytes, so the next window mostly lies inside this one: its starts are
 * already found, and only the part reaching past this window is scanned, not another 16 MB. The
 * starts are the unparsed lines a page can begin on, so the same bytes still parse once, when the
 * page that needs them is read.
 */
const WINDOW_LINE_LOOKBACK = 4096;

/**
 * The start of the line that holds `from`, so a cached window never begins inside one: a line
 * split by the window's left edge is read as the fragment it is and never counted as a turn
 * start, which would drop that turn from a later page. A line longer than the lookback has no
 * start inside it, and its window is simply not cached.
 */
function windowLineStart(stream: TranscriptStream, from: number, floor: number): number | null {
  if (from <= floor) return from;
  const back = Math.min(WINDOW_LINE_LOOKBACK, from - floor);
  const newline = readStream(stream, from - back, from).lastIndexOf(0x0a);
  return newline === -1 ? null : from - back + newline + 1;
}

function pageWindowStarts(stream: TranscriptStream, source: StreamSource, path: string, from: number, to: number): { starts: number[]; bytes: Buffer | null } {
  if (stream.promptStarts) return { starts: stream.promptStarts.filter((at) => at >= from && at < to), bytes: null };
  // a Claude prompt chain depends on the bytes before the window; a cached window carries the
  // chain its own start began with, so a page boundary could read a re-send differently: no cache
  if (source === "claude-transcript") {
    const bytes = readStream(stream, from, to);
    return { starts: turnStarts(bytes, source).map((at) => from + at), bytes };
  }
  const keep = (starts: number[], aligned: number) => remember(conversationCache.pageWindowScans, path, { id: stream.id, source, from: aligned, to, starts }, 8);
  const cached = conversationCache.pageWindowScans.get(path);
  if (cached !== undefined && cached.id === stream.id && cached.source === source && cached.to >= to) {
    // the window lies inside the cached one, as a backward walk's does: no bytes to read or scan
    if (cached.from <= from) return { starts: cached.starts.filter((at) => at >= from && at < to), bytes: null };
    // the window reaches left of it: scan only the exposed prefix, which ends on a line start
    const aligned = windowLineStart(stream, from, stream.floor);
    if (aligned !== null) {
      const prefix = readStream(stream, aligned, cached.from);
      const starts = [...turnStarts(prefix, source).map((at) => aligned + at), ...cached.starts.filter((at) => at >= cached.from)];
      keep(starts, aligned);
      return { starts: starts.filter((at) => at >= from), bytes: null };
    }
  }
  const aligned = windowLineStart(stream, from, stream.floor);
  if (aligned === null) return { starts: turnStarts(readStream(stream, from, to), source).map((at) => from + at), bytes: null };
  const bytes = readStream(stream, aligned, to);
  const starts = turnStarts(bytes, source).map((at) => aligned + at);
  keep(starts, aligned);
  return { starts: starts.filter((at) => at >= from), bytes: aligned === from ? bytes : bytes.subarray(from - aligned) };
}

/**
 * The page of turns ending at `to`: at most MAX_PAGE_PROMPTS prompts, starting on a
 * line that opens a turn, at `floor` (a held start) or at the very beginning. An
 * older page is read once, so for a turn longer than a window it reaches further
 * back, a new chunk at a time, up to MAX_PAGE_BYTES. The newest page is read on
 * every append, so it never does: with no turn start in its window it starts
 * mid-turn, at a whole line.
 */
function pageBefore(stream: TranscriptStream, source: StreamSource, path: string, to: number, { floor = stream.floor, widen }: { floor?: number; widen: boolean }): { start: number; bytes: Buffer } {
  let from = Math.max(floor, to - TRANSCRIPT_WINDOW_BYTES);
  let bytes: Buffer | null = null;
  for (;;) {
    let starts: number[];
    if (bytes === null) {
      const scan = pageWindowStarts(stream, source, path, from, to);
      starts = scan.starts;
      bytes = scan.bytes;
    } else {
      // a widened window begins on a whole line only if it happens to: its starts are not kept
      starts = turnStarts(bytes, source).map((at) => from + at);
    }
    const start = starts.length > MAX_PAGE_PROMPTS ? starts[starts.length - MAX_PAGE_PROMPTS] : from === floor ? from : starts[0];
    if (start !== undefined) return { start, bytes: bytes === null ? readStream(stream, start, to) : bytes.subarray(start - from) };
    const window = bytes ?? readStream(stream, from, to);
    if (!widen || to - from >= MAX_PAGE_BYTES) {
      const firstLine = window.indexOf(0x0a) + 1;
      return { start: from + firstLine, bytes: window.subarray(firstLine) };
    }
    const next = Math.max(floor, from - TRANSCRIPT_WINDOW_BYTES);
    bytes = Buffer.concat([readStream(stream, next, from), window]);
    from = next;
  }
}

/**
 * The newest page is read again after each transcript change while an agent works (at most
 * every 2 s per chat), and between reads its file only grows. Rescanning its whole window
 * (16 MB on a long session) and reparsing the page each time held the event loop 50-110 ms
 * per read, so per live file:
 * - the turn starts found so far are kept, and only the bytes appended since are scanned;
 * - the turns before the page's last turn start are kept (a later append cannot change a
 *   turn that another has followed), and only the last turn is parsed again.
 */

interface SettledTurns {
  source: TurnSource;
  id: string;
  /** the page start these turns begin at, and the turn start they end at */
  start: number;
  end: number;
  turns: ConversationTurn[];
  metadata: ConversationMetadata;
  /** the bytes just before `end` (see LiveScan.tail) */
  tail: string;
  /** what OmO's `task` calls on the page called their tasks: a task can end in a later turn than the one that started it */
  taskTitles: Map<string, string>;
  /** Claude completion identities in this page's settled prefix only; never inherited from another page. */
  noticed: Set<string>;
  /** the titles it began with, from the pages before it */
  inherited: Map<string, string>;
  /** End of the live turn the last poll actually read; replay never scans unseen skipped history. */
  observedEnd: number;
}

/** The bytes just before `offset`, enough to prove a kept scan still starts where it did. */
export function bytesBefore(stream: TranscriptStream, offset: number): string {
  return readStream(stream, Math.max(0, offset - 64), offset).toString("latin1");
}

/** Keep a map bounded, most-recent last: one entry per file is what a page reader needs. */
export function remember<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value!);
}

/** Pi retains at most four small parsed pages per cache; oversized pages remain readable uncached. */
function rememberPage<T extends { source: RecognizedConversation["source"] }>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.delete(key);
  if (value.source === "pi-transcript" && !withinRetentionBudget(value, PI_PAGE_CACHE_BYTES)) return;
  remember(map, key, value, limit);
  const piKeys = [...map].filter(([, item]) => item.source === "pi-transcript").map(([key]) => key);
  while (piKeys.length > 4) map.delete(piKeys.shift()!);
}

/** The newest page's start and every turn start in it (pageBefore without widening), or null when it starts mid-turn. */
function newestPage(path: string, stream: TranscriptStream, source: StreamSource): { start: number; starts: number[] } | null {
  const from = Math.max(stream.floor, stream.length - TRANSCRIPT_WINDOW_BYTES);
  if (stream.promptStarts) {
    const starts = stream.promptStarts.filter((at) => at >= from);
    const start = starts.length > MAX_PAGE_PROMPTS ? starts[starts.length - MAX_PAGE_PROMPTS] : from === stream.floor ? stream.floor : starts[0];
    return start === undefined ? null : { start, starts };
  }
  let scan = conversationCache.liveScans.get(path);
  // a window that slid past the scanned bytes starts over at its edge (a line may be cut
  // there, as in pageBefore, and never counts as a start)
  if (!scan || scan.id !== stream.id || scan.source !== source || scan.scanned > stream.length || scan.scanned < from
    || bytesBefore(stream, scan.scanned) !== scan.tail) {
    scan = { id: stream.id, source, scanned: from, starts: [], tail: bytesBefore(stream, from), chain: { parent: null, answered: true } };
  }
  let pending: number[] = [];
  if (scan.scanned < stream.length) {
    const bytes = readStream(stream, scan.scanned, stream.length);
    const complete = bytes.lastIndexOf(0x0a) + 1;
    for (const offset of turnStarts(bytes.subarray(0, complete), source, scan.chain)) scan.starts.push(scan.scanned + offset);
    // a last line still without its newline counts now, and is scanned again once
    // complete, so it is scanned on a copy that leaves the kept chain untouched
    pending = turnStarts(bytes.subarray(complete), source, { ...scan.chain }).map((offset) => scan!.scanned + complete + offset);
    scan.scanned += complete;
    scan.tail = bytesBefore(stream, scan.scanned);
  }
  const stale = scan.starts.findIndex((offset) => offset >= from);
  if (stale !== 0) scan.starts.splice(0, stale === -1 ? scan.starts.length : stale);
  remember(conversationCache.liveScans, path, scan, 32);
  const starts = pending.length > 0 ? [...scan.starts, ...pending] : scan.starts;
  const start = starts.length > MAX_PAGE_PROMPTS ? starts[starts.length - MAX_PAGE_PROMPTS] : from === stream.floor ? stream.floor : starts[0];
  return start === undefined ? null : { start, starts };
}

/** Codex settings belong to the live rollout; native clears bound other stores. A model or
 * thinking-level change after the head and before the page follows the head, in order. */
function metadataHead(path: string, stream: TranscriptStream, source: StreamSource, start: number, head?: PageSource["head"]): string {
  if (source === "codex-transcript") return required(head, "codex's own metadata head")(path);
  const end = Math.min(start, stream.floor + METADATA_HEAD_BYTES);
  const later = Object.values(conversationCache.clearScans.get(path)?.settings ?? {})
    // a record the head cuts in two is read whole here
    .filter((setting) => setting.end > end && setting.offset < start)
    .sort((a, b) => a.offset - b.offset)
    .map((setting) => setting.line);
  return [readStream(stream, stream.floor, end).toString("utf8"), ...later].join("\n");
}

/**
 * The newest page's turns from `start`: the settled ones (before the last turn start)
 * from memory, extended by any turn that has since been followed, plus the live last turn.
 */
function liveTurns(path: string, stream: TranscriptStream, source: StreamSource, start: number, starts: number[], parse: ParseTurns, hooks?: PageSource): { turns: ConversationTurn[]; metadata: ConversationMetadata } {
  // starts ascend: the last one, when it lies past the page start
  const last = Math.max(start, starts[starts.length - 1] ?? start);
  const key = `${path}\0${start}`;
  let settled = conversationCache.settledTurns.get(key);
  if (!settled || settled.id !== stream.id || settled.end > last || bytesBefore(stream, settled.end) !== settled.tail) {
    const head = start > stream.floor ? metadataHead(path, stream, source, start, hooks?.head) : "";
    // a page that starts past the turn that started a task keeps the title that turn gave it,
    // as long as this stream was watched while the title was on a page (a cold read cannot).
    // Only this file's pages count: another file can come to have its inode once it is gone.
    let kept: SettledTurns | undefined;
    for (const [other, page] of conversationCache.settledTurns) {
      if (other.startsWith(`${path}\0`) && page.id === stream.id && page.start < start && page.start > (kept?.start ?? -1)) kept = page;
    }
    const inherited = new Map(kept === undefined ? [] : kept.end <= start ? kept.taskTitles : kept.inherited);
    // Replay the overlap, or the previously seen live turn when many prompts arrived between
    // polls. Only bytes already observed are needed, even if the file grew by gigabytes since.
    if (kept !== undefined) {
      const from = kept.end <= start ? kept.end : kept.start;
      const to = Math.min(start, kept.observedEnd);
      if (to > from) parse(source, path, readStream(stream, from, to).toString("utf8"), inherited);
    }
    settled = { source, id: stream.id, start, end: start, turns: [], metadata: parseConversationMetadata(`${head}
`, source), tail: bytesBefore(stream, start), taskTitles: new Map(inherited), noticed: new Set(), inherited, observedEnd: stream.length };
  }
  if (settled.end < last) {
    const text = readStream(stream, settled.end, last).toString("utf8");
    settled = { ...settled, end: last, turns: [...settled.turns, ...parse(source, path, text, settled.taskTitles, settled.noticed)], metadata: parseConversationMetadata(text, source, settled.metadata), tail: bytesBefore(stream, last) };
  }
  settled.observedEnd = stream.length;
  rememberPage(conversationCache.settledTurns, key, settled, 8);
  if (source === "codex-transcript") {
    const live = required(hooks?.live, "codex's own live-turn reader")(path, stream, last, settled.metadata);
    return { turns: [...settled.turns, ...live.turns], metadata: live.metadata };
  }
  const text = readStream(stream, last, stream.length).toString("utf8");
  // the live turn is parsed again on every poll: its titles and completions are kept only
  // once it settles, so a read titles a task exactly as a cold read of the same bytes does
  return { turns: [...settled.turns, ...parse(source, path, text, new Map(settled.taskTitles), new Set(settled.noticed))], metadata: parseConversationMetadata(text, source, settled.metadata) };
}

function formatCursor(stream: TranscriptStream, offset: number): string | null {
  return offset > stream.floor ? `${stream.id}:${offset}` : null;
}

function parseCursor(stream: TranscriptStream, cursor: string): number {
  const separator = cursor.lastIndexOf(":");
  const offset = Number(cursor.slice(separator + 1));
  if (separator <= 0 || cursor.slice(0, separator) !== stream.id || !Number.isSafeInteger(offset) || offset < stream.floor || offset > stream.length) {
    throw new HistoryChanged();
  }
  return offset;
}

/**
 * One page of a resolved transcript (the hub's `transcriptPageRead`): the stream is
 * already built, `parse` turns a page's text into turns, and `hooks` carries the
 * details a provider module owns (codex's head and live turn, pi's abandoned turns).
 */
export function transcriptPage(stream: TranscriptStream, source: StreamSource, path: string, stat: StreamStat, page: ConversationPage, parse: ParseTurns, hooks?: PageSource): RecognizedConversation {
  // an older page never changes while its file and the rollouts before it stay the same
  // (the stream's id names both); the newest one changes with every append
  const key = page.before !== undefined ? `${path}\0before:${page.before}:${page.since ?? ""}` : `${path}\0from:${page.from ?? ""}`;
  const signature = page.before !== undefined ? stream.id : `${stream.id}:${stream.length}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = conversationCache.pages.get(key);
  // the answer is a function of the page asked for and the file's state, so they name it
  const version = answerVersion(key, signature);
  if (cached?.signature === signature) {
    return { source, turns: cached.turns, metadata: cached.metadata, cursor: cached.cursor, abandoned: cached.abandoned, history_id: stream.id, version };
  }

  let start: number;
  let text: string;
  let head = "";
  let cursor: string | null;
  let live: { turns: ConversationTurn[]; metadata: ConversationMetadata } | null = null;
  try {
    if (page.before !== undefined) {
      const before = parseCursor(stream, page.before);
      const floor = page.since === undefined ? stream.floor : parseCursor(stream, page.since);
      if (floor > before) throw new HistoryChanged();
      const older = before === floor ? { start: floor, bytes: Buffer.alloc(0) } : pageBefore(stream, source, path, before, { floor, widen: true });
      start = older.start;
      text = older.bytes.toString("utf8");
    } else {
      const held = page.from === undefined ? null : parseCursor(stream, page.from);
      const newest = newestPage(path, stream, source);
      // A chat that shows older pages holds the start of its newest turns and keeps
      // every turn after it while they are inside the newest page. Once the newest
      // page has moved past it, the chat gets the newest page and fetches the turns
      // in between with `before` + `since`: no poll reads more than a page.
      if (newest !== null) {
        start = held !== null && held >= newest.start ? held : newest.start;
        live = liveTurns(path, stream, source, start, newest.starts, parse, hooks);
        text = "";
      } else {
        // no turn starts in the window: the page begins mid-turn, read whole as before
        const whole = pageBefore(stream, source, path, stream.length, { widen: false });
        start = held !== null && held >= whole.start ? held : whole.start;
        text = whole.bytes.subarray(start - whole.start).toString("utf8");
      }
    }
    if (live === null && page.before === undefined && start > stream.floor) head = metadataHead(path, stream, source, start, hooks?.head);
    cursor = formatCursor(stream, start);
  } catch (error) {
    if (error instanceof HistoryChanged) throw error;
    throw new ConversationUnavailable("transcript_missing");
  }

  // the store decides the parser, not the pane's label: omo writes omp's
  // session shape while herdr may be calling that same pane `claude`. The page
  // bounds the turns, so none are cut: they must meet the next page exactly.
  const turns = live?.turns ?? parse(source, path, text);
  const metadata = live?.metadata ?? parseConversationMetadata(`${head}\n${text}`, source);
  // Record the stat from BEFORE the read: an append during parsing must cause
  // another read on the next poll, not permanently cache a torn tail.
  conversationCache.pages.delete(key);
  // the abandoned turns live outside the branch's byte ranges, so the page cannot see them: a
  // straight line answers { count: 0 }, which is most sessions and costs the client nothing
  const abandoned = source === "pi-transcript" ? required(hooks?.abandoned, "pi's abandoned-branch reader")(path, stat.size) ?? undefined : undefined;
  rememberPage(conversationCache.pages, key, { source, signature, turns, metadata, cursor, abandoned }, 32);
  return { source, turns, metadata, cursor, abandoned, history_id: stream.id, version };
}

/** The export name todo 5a prescribes for the page reader: the same single definition, never a second one. */
export const readTranscriptPage = transcriptPage;
