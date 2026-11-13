/**
 * Agent session transcripts -> structured conversation turns.
 *
 * The recognized stores are provider-native and read-only:
 * - Codex: native rollout JSONL, resolved by session metadata/open descriptors
 *   or a unique pane-text match for shared app-server TUIs (codex.ts).
 * - Claude Code: herdr's agent.get names the session id, the transcript lives
 *   at ~/.claude/projects/<project>/<session>.jsonl (claude-store.ts finds it).
 * - omp: herdr's agent.get hands us the session jsonl path outright under
 *   ~/.omp/agent/sessions/<cwd-slug>/, or ~/.omp/profiles/<name>/agent/sessions/<cwd-slug>/
 *   for `omp --profile <name>` — same shape of truth, one less hop. When herdr names none, the
 *   pane's omp process does (omp.ts).
 * - omo: herdr knows nothing about its store and its label for the pane flips
 *   between `pi` and `claude` as omo spawns model CLIs, so the pane's process
 *   tree routes it and process/session evidence selects a unique transcript
 *   under <its agent dir>/sessions/<cwd-slug>/ (~/.omo/agent unless the process
 *   moved it with OMO_CODING_AGENT_DIR). It writes omp's session shape, so
 *   parseOmpTranscript (transcript-records.ts) reads it.
 * - gjc: the public SDK broker binds its live pane process to the exact saved
 *   session transcript (gjc-sdk.ts, gjc-runtime.ts). It writes omp's session shape too.
 * - pi: herdr's agent.get names the session jsonl outright under
 *   ~/.pi/agent/sessions/<cwd-slug>/ (pi.ts). Its records are the session shape
 *   parseOmpTranscript reads, but its file is an entry tree, not a log: /tree
 *   moves the leaf and appends beside the path it left (pi-tree.ts), so the
 *   stream is projected onto the branch the leaf stands on before it is read.
 * - OpenCode: herdr's integration reports the session id, and OpenCode 2 keeps the
 *   session in its own SQLite store (opencode.ts), read by `seq` rather than by
 *   byte offset: its cursors name rows, and it pages and caches on its own.
 *
 * This module turns those files into the conversation the chat lens renders;
 * the pty stays the input path. Pure parsing lives in parseClaudeTranscript /
 * parseOmpTranscript (unit-tested); pane/session/file resolution is
 * integration and lives in paneTranscript.
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import nodePath, { type PlatformPath } from "node:path";

import { PI_PAGE_CACHE_BYTES } from "./conversation-cache.ts";
import { answerVersion, conversationCache, ConversationNotStarted, ConversationUnavailable, HistoryChanged, TRANSCRIPT_WINDOW_BYTES, type ConversationPage, type NativeTranscript, type PaneConversationReader, type RecognizedConversation, type ResolvedTranscript, type StreamSource, type TranscriptStream, type TranscriptStreamReuse } from "./conversation-shared.ts";
import { bytesBefore, isCommandEntry, METADATA_HEAD_BYTES, readStream, readTranscriptPage, remember, resolveStream, streamFiles, type PageSource, type StreamSpec, type StreamStat, type TranscriptEntry } from "./conversation-reader.ts";

export { answerVersion, conversationCache, ConversationNotStarted, ConversationUnavailable, HistoryChanged, TRANSCRIPT_WINDOW_BYTES } from "./conversation-shared.ts";
export type { ConversationPage, NativeTranscript, PaneConversationReader, RecognizedConversation, ResolvedTranscript, StreamSource, TranscriptSources, TranscriptStream, TranscriptStreamReuse, TurnSource } from "./conversation-shared.ts";
export { buildStream, readTranscriptPage, resolveStream, streamFiles } from "./conversation-reader.ts";
export type { PageSource, ParseTurns, StreamSpec, StreamStat } from "./conversation-reader.ts";

import type { ConversationMetadata, ConversationPart, ConversationTurn, HerdrPane, SessionSnapshot } from "../shared/protocol.ts";
import { herdrRpc, paneRead, sessionSnapshot } from "./herdr/client.ts";
import { codexHistorySegments, createCodexTranscriptParser, codexOutputText, codexTranscriptPath, defaultCodexHome, forgetAllCodexState, forgetCodexStateFor, paneCodexHome, parseCodexTranscript, readRange } from "./codex.ts";
import { CODEX_IMAGE_REF, codexTranscriptImage } from "./codex-images.ts";
import { AmbiguousClaudeStore, claudeProcessSession, claudeTranscriptFile, defaultClaudeConfigDir, forgetClaudeSessionFile, forgetClaudeSessions, isClaudeProcess, processClaudeConfigDir } from "./claude-store.ts";
import { forgetGjcState, gjcPidUnderShell, gjcTranscriptForPane, isGjcProcess, storeRelative } from "./gjc-runtime.ts";
import { omoProcessIdentity, omoSessionForPane, processEnviron } from "./omo.ts";
import { processStartedAt } from "./process-start.ts";
import { ompHeldTranscript } from "./omp.ts";
import { forgetOpencodeRead, forgetOpencodeState, OPENCODE_IMAGE_REF, opencodeConversation, opencodeDatabasePath, opencodeImage, opencodeReadKey, opencodeSessionId, opencodeToolOutput } from "./opencode.ts";
import { piTranscriptInStore, piTranscriptPath, unwrittenSession } from "./pi.ts";
import { defaultDevinDbPath, DevinHistoryUnavailable, devinConversation, forgetDevinState } from "./devin.ts";
import { forgetGrokState, grokProjection, grokToolOutput, parseGrokTranscript, GrokUnavailable } from "./grok.ts";
import { resolveGrokStore } from "./grok-store.ts";
import { AgyUnavailable, agyCatalog, agyToolOutput, forgetAgyState, parseAgyTranscript, withAgyHistory, type AgyProjection } from "./agy.ts";
import { resolveAgyStore, sameAgyStore } from "./agy-store.ts";
import { withinRetentionBudget } from "./retention-budget.ts";
import { forgetAllPiIndexes, forgetPiIndex, piAbandonedTurns, piBranchRecords, piBranchSegments } from "./pi-tree.ts";
import { trimOutput } from "./tool-output.ts";
import { parseConversationMetadata } from "./conversation-metadata.ts";
import { forgetHermesTranscriptState, hermesConversationPage, hermesToolOutput, hermesTranscriptForPane } from "./hermes.ts";

import { invokedSkill } from "./skill-activity.ts";
import { claudeCommandEcho } from "./skill-invocations/claude.ts";
import { agentTaskResult, claudePeerId, claudePeerNotice, isContextClear, MAX_TURNS, parseOmpTranscript, piImageBlock, piMessage, piResults, toolSummary } from "./transcript-records.ts";
import { forgetSubagents, lineNotifications, subagentDetails, taskNotification, type SubagentDetail } from "./claude-subagents.ts";
import { launchedAgents } from "./launched-agents.ts";
import { readsStartScreen, startScreenMetadata } from "./start-screen.ts";

export { isOmoProcess } from "./omo.ts";

/** Session ids are uuids; refusing anything else keeps the path traversal-free. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a slash command printed, from the `local_command` entry Claude Code records it in. The
 * command's echo (`<command-name>…`) is a separate entry with no output tag, and reads as nothing.
 */
/** A command's answer is a notice, not a log: the rest of a long one stays in the terminal. */
const LOCAL_COMMAND_MAX_CHARS = 4000;

function localCommandOutput(content: unknown): string {
  if (typeof content !== "string") return "";
  // the whole entry is the output, one stream after another: a tag quoted inside an echo's
  // arguments is not an answer
  const streams: string[] = [];
  let at = 0;
  for (;;) {
    while (at < content.length && /\s/.test(content[at]!)) at++;
    if (at === content.length) break;
    const stream = content.startsWith("<local-command-stdout>", at) ? "stdout" : content.startsWith("<local-command-stderr>", at) ? "stderr" : null;
    if (stream === null) return "";
    const start = at + `<local-command-${stream}>`.length;
    // a closing tag the output prints itself ends nothing: the stream's own one is at the end of
    // the entry or before the next stream. Each candidate looks only at the whitespace after it.
    const close = `</local-command-${stream}>`;
    let end = content.indexOf(close, start);
    let next = 0;
    while (end !== -1) {
      next = end + close.length;
      while (next < content.length && /\s/.test(content[next]!)) next++;
      if (next === content.length || content.startsWith("<local-command-stdout>", next) || content.startsWith("<local-command-stderr>", next)) break;
      end = content.indexOf(close, end + close.length);
    }
    if (end === -1) return "";
    const text = stripTerminalControls(content.slice(start, end)).trim();
    if (text.length > 0) streams.push(text);
    at = next;
  }
  return capNotice(streams.join("\n"));
}

/** Lines of one notice Claude Code writes as separate entries, a moment apart. */
const NOTICE_JOIN_MS = 1000;

/** A notice is not a log: past the cap the rest stays in the terminal, also for lines joined into one. */
function capNotice(text: string): string {
  return text.length > LOCAL_COMMAND_MAX_CHARS ? `${text.slice(0, LOCAL_COMMAND_MAX_CHARS)}\u2026` : text;
}

/** The notice a turn is, when it is nothing else. */
function loneNotice(turn: ConversationTurn | undefined): Extract<ConversationPart, { kind: "notice" }> | null {
  const part = turn?.parts.length === 1 ? turn.parts[0] : undefined;
  return part?.kind === "notice" ? part : null;
}

/** Were these two entries written together? Never when either has no readable time. */
function writtenTogether(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && Math.abs(Date.parse(a) - Date.parse(b)) <= NOTICE_JOIN_MS;
}

/**
 * Claude Code versions differ in where a refused command goes: a `local_command` answer, an
 * `informational` entry, and nothing says one never writes both. The same words from the other
 * kind, written together, are one answer; a notice repeating its own kind is kept.
 */
function saidByOtherKind(turn: ConversationTurn | undefined, text: string, ts: string | null, kind: "local-command" | "informational"): boolean {
  const said = loneNotice(turn);
  if (said === null || said.source === kind || (said.source !== "local-command" && said.source !== "informational")) return false;
  return writtenTogether(turn?.ts, ts) && (said.text === text || said.text.split("\n").includes(text));
}

/**
 * The text of terminal output without its escape codes (colours, links, cursor moves, charset
 * switches) and other controls, in one pass: a sequence cut off by the end swallows the rest,
 * and malformed input never makes it rescan what follows.
 */
function stripTerminalControls(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code !== 0x1b) {
      // tab and newline are text; every other C0 control and DEL is not
      if (code === 0x09 || code === 0x0a || (code >= 0x20 && code !== 0x7f)) out += input[i];
      i++;
      continue;
    }
    const kind = input[i + 1];
    if (kind === "]" || kind === "P" || kind === "X" || kind === "^" || kind === "_") {
      // a string (OSC, DCS, SOS, PM, APC) ends at BEL or ST; another ESC ends it too
      i += 2;
      while (i < input.length && input.charCodeAt(i) !== 0x07 && input.charCodeAt(i) !== 0x1b) i++;
      if (input.charCodeAt(i) === 0x07) i++;
      else if (input[i + 1] === "\\") i += 2;
    } else if (kind === "[") {
      // CSI: parameters, intermediates, one final byte
      i += 2;
      while (i < input.length && input.charCodeAt(i) >= 0x30 && input.charCodeAt(i) <= 0x3f) i++;
      while (i < input.length && input.charCodeAt(i) >= 0x20 && input.charCodeAt(i) <= 0x2f) i++;
      if (i < input.length && input.charCodeAt(i) >= 0x40 && input.charCodeAt(i) <= 0x7e) i++;
    } else {
      // ESC, intermediates (as in ESC ( B), then one final byte
      i++;
      while (i < input.length && input.charCodeAt(i) >= 0x20 && input.charCodeAt(i) <= 0x2f) i++;
      if (i < input.length && input.charCodeAt(i) >= 0x30 && input.charCodeAt(i) <= 0x7e) i++;
    }
  }
  return out;
}

/**
 * Claude Code wraps a long paste in `<pasted_content id="…">` tags so the model can
 * tell it from typed text; its own TUI shows only the text, and so does the chat.
 */
export function unwrapPastes(text: string): string {
  let changed = false;
  const visible = text.replace(/<pasted_content id="([^"\r\n]+)">\r?\n([\s\S]*?)\r?\n<\/pasted_content id="([^"\r\n]+)">/g,
    (whole: string, opening: string, body: string, closing: string) => {
      if (opening !== closing || opening.length > 64 || !/^[\w-]+$/.test(opening)) return whole;
      changed = true;
      return body;
    });
  return changed ? visible.replace(/^\n+|\n+$/g, "") : text;
}

function claudeResultText(output: unknown): string {
  return typeof output === "string" ? output
    : Array.isArray(output) ? output.map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : "")).join("")
      : "";
}

/** The image types a chat shows; anything else stays out of the page. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Splits one transcript file's contents into turns. Adjacent assistant entries
 * merge into a single turn (text parts + tool parts); each tool_use is followed
 * by a user tool_result entry, which is folded into the tool part it answers.
 *
 * A subagent that ended (its `<task-notification>`) is drawn as a task_result in the user's seat,
 * once however many records carry it; `options.subagents` holds what the subagents' own files say
 * of them, by agent id, since the parser reads no files. Other notifications stay hidden.
 */
export function parseClaudeTranscript(text: string, maxTurns = MAX_TURNS, options: { subagents?: ReadonlyMap<string, SubagentDetail>; noticed?: Set<string> } = {}): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  /** tool parts still waiting for their result, by tool_use id */
  const pending = new Map<string, Extract<ConversationPart, { kind: "tool" }>>();
  /** the agent's last entry called a tool: its turn is not over, whatever is written meanwhile */
  let atWork = false;
  /** injected feedback can resume the model without a human prompt after a completed reply */
  let completed = false;
  /** where a notice goes: before the turn at work it was written in, else at the end */
  const noticeAt = (): number => atWork && turns.at(-1)?.role === "assistant" ? turns.length - 1 : turns.length;
  /** the notifications already drawn: a completion is recorded in up to three places */
  const noticed = options.noticed ?? new Set<string>();
  /** True when the block was a notification (shown or not): it is no turn of anyone's typing. */
  const notified = (block: string, ts: string | null): boolean => {
    const notice = taskNotification(block);
    if (notice === null) return false;
    const key = `${notice.taskId}\0${notice.toolUseId ?? ""}`;
    if (notice.agent && !noticed.has(key)) {
      noticed.add(key);
      turns.splice(noticeAt(), 0, { role: "user", ts, parts: [{ kind: "task_result", tasks: [agentTaskResult(notice, options.subagents?.get(notice.taskId))] }] });
    }
    return true;
  };

  const assistantTurn = (ts?: string): ConversationTurn => {
    const last = turns[turns.length - 1];
    if (last !== undefined && last.role === "assistant" && !completed) return last;
    const turn: ConversationTurn = { role: "assistant", ts: ts ?? null, parts: [] };
    turns.push(turn);
    return turn;
  };

  /** the last human prompt and the entry it hangs from: a send Claude Code cancelled before
   *  any reply is re-sent as a sibling of it, and its own screen shows only the re-send */
  let lastPrompt: { turn: ConversationTurn; parent: string | null | undefined; answered: boolean } | null = null;
  const pushPrompt = (turn: ConversationTurn, entry: TranscriptEntry): void => {
    if (lastPrompt !== null && !lastPrompt.answered && typeof entry.parentUuid === "string" && entry.parentUuid === lastPrompt.parent) {
      const index = turns.indexOf(lastPrompt.turn);
      if (index !== -1) turns.splice(index, 1);
    }
    turns.push(turn);
    lastPrompt = { turn, parent: entry.parentUuid, answered: false };
  };
  const markPromptAnswered = (): void => {
    if (lastPrompt !== null) lastPrompt.answered = true;
  };
  // another session's deliveries seen in this text, by sender and message id: an echo is no second notice
  const peersSeen = new Set<string>();

  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue; // a torn tail line while Claude is mid-append
    }
    if (entry === null || typeof entry !== "object") continue;
    // another session's message: its own turn, so the work it started is not appended to the answer before it
    const peer = claudePeerNotice(entry);
    if (peer !== null) {
      const id = claudePeerId(entry);
      if (id !== null) { if (peersSeen.has(id)) continue; peersSeen.add(id); }
      turns.push({ role: "user", ts: entry.timestamp ?? null, parts: [peer] });
      continue;
    }
    if (entry.isMeta) continue;
    if (isContextClear(entry, "claude-transcript")) { turns.length = 0; pending.clear(); lastPrompt = null; continue; }
    const content = entry.message?.content;
    // a compaction's summary marks where the conversation was folded, readable on request
    if (entry.isCompactSummary) {
      const summary = typeof content === "string" ? content
        : Array.isArray(content) ? content.map((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : "").join("\n") : "";
      turns.push({ role: "user", ts: entry.timestamp ?? null, parts: [{ kind: "compact", text: summary }] });
      continue;
    }

    // A message sent while Claude is working is no `user` entry: it is queued, then recorded
    // as this attachment when the turn takes it in. Background task notices and other agents'
    // messages use the same record, so only a person's prompt counts. The `queue-operation`
    // lines around a prompt repeat it; a task completion can arrive only in its enqueue.
    if (entry.type === "queue-operation" && entry.operation === "enqueue" && typeof entry.content === "string" && notified(entry.content, entry.timestamp ?? null)) continue;
    const queued = entry.type === "attachment" ? entry.attachment : undefined;
    if (queued?.commandMode === "task-notification" && typeof queued.prompt === "string" && notified(queued.prompt, entry.timestamp ?? null)) continue;
    if (queued?.type === "queued_command" && queued.commandMode === "prompt" && queued.origin?.kind === "human") {
      if (typeof queued.prompt === "string" && queued.prompt.trim() && !isCommandEntry(queued.prompt.trim())) {
        turns.push({ role: "user", ts: entry.timestamp ?? null, parts: [{ kind: "text", text: unwrapPastes(queued.prompt) }] });
      }
      continue;
    }

    // A slash command answers in the terminal, not through the model: a refused /goal says why
    // only here. It is the runtime speaking in the user's seat, so it reads as a notice.
    if (entry.type === "system" && entry.subtype === "local_command") {
      const output = localCommandOutput(entry.content);
      const at = noticeAt();
      if (output.length > 0 && !saidByOtherKind(turns[at - 1], output, entry.timestamp ?? null, "local-command")) turns.splice(at, 0, { role: "user", ts: entry.timestamp ?? null, parts: [{ kind: "notice", text: output, source: "local-command" }] });
      continue;
    }

    // Claude Code's own notices: an unknown slash command and the arguments it dropped (2.1.29x
    // writes these here, not as a local_command), a usage limit reached or reset. The message
    // that drew one is not recorded, so without it a refused command just vanished from the chat.
    // Lines written together read as one notice.
    // Claude Code also writes them while the agent works (a message another session held, a
    // stopped response): about half of the real ones. Such a notice does not end the turn: it
    // goes before the turn it was written in, so the turn stays whole and stays the last one,
    // which is what the chat reads as the turn still running.
    if (entry.type === "system" && entry.subtype === "informational") {
      const text = typeof entry.content === "string" ? capNotice(stripTerminalControls(entry.content).trim()) : "";
      if (text.length === 0) continue;
      const ts = entry.timestamp ?? null;
      const at = noticeAt();
      const before = turns[at - 1];
      if (saidByOtherKind(before, text, ts, "informational")) continue;
      const said = loneNotice(before);
      if (before && said?.source === "informational" && writtenTogether(before.ts, ts)) turns[at - 1] = { ...before, parts: [{ ...said, text: capNotice(`${said.text}\n${text}`) }] };
      else turns.splice(at, 0, { role: "user", ts, parts: [{ kind: "notice", text, source: "informational" }] });
      continue;
    }

    if (entry.type === "user" && typeof content === "string") {
      if (notified(content, entry.timestamp ?? null)) continue;
      const invocation = claudeCommandEcho(content);
      if (invocation) {
        pushPrompt({ role: "user", ts: entry.timestamp ?? null, parts: [{ kind: "text", text: invocation.text }, { kind: "skill", skill: invocation.skill }] }, entry);
        continue;
      }
      if (isCommandEntry(content)) continue;
      pushPrompt({ role: "user", ts: entry.timestamp ?? null, parts: [{ kind: "text", text: unwrapPastes(content) }] }, entry);
      continue;
    }

    if (entry.type === "user" && Array.isArray(content)) {
      const invocations: ConversationPart[] = [];
      const prompt = content.flatMap((block: unknown) => {
        if (block === null || typeof block !== "object") return [];
        const part = block as { type?: string; text?: unknown };
        // a notice can share an entry with a tool's result
        if (part.type === "text" && typeof part.text === "string" && notified(part.text, entry.timestamp ?? null)) return [];
        const invocation = part.type === "text" && typeof part.text === "string" ? claudeCommandEcho(part.text) : null;
        if (invocation) {
          invocations.push({ kind: "skill", skill: invocation.skill });
          return [invocation.text];
        }
        return part.type === "text" && typeof part.text === "string" && !isCommandEntry(part.text.trim()) ? [part.text] : [];
      }).join("\n");
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const result = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: unknown };
        if (result.type !== "tool_result" || typeof result.tool_use_id !== "string") continue;
        const tool = pending.get(result.tool_use_id);
        if (tool === undefined) continue;
        pending.delete(result.tool_use_id);
        trimOutput(tool, claudeResultText(result.content), result.tool_use_id);
        if (result.is_error === true) tool.error = true;
        if (tool.skill) tool.skill.status = result.is_error === true ? "failed" : "loaded";
      }
      // an image pasted into the prompt: named here, fetched only when shown
      const images: ConversationPart[] = typeof entry.uuid !== "string" ? [] : content.flatMap((block: unknown, index: number) => {
        const image = block as { type?: unknown; source?: { type?: unknown; media_type?: unknown } } | null;
        if (image?.type !== "image" || image.source?.type !== "base64" || typeof image.source.media_type !== "string" || !IMAGE_TYPES.has(image.source.media_type)) return [];
        return [{ kind: "image" as const, media_type: image.source.media_type, ref: `${entry.uuid}:${index}` }];
      });
      if (prompt.trim() || images.length > 0) pushPrompt({ role: "user", ts: entry.timestamp ?? null, parts: [...images, ...(prompt.trim() ? [{ kind: "text" as const, text: unwrapPastes(prompt) }] : []), ...invocations] }, entry);
      continue;
    }

    if (entry.type === "assistant" && Array.isArray(content)) {
      markPromptAnswered();
      const turn = assistantTurn(entry.timestamp);
      // an entry that names no stop reason is still at work when it calls a tool
      const stop = entry.message?.stop_reason;
      completed = stop === "end_turn";
      atWork = stop === "tool_use" || (stop == null && content.some((block: unknown) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_use"));
      if (entry.timestamp) turn.end_ts = entry.timestamp;
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as { type?: string; text?: unknown; thinking?: unknown; name?: unknown; input?: unknown };
        if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
          turn.parts.push({ kind: "text", text: b.text });
        } else if (b.type === "thinking") {
          const thinking = typeof b.thinking === "string" ? b.thinking : typeof b.text === "string" ? b.text : "";
          // the terminal prints an "updates" entry's thinking as narration between the tools, so it
          // is read as that: commentary keeps it in the work block, never taken for the answer
          if (thinking.trim().length > 0 && entry.thinkingDisplay === "updates") turn.parts.push({ kind: "text", text: thinking, phase: "commentary" });
          else if (thinking.length > 0) turn.parts.push({ kind: "thinking", text: thinking });
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          const input = (typeof b.input === "object" && b.input !== null ? b.input : {}) as Record<string, unknown>;
          const part: Extract<ConversationPart, { kind: "tool" }> = {
            kind: "tool",
            name: b.name,
            summary: toolSummary(b.name, input),
            input: JSON.stringify(input, null, 2),
            output: "",
          };
          const skill = invokedSkill(b.name, input);
          if (skill) { part.skill = skill; part.summary = skill.name; }
          turn.parts.push(part);
          pending.set(String((block as { id?: unknown }).id ?? ""), part);
        }
        // unsupported transcript blocks are intentionally ignored
      }
    }
  }

  return turns.filter((turn) => turn.parts.length > 0).slice(-maxTurns);
}

/** Read sessions by source and canonical path (Claude uses its unique session id): a removed file is not unwritten. */

/** Re-parse on file changes, including replacement and same-size rewrites. */

/**
 * What a pane's chat has read, so its parsed state can be released when the pane closes.
 *
 * Every cache below is keyed by file, not by pane, and a bridge runs for weeks: without
 * this, everything a pane ever read stays for the life of the process. The release is by
 * path (and by the written-session key), which is what the maps are keyed by, and each
 * reader keeps its own bound so an entry that outlives its pane is still capped.
 */
interface DevinPaneRead { sessionId: string; cwd: string; dbPath?: string }
interface PaneReads { paths: Set<string>; sessions: Set<string>; devin: Map<string, DevinPaneRead> }
/** panes remembered; past this a pane that closed long ago is the one whose release is lost */
const PANE_READS_MAX = 128;

function emptyPaneReads(): PaneReads { return { paths: new Set<string>(), sessions: new Set<string>(), devin: new Map<string, DevinPaneRead>() }; }

function rememberPaneRead(paneId: string, path: string): void {
  const reads = conversationCache.paneReads.get(paneId) ?? emptyPaneReads();
  reads.paths.add(path);
  remember(conversationCache.paneReads, paneId, reads, PANE_READS_MAX);
}

function rememberPaneSession(paneId: string, session: string): void {
  const reads = conversationCache.paneReads.get(paneId) ?? emptyPaneReads();
  reads.sessions.add(session);
  remember(conversationCache.paneReads, paneId, reads, PANE_READS_MAX);
}

function rememberPaneDevin(paneId: string, sessionId: string, cwd: string, dbPath?: string): void {
  const reads = conversationCache.paneReads.get(paneId) ?? emptyPaneReads();
  const key = JSON.stringify([dbPath ?? defaultDevinDbPath(), sessionId, cwd]);
  reads.devin.set(key, { sessionId, cwd, dbPath });
  remember(conversationCache.paneReads, paneId, reads, PANE_READS_MAX);
}

/** What the meta files of the subagents a Claude page's notifications name say of them: read only when the page has one. */
function subagentsOnPage(path: string, text: string): ReadonlyMap<string, SubagentDetail> | undefined {
  if (!text.includes("<task-notification>")) return undefined;
  // ids come from notifications only: other text on the page (a fetched web page) can hold the tag too
  const ids = new Set<string>();
  for (const line of text.split("\n")) for (const notice of lineNotifications(line)) if (notice.agent) ids.add(notice.taskId);
  return ids.size === 0 ? undefined : subagentDetails(path, ids);
}

function parseTurns(source: RecognizedConversation["source"], path: string, text: string, taskTitles?: Map<string, string>, noticed?: Set<string>): ConversationTurn[] {
  if (source === "grok-transcript") {
    try { return parseGrokTranscript(text, path); } catch (error) {
      if (error instanceof GrokUnavailable) throw new ConversationUnavailable("transcript_missing");
      throw error;
    }
  }
  if (source === "agy-transcript") return parseAgyTranscript(text, path);
  return source === "codex-transcript" ? parseCodexTranscript(text, Infinity)
    // only pi keeps a tool's images in the entry as base64; omp, omo and gjc are read the same
    // way but would carry image refs nothing can answer, so the option stays with pi alone
    : source === "claude-transcript" ? parseClaudeTranscript(text, Infinity, { subagents: subagentsOnPage(path, text), noticed })
      : parseOmpTranscript(text, Infinity, { toolImages: source === "pi-transcript", taskTitles });
}


/** Incremental within a long Codex task, including results for tools from earlier polls. */
function codexLiveTurn(path: string, stream: TranscriptStream, start: number, before: ConversationMetadata): { turns: ConversationTurn[]; metadata: ConversationMetadata } {
  let cached = conversationCache.codexTurns.get(path);
  if (!cached || cached.id !== stream.id || cached.start !== start || cached.scanned > stream.length
    || bytesBefore(stream, cached.scanned) !== cached.boundary) {
    cached = { id: stream.id, start, scanned: start, boundary: bytesBefore(stream, start), parser: createCodexTranscriptParser(), metadata: before };
  }
  const bytes = readStream(stream, cached.scanned, stream.length);
  const complete = bytes.lastIndexOf(0x0a) + 1;
  if (complete > 0) {
    const text = bytes.subarray(0, complete).toString("utf8");
    cached.parser.write(text);
    cached.metadata = parseConversationMetadata(text, "codex-transcript", cached.metadata);
    cached.scanned += complete;
    cached.boundary = bytesBefore(stream, cached.scanned);
  }
  const tail = bytes.subarray(complete).toString("utf8");
  // Both record count and retained source bytes are bounded, independent of session length.
  remember(conversationCache.codexTurns, path, cached, 8);
  let retained = [...conversationCache.codexTurns.values()].reduce((sum, turn) => sum + turn.scanned - turn.start, 0);
  for (const [key, turn] of conversationCache.codexTurns) {
    if (retained <= 2 * TRANSCRIPT_WINDOW_BYTES) break;
    conversationCache.codexTurns.delete(key);
    retained -= turn.scanned - turn.start;
  }
  return { turns: cached.parser.snapshot(tail), metadata: parseConversationMetadata(tail, "codex-transcript", cached.metadata) };
}

/** Retention diagnostics only: counts/budget adherence, never transcript contents. */
export function piPageCacheUsage(): { pages: number; settled: number; withinBudget: boolean } {
  const pages = [...conversationCache.pages.values()].filter(item => item.source === "pi-transcript");
  const settled = [...conversationCache.settledTurns.values()].filter(item => item.source === "pi-transcript");
  return { pages: pages.length, settled: settled.length, withinBudget: [...pages, ...settled].every(item => withinRetentionBudget(item, PI_PAGE_CACHE_BYTES)) };
}

/** Forget every scan and parse kept between polls (tests compare against a cold read). */
export function forgetTranscriptState(): void {
  launchedAgents.clear();
  conversationCache.pages.clear();
  conversationCache.writtenSessions.clear();
  forgetClaudeSessions();
  forgetGjcState();
  forgetSubagents();
  forgetOpencodeState();
  conversationCache.liveScans.clear();
  conversationCache.pageWindowScans.clear();
  conversationCache.settledTurns.clear();
  conversationCache.codexTurns.clear();
  conversationCache.transcriptRevisions.clear();
  conversationCache.clearScans.clear();
  conversationCache.paneReads.clear();
  forgetAllCodexState();
  forgetAllPiIndexes();
  forgetGrokState();
  forgetAgyState();
  forgetDevinState();
  forgetHermesTranscriptState();
}

/**
 * Drop everything one pane's chat parsed, the caches here and in the readers below.
 *
 * The maps are keyed by file, so the pane is remembered against what it read
 * (`rememberPaneRead`). Every delete is a memo of a file that still exists: the next read
 * of a live pane re-derives it, and a file nobody reads again costs nothing to forget.
 */
export function forgetPaneTranscriptState(paneId: string): void {
  const reads = conversationCache.paneReads.get(paneId);
  conversationCache.paneReads.delete(paneId);
  launchedAgents.forget(paneId);
  if (reads === undefined) return;
  // two panes can read one transcript (a resumed session, a shared store): what another pane
  // still reads stays
  const shared = (pick: (other: PaneReads) => Set<string>, value: string): boolean => [...conversationCache.paneReads.values()].some((other) => pick(other).has(value));
  for (const session of reads.sessions) if (!shared((other) => other.sessions, session)) conversationCache.writtenSessions.delete(session);
  for (const [key, session] of reads.devin) {
    if (![...conversationCache.paneReads.values()].some((other) => other.devin.has(key))) forgetDevinState(session.sessionId, session.cwd, session.dbPath);
  }
  for (const path of reads.paths) {
    if (shared((other) => other.paths, path)) continue;
    for (const key of [...conversationCache.pages.keys()]) if (key.startsWith(`${path}\0`)) conversationCache.pages.delete(key);
    conversationCache.transcriptRevisions.delete(path);
    conversationCache.liveScans.delete(path);
    conversationCache.pageWindowScans.delete(path);
    for (const key of [...conversationCache.settledTurns.keys()]) if (key.startsWith(`${path}\0`)) conversationCache.settledTurns.delete(key);
    conversationCache.codexTurns.delete(path);
    conversationCache.clearScans.delete(path);
    forgetCodexStateFor(path);
    forgetPiIndex(path);
    forgetGrokState(path);
    forgetAgyState(path);
    forgetClaudeSessionFile(path);
    forgetOpencodeRead(path);
    forgetHermesTranscriptState(path);
  }
}

/** gjc's resolver answers null; the chat lens reports why it fell back to scrollback. */
export async function gjcTranscriptPath(paneId: string, cwd: string, home?: string): Promise<string> {
  const path = await gjcTranscriptForPane(paneId, cwd, home);
  if (!path) throw new ConversationUnavailable("no_session_path");
  return path;
}

/**
 * Is omo the agent in this pane, whatever herdr currently labels it? A probe
 * failure answers "no": the caller then reports why the labelled store failed,
 * which is the more useful error.
 */
export async function paneRunsOmo(paneId: string): Promise<boolean> {
  // pane.process_info wants `pane_id`; given `target` herdr answers for the
  // FOCUSED pane instead of erroring (live-verified 2026-09-21).
  const info = await herdrRpc<{ process_info?: { foreground_processes?: { pid?: unknown; argv?: unknown; cwd?: unknown }[] } }>(
    "pane.process_info",
    { pane_id: paneId },
  ).catch(() => null);
  const home = process.env["HOME"] ?? "";
  return (info?.process_info?.foreground_processes ?? []).some((process) =>
    // a pid herdr does not report keeps the argv-only proof and fails the custom one closed
    omoProcessIdentity({
      pid: typeof process.pid === "number" ? process.pid : -1,
      argv: Array.isArray(process.argv) ? process.argv.map(String) : undefined,
      cwd: typeof process.cwd === "string" && process.cwd ? process.cwd : undefined,
    }, "", home) !== null,
  );
}

/** Loaded roots and environment belong to the foreground agent, not the web server. */
export async function paneProcessRoots(paneId: string, agent: string | null | undefined): Promise<{
  omo: { agentDir: string | null; pluginDir: string | null } | null;
  environ: string[] | null;
  pid: number | null;
  cwd: string | null;
}> {
  const info = await herdrRpc<{ process_info?: { foreground_processes?: { pid?: unknown; argv?: unknown; cwd?: unknown }[] } }>(
    "pane.process_info", { pane_id: paneId },
  ).catch(() => null);
  const home = process.env["HOME"] ?? "";
  const directory = (path: string | null): string | null => {
    try { return path && statSync(path).isDirectory() ? path : null; } catch { return null; }
  };
  let matched: { pid: number; cwd: string } | null = null;
  for (const candidate of info?.process_info?.foreground_processes ?? []) {
    const process = {
      pid: typeof candidate.pid === "number" ? candidate.pid : -1,
      argv: Array.isArray(candidate.argv) ? candidate.argv.map(String) : [],
      cwd: typeof candidate.cwd === "string" ? candidate.cwd : "",
    };
    const binary = (word: string): string => nodePath.posix.basename(word.replace(/\\/g, "/")).replace(/\.(?:exe|cmd|js|mjs|cjs)$/i, "");
    const executable = binary(process.argv[0] ?? "");
    const launched = ["node", "bun", "python", "python3"].includes(executable) ? binary(process.argv[1] ?? "") : executable;
    if (!matched && agent && ["claude", "codex", "omp", "gjc", "pi", "opencode", "devin", "grok", "hermes", "agy"].includes(agent) && launched === agent) {
      matched = process;
    }
    const identity = omoProcessIdentity(process, "", home);
    if (!identity) continue;
    const agentDir = directory(identity.agentDir);
    const argv = process.argv.map((word) => word.replace(/\\/g, "/"));
    const extension = argv.find((word, index) => argv[index - 1] === "--extension" && /\/omo-ai\/plugin\/?$/.test(word));
    let pluginDir = directory(extension ? nodePath.resolve(process.cwd, extension) : null);
    if (!pluginDir) {
      const word = argv.find((word) => word.includes("/omo-ai/"));
      if (word) {
        try {
          const canonical = realpathSync(nodePath.resolve(process.cwd, word));
          const paths = nodePath.win32.isAbsolute(canonical) && !nodePath.posix.isAbsolute(canonical) ? nodePath.win32 : nodePath.posix;
          for (let parent = paths.dirname(canonical); parent !== paths.dirname(parent); parent = paths.dirname(parent)) {
            if (paths.basename(parent) === "omo-ai") {
              pluginDir = directory(paths.join(parent, "plugin"));
              break;
            }
          }
        } catch { /* launcher may have gone away; try the installed executable */ }
      }
    }
    if (!pluginDir) {
      const executable = Bun.which("omo");
      if (executable) {
        try { pluginDir = directory(nodePath.join(nodePath.dirname(nodePath.dirname(realpathSync(executable))), "plugin")); }
        catch { /* no readable installed plugin */ }
      }
    }
    return { omo: { agentDir, pluginDir }, environ: processEnviron(process.pid), pid: process.pid, cwd: process.cwd || null };
  }
  return { omo: null, environ: matched ? processEnviron(matched.pid) : null, pid: matched?.pid ?? null, cwd: matched?.cwd || null };
}

/**
 * herdr labels an omo pane `pi` while it waits and `claude` while omo's claude-sdk child
 * runs, so the sidebar showed another agent's mark, and one that changed as omo worked.
 * The snapshots the browser gets name such a pane `omo`, decided by its process tree
 * (paneRunsOmo), including panes herdr has not recognized as an agent.
 */
export async function labelOmoPanes(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
  const candidates = snapshot.panes;
  const omo = new Set<string>();
  await Promise.all(candidates.map(async (pane) => { if (await paneRunsOmo(pane.pane_id)) omo.add(pane.pane_id); }));
  if (omo.size === 0) return snapshot;
  return {
    ...snapshot,
    panes: snapshot.panes.map((pane) => omo.has(pane.pane_id) ? { ...pane, agent: "omo" } : pane),
    agents: snapshot.agents.map((agent) => omo.has(agent.pane_id) ? { ...agent, agent: "omo" } : agent),
  };
}

/** The Claude processes in a pane's foreground; none when herdr cannot say. */
async function claudeProcesses(paneId: string): Promise<{ pid: number; name?: string; argv0?: string; argv?: string[] }[]> {
  try {
    const processInfo = await herdrRpc<{ process_info?: { foreground_processes?: { pid: number; name?: string; argv0?: string; argv?: string[] }[] } }>(
      "pane.process_info", { pane_id: paneId },
    );
    return processInfo.process_info?.foreground_processes?.filter(isClaudeProcess) ?? [];
  } catch { return []; /* herdr busy: the default store */ }
}

/** The pid of the one Claude process in a pane's foreground, or null. */
export async function claudePanePid(pane: HerdrPane): Promise<number | null> {
  const processes = await claudeProcesses(pane.pane_id);
  return processes.length === 1 ? processes[0]!.pid : null;
}

/**
 * Claude's transcript: Herdr's hook, or a unique live Claude's native PID record, in the config dir
 * of the pane's Claude process (a launcher can give each environment its own CLAUDE_CONFIG_DIR).
 */
async function claudeTranscriptPath(paneId: string, cwds: readonly (string | null | undefined)[], onProcess?: (pid: number) => void): Promise<string> {
  const info = await herdrRpc<{ agent: { agent_session?: { value?: unknown } } }>("agent.get", { target: paneId });
  let session = info.agent.agent_session?.value;
  const home = process.env["HOME"] ?? "";
  const processes = await claudeProcesses(paneId);
  const only = processes.length === 1 ? processes[0] : undefined;
  if (only) onProcess?.(only.pid);
  let processDir: string | null = null;
  try {
    processDir = only ? await processClaudeConfigDir(only.pid, only.argv ?? [only.argv0 ?? only.name ?? ""], home) : null;
  } catch (error) {
    // two stores claim the process: ~/.claude would be a guess, maybe another account's session (#586)
    if (error instanceof AmbiguousClaudeStore) throw new ConversationUnavailable("no_session_id");
    throw error;
  }
  const configDir = processDir || defaultClaudeConfigDir(home);
  if ((typeof session !== "string" || !SESSION_ID.test(session)) && only) session = await claudeProcessSession(home, only.pid, configDir);
  if (typeof session !== "string" || !SESSION_ID.test(session)) throw new ConversationUnavailable("no_session_id");
  const path = await claudeTranscriptFile(home, session, cwds, configDir);
  // Claude writes the file with its first message: until then the session it reports holds nothing
  if (!path) throw new ConversationNotStarted(session, "claude-transcript");
  return path;
}

/** A Claude pane's transcript and when its Claude process started (null when it cannot be told), or null while it has no transcript. */
export async function claudePaneSession(pane: HerdrPane): Promise<{ path: string; startedAt: number | null; pid: number | null } | null> {
  let pid: number | null = null;
  try {
    const path = await claudeTranscriptPath(pane.pane_id, [pane.cwd, pane.foreground_cwd], (found) => { pid = found; });
    return { path, startedAt: pid === null ? null : processStartedAt(pid), pid };
  } catch (error) {
    if (error instanceof ConversationUnavailable) return null;
    throw error;
  }
}

/**
 * The store holding the omp session herdr reports, or null unless the path is a transcript
 * inside one of the user's own stores: ~/.omp/agent/sessions, or the one `omp --profile <name>`
 * keeps at ~/.omp/profiles/<name>/agent/sessions. A Windows PC reports it in its own form
 * (drive letter, backslashes).
 */
export function ompSessionStore(value: unknown, home: string, paths: PlatformPath = nodePath): string | null {
  if (typeof value !== "string" || !value.endsWith(".jsonl") || !paths.isAbsolute(value) || !paths.isAbsolute(home)) return null;
  const store = paths.join(home, ".omp", "agent", "sessions");
  if (storeRelative(store, value, paths)) return store;
  const profiles = paths.join(home, ".omp", "profiles");
  const parts = storeRelative(profiles, value, paths);
  if (!parts || parts.length < 4 || parts[1] !== "agent" || parts[2] !== "sessions") return null;
  return paths.join(profiles, parts[0]!, "agent", "sessions");
}

/**
 * omp's transcript: herdr hands over the absolute path, accepted only inside the user's own
 * stores. When herdr names none (or another agent's session), the pane's omp process does.
 */
async function ompTranscriptPath(paneId: string, cwd: string): Promise<string> {
  const info = await herdrRpc<{ agent: { agent_session?: { kind?: unknown; value?: unknown } } }>("agent.get", { target: paneId });
  const session = info.agent.agent_session;
  const path = session?.kind === "path" && typeof session.value === "string" ? session.value : null;
  // a Windows bridge starts with HOME set to the profile directory (remote-entry.ts)
  const store = ompSessionStore(path, process.env["HOME"] ?? "");
  if (path === null || store === null) {
    const held = await ompHeldTranscript(paneId, cwd);
    if (held === null) throw new ConversationUnavailable("no_session_path");
    return held;
  }
  // omp names its session file at start and writes it with the first answer
  const unwritten = unwrittenSession(path, store);
  if (unwritten !== null) throw new ConversationNotStarted(unwritten.id, "omp-transcript", unwritten.path);
  // the check above is lexical: a link out of the store is no transcript of this pane
  const inStore = piTranscriptInStore(path, store);
  if (inStore === null) throw new ConversationUnavailable("no_session_path");
  return inStore;
}

/**
 * The store a pane's transcript lives in. herdr's agent label follows the
 * pane's foreground processes, so an omo pane reads as `pi` while it waits and
 * as `claude` while its claude-sdk child runs (live-verified 2026-09-21) — the
 * label alone cannot route omo. Its process tree takes precedence over the child
 * label: omo's own store is read only when omo is really running
 * in that pane, never on a matching cwd alone.
 */
async function resolveTranscript(pane: HerdrPane, cwd: string, codexHome?: string, panes?: HerdrPane[], opencodeDb?: string, hermesHome?: string, grokHome?: string): Promise<ResolvedTranscript> {
  const paneId = pane.pane_id;
  let agent = pane.agent ?? pane.agent_session?.agent ?? "";
  // herdr names no agent for this pane: a session report an earlier agent left behind says
  // nothing about what runs now, so the pane's processes are asked before it is followed.
  // A pane herdr does label is not asked: the lookup would cost every transcript lookup an RPC (and
  // a process-table read on Windows), and a gjc below another agent would take its chat.
  if (!pane.agent) {
    const info = await herdrRpc<{ process_info?: { shell_pid?: number; foreground_processes?: { argv?: unknown }[] } }>(
      "pane.process_info", { pane_id: paneId },
    ).catch(() => null);
    const running = (info?.process_info?.foreground_processes ?? []).some((process) =>
      isGjcProcess(Array.isArray(process.argv) ? process.argv.map(String) : []),
    );
    if (running || await gjcPidUnderShell(info?.process_info?.shell_pid)) agent = "gjc";
  }
  if (await paneRunsOmo(paneId)) {
    return { source: "omo-transcript", path: await omoTranscriptPath(paneId, cwd, panes) };
  }
  // omp and GJC can change their own cwd without changing the pane's shell directory; their
  // session headers name the one they run in
  const sessionCwd = typeof pane.foreground_cwd === "string" && pane.foreground_cwd.length > 0 ? pane.foreground_cwd : cwd;
  try {
    if (agent === "grok") {
      const found = await resolveGrokStore(pane, grokHome);
      if (!found) throw new ConversationUnavailable("no_session_path");
      return { source: "grok-transcript", path: found };
    }
    if (agent === "agy") {
      const found = await resolveAgyStore(pane);
      if (!found) throw new ConversationUnavailable("no_session_path");
      let transcriptExists: boolean;
      try { transcriptExists = !!statSync(found.path, { throwIfNoEntry: false }); }
      catch { throw new ConversationUnavailable("transcript_missing"); }
      if (!transcriptExists) {
        if (agyCatalog(found.path).size !== 0 || !sameAgyStore(found, await resolveAgyStore(pane))) throw new ConversationUnavailable("transcript_missing");
        throw new ConversationNotStarted(found.session, "agy-transcript", found.path);
      }
      return { source: "agy-transcript", path: found.path, agy: found };
    }
    if (agent === "codex") {
      // the pane's own store: the rollout, its history and its images are all read from there
      const home = await paneCodexHome(paneId, codexHome);
      const path = await codexTranscriptPath(paneId, cwd, home, panes);
      if (!path) throw new ConversationUnavailable("no_session_path");
      return { source: "codex-transcript", path, codexHome: home };
    }
    // Claude's project is the directory it started in, the process's own cwd more often than the pane's
    if (agent === "claude") return { source: "claude-transcript", path: await claudeTranscriptPath(paneId, [cwd, pane.foreground_cwd]) };
    if (agent === "omp") return { source: "omp-transcript", path: await ompTranscriptPath(paneId, sessionCwd) };
    if (agent === "gjc") return { source: "gjc-transcript", path: await gjcTranscriptPath(paneId, sessionCwd) };
    // pi's own label only routes pi: an omo pane was taken above, by its process tree.
    if (agent === "pi") {
      const found = await piTranscriptPath(paneId);
      if (found === null) throw new ConversationUnavailable("no_session_path");
      if ("unwritten" in found) throw new ConversationNotStarted(found.unwritten.id, "pi-transcript", found.unwritten.path);
      return { source: "pi-transcript", path: found.path };
    }
    if (agent === "opencode") {
      // herdr's integration names the session the TUI shows; at its home screen there is none
      const session = opencodeSessionId(pane);
      if (session === null) throw new ConversationUnavailable("no_session_id");
      const path = opencodeDb ?? opencodeDatabasePath();
      if (path === null) throw new ConversationUnavailable("no_session_path");
      return { source: "opencode-transcript", path, session };
    }
    if (agent === "hermes") {
      const resolved = await hermesTranscriptForPane(pane, cwd, hermesHome);
      return { source: "hermes-transcript", path: resolved.dbPath, sessionId: resolved.sessionId };
    }
    throw new ConversationUnavailable("no_recognized_transcript");
  } catch (error) {
    if (error instanceof AgyUnavailable) throw new ConversationUnavailable("transcript_missing");
    if (!(error instanceof ConversationUnavailable) || !(await paneRunsOmo(paneId))) throw error;
    return { source: "omo-transcript", path: await omoTranscriptPath(paneId, cwd, panes) };
  }
}

async function omoTranscriptPath(paneId: string, cwd: string, panes?: HerdrPane[]): Promise<string> {
  const session = await omoSessionForPane(paneId, cwd, panes ?? (await sessionSnapshot()).panes);
  if (session.pending !== null) throw new ConversationNotStarted(session.pending);
  if (!session.path) throw new ConversationUnavailable("no_session_path");
  return session.path;
}

/** A live Devin executable, not a command line which happens to mention one. */
export function isDevinProcess(argv: readonly string[]): boolean {
  const executable = argv[0] ?? "";
  const exact = /(?:^|[\\/])devin(?:\.exe)?$/;
  return process.platform === "win32" ? exact.test(executable.toLowerCase()) : exact.test(executable);
}

/** Resolves only a session explicitly named by this live Devin pane, never by directory contents. */
export function devinSessionForPane(pane: HerdrPane, panes: HerdrPane[], argv: string[]): string {
  if (pane.agent !== "devin") throw new ConversationUnavailable("no_session_id");
  const reported = pane.agent_session?.agent === "devin" && pane.agent_session.kind === "id"
    && typeof pane.agent_session.value === "string" && pane.agent_session.value.length > 0
    ? pane.agent_session.value : null;
  const resumed: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--") break;
    if (arg.startsWith("--resume=")) {
      const id = arg.slice("--resume=".length);
      if (!id || id.startsWith("-")) throw new ConversationUnavailable("no_session_id");
      resumed.push(id);
    } else if (arg === "--resume" || arg === "-r") {
      const id = argv[index + 1];
      if (!id || id.startsWith("-")) throw new ConversationUnavailable("no_session_id");
      resumed.push(id);
      index++;
    }
  }
  const named = resumed[0] ?? null;
  if (resumed.some((id) => id !== named) || (reported !== null && named !== null && reported !== named)) {
    throw new ConversationUnavailable("no_session_id");
  }
  const explicit = reported ?? named;
  if (explicit === null) throw new ConversationUnavailable("no_session_id");
  if (panes.some((other) => other.pane_id !== pane.pane_id && other.agent === "devin"
    && other.agent_session?.agent === "devin" && other.agent_session.kind === "id" && other.agent_session.value === explicit)) {
    throw new ConversationUnavailable("no_session_id");
  }
  return explicit;
}

/** Resolve the native live file or database session without reading conversation turns. */
export async function paneTranscript(paneId: string, codexHome?: string, snapshot?: SessionSnapshot, devinDbPath?: string, opencodeDb?: string, hermesHome?: string, grokHome?: string): Promise<NativeTranscript> {
  const panes = (snapshot ?? await sessionSnapshot()).panes;
  const pane = panes.find((candidate) => candidate.pane_id === paneId);
  if (pane === undefined) throw new ConversationUnavailable("pane_not_found");
  if (typeof pane.cwd !== "string" || pane.cwd.length === 0) throw new ConversationUnavailable("no_recognized_transcript");

  if (pane.agent === "devin" && !(await paneRunsOmo(paneId))) {
    const cwd = pane.foreground_cwd || pane.cwd;
    const storePath = devinDbPath ?? defaultDevinDbPath();
    const info = await herdrRpc<{ process_info?: { foreground_processes?: { argv?: unknown }[] } }>(
      "pane.process_info", { pane_id: paneId },
    ).catch(() => null);
    const processes = (info?.process_info?.foreground_processes ?? []).filter((process) =>
      Array.isArray(process.argv) && process.argv.every((arg) => typeof arg === "string") &&
      isDevinProcess(process.argv as string[]) && process.argv[1] !== "acp",
    );
    if (processes.length > 1) throw new ConversationUnavailable("transcript_missing");
    // No Devin runs under the label: what does run is resolved below, as it was before this
    // reader (an omo is found by its process tree, whatever herdr calls the pane).
    if (processes.length === 1) {
      const session = devinSessionForPane(pane, panes, processes[0]!.argv as string[]);
      return { source: "devin-transcript", path: storePath, session, cwd };
    }
  }

  return resolveTranscript(pane, pane.cwd, codexHome, panes, opencodeDb, hermesHome, grokHome);
}

/** no transcript states the model yet: the agent's own screen does (start-screen.ts). A screen
 * that cannot be read leaves it unknown, as it was */
async function notBegunConversation(paneId: string, source: RecognizedConversation["source"], id: string): Promise<RecognizedConversation> {
  const screen = readsStartScreen(source) ? await paneRead({ paneId, source: "visible", format: "text", timeoutMs: 2_000 }).then((read) => read.text, () => "") : "";
  const metadata = startScreenMetadata(source, screen);
  return { source, turns: [], metadata, cursor: null, history_id: id, version: answerVersion(id, `${metadata.model}\0${metadata.reasoning_effort}`) };
}

type ConversationOpening =
  | { kind: "resolved"; resolved: NativeTranscript; snapshot: SessionSnapshot }
  // the pane's session has not written its first record: only its first page can answer
  | { kind: "unwritten"; error: ConversationNotStarted; snapshot: SessionSnapshot }
  // an agent this server started writes no session before its first message (launched-agents.ts)
  | { kind: "launched"; source: RecognizedConversation["source"]; historyId: string; snapshot: SessionSnapshot };

export async function openPaneConversation(paneId: string, codexHome?: string, devinDbPath?: string, opencodeDb?: string, hermesHome?: string, grokHome?: string): Promise<PaneConversationReader> {
  const snapshot = await sessionSnapshot();
  let opening: ConversationOpening;
  try {
    const resolved = await paneTranscript(paneId, codexHome, snapshot, devinDbPath, opencodeDb, hermesHome, grokHome);
    launchedAgents.forget(paneId);
    opening = { kind: "resolved", resolved, snapshot };
  } catch (error) {
    if (error instanceof ConversationNotStarted) {
      launchedAgents.forget(paneId);
      opening = { kind: "unwritten", error, snapshot };
    } else if (error instanceof ConversationUnavailable) {
      const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId);
      if (pane === undefined) { launchedAgents.forget(paneId); throw error; }
      const launch = launchedAgents.notBegun(paneId, pane.agent_status);
      if (launch === null) throw error;
      opening = { kind: "launched", source: launch.source, historyId: launch.historyId, snapshot };
    } else {
      throw error;
    }
  }

  const notStarted = (error: ConversationNotStarted, page: ConversationPage): Promise<RecognizedConversation> => {
    // a file read before and gone since is no conversation not begun: the terminal stands in for it
    if (conversationCache.writtenSessions.has(`${error.source}\0${error.identity}`)) throw new ConversationUnavailable("transcript_missing");
    // nothing comes before a conversation not begun: a cursor into it is another one's
    if (page.before !== undefined || page.since !== undefined || page.from !== undefined) throw new HistoryChanged();
    // an agent at work on its first turn has written nothing yet, but its terminal shows the turn
    const status = opening.snapshot.panes.find((pane) => pane.pane_id === paneId)?.agent_status;
    if (status === "working" || status === "blocked") throw error;
    // the chat says there is nothing yet; the session's first prompt writes the file and
    // the next refresh's history_id differs, so the chat takes it whole
    return notBegunConversation(paneId, error.source, `unwritten:${error.sessionId}`);
  };

  // one transcript file's stream, while the reader keeps reading pages of the same file
  let reuse: TranscriptStreamReuse | undefined;
  return {
    async read(page: ConversationPage = {}): Promise<RecognizedConversation> {
      if (opening.kind === "unwritten") return notStarted(opening.error, page);
      if (opening.kind === "launched") {
        if (page.before !== undefined || page.since !== undefined || page.from !== undefined) throw new HistoryChanged();
        return notBegunConversation(paneId, opening.source, opening.historyId);
      }
      return readConversation(paneId, opening.resolved, opening.snapshot, page, codexHome, devinDbPath, opencodeDb, hermesHome, grokHome, reuse ??= {});
    },
  };
}

/**
 * pane -> agent session -> transcript turns. Read-only, same-user files only.
 * Claude sessions are looked up by id under ~/.claude/projects; omp sessions
 * come from herdr or the pane's omp process (ompTranscriptPath); omo sessions are resolved from its own store by
 * process/session evidence (omoTranscriptForPane). Throws ConversationUnavailable when the pane has
 * no recognized agent store (the caller falls back to the scrollback
 * transcript view, like chatmux).
 *
 * Without `page` this is the newest page. `before` is the page ending at a
 * returned cursor; `from` is every turn after one, for a chat that already
 * shows the pages before it. A cursor from another file throws HistoryChanged.
 * `opencodeDb` is OpenCode's store, unset where OpenCode itself would find it.
 */
export async function paneConversation(paneId: string, codexHome?: string, page: ConversationPage = {}, devinDbPath?: string, opencodeDb?: string, hermesHome?: string, grokHome?: string): Promise<RecognizedConversation> {
  const reader = await openPaneConversation(paneId, codexHome, devinDbPath, opencodeDb, hermesHome, grokHome);
  return reader.read(page);
}

async function readConversation(paneId: string, resolved: NativeTranscript, snapshot: SessionSnapshot, page: ConversationPage, codexHome: string | undefined, devinDbPath: string | undefined, opencodeDb: string | undefined, hermesHome: string | undefined, grokHome: string | undefined, reuse: TranscriptStreamReuse): Promise<RecognizedConversation> {
  const onNotStarted = (error: ConversationNotStarted): Promise<RecognizedConversation> => {
    if (conversationCache.writtenSessions.has(`${error.source}\0${error.identity}`)) throw new ConversationUnavailable("transcript_missing");
    if (page.before !== undefined || page.since !== undefined || page.from !== undefined) throw new HistoryChanged();
    const status = snapshot.panes.find((pane) => pane.pane_id === paneId)?.agent_status;
    if (status === "working" || status === "blocked") throw error;
    return notBegunConversation(paneId, error.source, `unwritten:${error.sessionId}`);
  };

  if (resolved.source === "devin-transcript") {
    try {
      const answer = devinConversation(resolved.session, resolved.cwd, page, resolved.path);
      rememberPaneDevin(paneId, resolved.session, resolved.cwd, resolved.path);
      return answer;
    } catch (error) {
      if (error instanceof DevinHistoryUnavailable) throw new ConversationUnavailable("transcript_missing");
      throw error;
    }
  }
  if (resolved.source === "opencode-transcript") {
    // its caches are keyed by store and session, which is what the pane is remembered against
    rememberPaneRead(paneId, opencodeReadKey(resolved.path, resolved.session));
    const answer = opencodeConversation(resolved.path, resolved.session, page);
    if (answer.kind === "history_changed") throw new HistoryChanged();
    if (answer.kind === "unavailable") throw new ConversationUnavailable(answer.reason);
    const { kind: _kind, signature, ...conversation } = answer;
    const key = `opencode\0${resolved.path}\0${resolved.session}\0${page.before ?? ""}\0${page.since ?? ""}\0${page.from ?? ""}`;
    return { source: resolved.source, ...conversation, version: answerVersion(key, signature) };
  }
  if (resolved.source === "hermes-transcript") {
    rememberPaneRead(paneId, resolved.path);
    try {
      const answer = hermesConversationPage(resolved.sessionId, resolved.path, page);
      conversationCache.writtenSessions.add(`${resolved.source}\0${resolved.sessionId}`);
      rememberPaneSession(paneId, `${resolved.source}\0${resolved.sessionId}`);
      return answer;
    } catch (error) {
      if (error instanceof ConversationNotStarted) return await onNotStarted(error);
      throw error;
    }
  }
  const identity = resolved.source === "agy-transcript" ? resolved.path
    : resolved.source === "claude-transcript" ? nodePath.basename(resolved.path, ".jsonl")
    : resolved.source === "pi-transcript" || resolved.source === "omp-transcript" ? realpathSync(resolved.path) : null;
  rememberPaneRead(paneId, resolved.path);
  const answer = transcriptPage(resolved.source, resolved.path, page, resolved.codexHome ?? codexHome, reuse);
  const status = snapshot.panes.find((pane) => pane.pane_id === paneId)?.agent_status;
  if (resolved.source === "grok-transcript" && answer.turns.length === 0 && page.before === undefined
    && (status === "working" || status === "blocked")) {
    // the file can change or go between the page and this check: either way the terminal answers
    let revision: string | null = null;
    try { revision = grokProjection(resolved.path, statSync(resolved.path)).revision; } catch { /* unreadable now */ }
    if (revision === null || revision === "0") throw new ConversationUnavailable("transcript_missing");
  }
  if (resolved.agy && !sameAgyStore(resolved.agy, await resolveAgyStore(snapshot.panes.find((pane) => pane.pane_id === paneId)!))) throw new ConversationUnavailable("no_session_path");
  if (identity !== null) { conversationCache.writtenSessions.add(`${resolved.source}\0${identity}`); rememberPaneSession(paneId, `${resolved.source}\0${identity}`); }
  if (resolved.source === "grok-transcript") {
    try { return { ...answer, activity: grokProjection(resolved.path, statSync(resolved.path)).activity }; }
    catch { throw new ConversationUnavailable("transcript_missing"); }
  }
  return answer;
}

/** What one source's stream is made of: the per-source details stay in this module until todo 6 hands them to the providers. */
function streamSpec(source: StreamSource, path: string, stat: StreamStat, codexHome: string, agy?: AgyProjection): StreamSpec {
  // (a chain whose parent was archived since comes back shorter: codexHistorySegments;
  // a pi branch skips the side paths a /tree left behind: piBranchSegments)
  const grok = source === "grok-transcript" ? grokProjection(path, stat) : null;
  const branch = source === "pi-transcript" ? piBranchSegments(path, stat.size) : null;
  if (source === "pi-transcript" && branch === null) throw new ConversationUnavailable("branch_unreadable");
  const segments: StreamSpec["segments"] = source === "codex-transcript"
    ? codexHistorySegments(path, codexHome).map((segment) => ({ path: segment.path, start: 0, end: segment.end }))
    : grok !== null ? grok.segments.map((segment) => ({ path, ...segment }))
    : agy ? agy.segments.map((segment) => ({ path, ...segment }))
    : branch !== null ? branch.map((segment) => ({ path, start: segment.start, end: segment.end }))
    : [{ path, start: 0, end: stat.size }];
  const files = streamFiles(segments, path, stat);
  let chain = "";
  if (grok !== null) {
    chain = `-grok-${createHash("sha256").update(path).digest("base64url").slice(0, 10)}-${grok.revision}`;
  } else if (agy) {
    chain = `-agy-${agy.revision}`;
  } else if (branch !== null) {
    const layout = files.map((file, at) => (at === files.length - 1 ? `${file.offset}` : `${file.offset}\0${file.length}`)).join("\n");
    chain = `-${createHash("sha256").update(layout).digest("base64url").slice(0, 10)}`;
  } else if (source === "codex-transcript") {
    const earlier = files.slice(0, -1).map((file) => {
      const identity = statSync(file.path, { throwIfNoEntry: false });
      return `${file.path}\0${file.length}\0${identity ? `${identity.dev}:${identity.ino}` : "-"}`;
    });
    chain = earlier.length === 0 ? "" : `-${createHash("sha256").update(earlier.join("\n")).digest("base64url").slice(0, 10)}`;
  }
  return { segments, chain, promptStarts: grok?.promptStarts ?? agy?.promptStarts };
}

/** The details this module's provider readers own: codex's head and live turn, pi's abandoned branches. */
const pageSource: PageSource = {
  head: (path) => readRange(path, 0, METADATA_HEAD_BYTES),
  live: codexLiveTurn,
  abandoned: (path, size) => piAbandonedTurns(path, size) ?? undefined,
};

/** One page of a resolved transcript (paneConversation's `page`). */
export function transcriptPage(source: StreamSource, path: string, page: ConversationPage = {}, codexHome?: string, reuse?: TranscriptStreamReuse): RecognizedConversation {
  if (source === "agy-transcript") {
    try { return withAgyHistory(path, (projection, fd) => ({ ...transcriptPageRead(source, path, page, codexHome, projection, fd), activity: projection.activity })); }
    catch (error) {
      if (error instanceof HistoryChanged || error instanceof ConversationUnavailable) throw error;
      throw new ConversationUnavailable("transcript_missing");
    }
  }
  return transcriptPageRead(source, path, page, codexHome, undefined, undefined, reuse);
}

/** One source's page: its stream is built from the source's spec and handed to the reader with the source's parser. */
function transcriptPageRead(source: StreamSource, path: string, page: ConversationPage, codexHome?: string, agy?: AgyProjection, fd?: number, reuse?: TranscriptStreamReuse): RecognizedConversation {
  let stat: StreamStat;
  try {
    stat = statSync(path);
  } catch {
    throw new ConversationUnavailable("transcript_missing");
  }
  let spec: StreamSpec;
  try {
    spec = streamSpec(source, path, stat, codexHome ?? defaultCodexHome(), agy);
  } catch (error) {
    // a branch that cannot be walked says so; a file that went unreadable mid-read has
    // one answer, and an unreadable branch has its own
    if (error instanceof ConversationUnavailable) throw error;
    throw new ConversationUnavailable("transcript_missing");
  }
  // Pages of one walk read the same file a moment apart: the stream, and with it the file's
  // chain and reset boundary, is reused until the stat says the file changed.
  const stream = resolveStream(reuse, source, path, stat, spec, fd);
  return readTranscriptPage(stream, source, path, stat, page, parseTurns, pageSource);
}

/**
 * One image a user pasted into a Claude prompt, by the ref its image part carries
 * (`<entry uuid>:<block index>`): the transcript holds it as base64, so it is decoded
 * here rather than sent with every poll of the conversation. Null when there is no such
 * image. Codex uses a hash of the native attachment and searches only the bound history.
 */
export async function conversationImage(paneId: string, ref: string, codexHome?: string, opencodeDb?: string): Promise<{ mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  if (!IMAGE_REF.test(ref) && !CODEX_IMAGE_REF.test(ref) && !PI_IMAGE_REF.test(ref) && !OPENCODE_IMAGE_REF.test(ref)) return null;
  const snapshot = await sessionSnapshot();
  const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId);
  if (pane === undefined || typeof pane.cwd !== "string" || pane.cwd.length === 0) return null;
  let resolved: ResolvedTranscript;
  try { resolved = await resolveTranscript(pane, pane.cwd, codexHome, snapshot.panes, opencodeDb); }
  catch (error) { if (error instanceof ConversationUnavailable) return null; throw error; }
  // OpenCode's store is read per request and keeps nothing for the pane to release
  if (resolved.source === "opencode-transcript") return opencodeImage(resolved.path, resolved.session, ref);
  rememberPaneRead(paneId, resolved.path);
  if (resolved.source === "codex-transcript") return codexTranscriptImage(codexHistorySegments(resolved.path, resolved.codexHome ?? codexHome), ref, pane.cwd);
  if (resolved.source === "pi-transcript") return piTranscriptImage(resolved.path, ref);
  return resolved.source === "claude-transcript" ? transcriptImage(resolved.path, ref) : null;
}

const IMAGE_REF = /^([0-9a-f-]{8,64}):(\d{1,3})$/i;

/** The image an image part's ref names in a Claude transcript file, decoded; null when there is none. */
export function transcriptImage(path: string, ref: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = IMAGE_REF.exec(ref);
  if (match === null) return null;
  const [, uuid, index] = match;
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  text = activeHistoryText(text, "claude-transcript");
  const needle = JSON.stringify(uuid);
  for (const line of text.split("\n")) {
    if (!line.includes(needle)) continue;
    let entry: TranscriptEntry;
    try { entry = JSON.parse(line) as TranscriptEntry; } catch { continue; }
    if (entry.uuid !== uuid || !Array.isArray(entry.message?.content)) continue;
    const block = entry.message.content[Number(index)] as { type?: unknown; source?: { type?: unknown; media_type?: unknown; data?: unknown } } | undefined;
    if (block?.type !== "image" || block.source?.type !== "base64" || typeof block.source.data !== "string") return null;
    const mediaType = String(block.source.media_type);
    if (!IMAGE_TYPES.has(mediaType)) return null;
    return { mediaType, bytes: new Uint8Array(Buffer.from(block.source.data, "base64")) };
  }
  return null;
}

const TOOL_REF = /^[A-Za-z0-9_:.-]{1,128}$/;
/** A whole output is still bounded: a page of it, not a log file. */
const TOOL_OUTPUT_MAX = 2_000_000;

/** The whole output of a tool call whose page output was cut, by its id; null when there is none. */
export async function toolOutput(paneId: string, ref: string, codexHome?: string, opencodeDb?: string, hermesHome?: string, grokHome?: string): Promise<string | null> {
  if (!TOOL_REF.test(ref)) return null;
  const snapshot = await sessionSnapshot();
  const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId);
  if (pane === undefined || typeof pane.cwd !== "string" || pane.cwd.length === 0) return null;
  let resolved: ResolvedTranscript;
  try { resolved = await resolveTranscript(pane, pane.cwd, codexHome, snapshot.panes, opencodeDb, hermesHome, grokHome); }
  catch (error) { if (error instanceof ConversationUnavailable) return null; throw error; }
  if (resolved.source === "opencode-transcript") {
    const output = opencodeToolOutput(resolved.path, resolved.session, ref);
    return output !== null && output.length > TOOL_OUTPUT_MAX ? `${output.slice(0, TOOL_OUTPUT_MAX)}\n… trimmed` : output;
  }
  rememberPaneRead(paneId, resolved.path);
  if (resolved.source === "hermes-transcript") return hermesToolOutput(resolved.sessionId, resolved.path, ref, TOOL_OUTPUT_MAX);
  const output = transcriptToolOutput(resolved.source, resolved.path, ref, resolved.codexHome ?? codexHome);
  if (resolved.agy && !sameAgyStore(resolved.agy, await resolveAgyStore(pane))) return null;
  return output;
}

/** The output a transcript file holds for one tool call id, whole (up to TOOL_OUTPUT_MAX). */
export function transcriptToolOutput(source: StreamSource, path: string, ref: string, codexHome?: string): string | null {
  if (!TOOL_REF.test(ref)) return null;
  if (source === "codex-transcript") {
    let segments: ReturnType<typeof codexHistorySegments>;
    try { segments = codexHistorySegments(path, codexHome); } catch { return null; }
    for (const segment of segments) {
      let text: string;
      // a rollout may have been archived since resolution: the others still hold theirs
      try { text = readRange(segment.path, 0, segment.end); } catch { continue; }
      const output = outputInText(source, text, ref);
      if (output !== null) return output;
    }
    return null;
  }
  if (source === "grok-transcript") return grokToolOutput(path, ref);
  if (source === "agy-transcript") return agyToolOutput(path, ref);
  if (source === "pi-transcript") return piToolOutput(path, ref);
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  return outputInText(source, text, ref);
}

/**
 * One whole tool output by ref. A pi output lives on the active branch only: reading the
 * file whole would answer a ref from a branch a /tree abandoned, whose output the chat
 * never showed, so the branch is read the way the conversation is.
 */
function piToolOutput(path: string, ref: string): string | null {
  let size: number;
  let branch: ReturnType<typeof piBranchSegments>;
  try { size = statSync(path).size; branch = piBranchSegments(path, size); } catch { return null; }
  if (branch === null) return null;
  // only a record that can be a clear or can hold the ref is parsed: an unrelated record (a picture
  // the agent read, a long tool result) is skipped on a substring check, as the segment reader did
  const needle = JSON.stringify(ref);
  let output: string | null = null;
  for (const line of piBranchRecords(path, size)) {
    if (line.includes("context_clear")) {
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      if (isContextClear(entry, "pi-transcript")) { output = null; continue; }
    }
    if (output === null && line.includes(needle)) output = outputInText("pi-transcript", line, ref);
  }
  return output;
}

/**
 * The image a pi tool call returned, by the ref the page gave it (`pi:<call id>:<nth image>`).
 * Like the output, it is read on the active branch only: an image from a branch a /tree
 * abandoned is one the chat never showed, so it is not offered.
 */
export function piTranscriptImage(path: string, ref: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = PI_IMAGE_REF.exec(ref);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const [, callId, nth] = match;
  let size: number;
  let branch: ReturnType<typeof piBranchSegments>;
  try { size = statSync(path).size; branch = piBranchSegments(path, size); } catch { return null; }
  if (branch === null) return null;
  for (const line of piBranchRecords(path, size)) {
    if (!line.includes(callId)) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = piMessage(entry);
    if (message === null) continue;
    const image = piImageBlock(message, callId, Number(nth));
    if (image !== null) return { mediaType: image.media_type, bytes: new Uint8Array(Buffer.from(image.data, "base64")) };
  }
  return null;
}

const PI_IMAGE_REF = /^pi:([A-Za-z0-9_:.\-]{1,128}):(\d{1,3})$/;

function outputInText(source: RecognizedConversation["source"], text: string, ref: string): string | null {
  text = activeHistoryText(text, source);
  const needle = JSON.stringify(ref);
  for (const line of text.split("\n")) {
    if (!line.includes(needle)) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    let output: string | null = null;
    if (source === "claude-transcript") {
      const content = (entry.message as { content?: unknown } | undefined)?.content;
      const result = Array.isArray(content) ? content.find((block) => (block as { type?: unknown; tool_use_id?: unknown } | null)?.type === "tool_result" && (block as { tool_use_id?: unknown }).tool_use_id === ref) : undefined;
      if (result !== undefined) output = claudeResultText((result as { content?: unknown }).content);
    } else if (source === "codex-transcript") {
      const payload = entry.payload as { type?: unknown; call_id?: unknown; output?: unknown } | undefined;
      if ((payload?.type === "function_call_output" || payload?.type === "custom_tool_call_output") && payload.call_id === ref) output = codexOutputText(payload.output);
    } else {
      const message = piMessage(entry);
      if (message) output = piResults(message).find((result) => result.id === ref)?.text ?? null;
    }
    if (output !== null) return output.length > TOOL_OUTPUT_MAX ? `${output.slice(0, TOOL_OUTPUT_MAX)}\n… trimmed` : output;
  }
  return null;
}

/** Asset reads share the reset boundary even when their ref predates /clear. */
function activeHistoryText(text: string, source: RecognizedConversation["source"]): string {
  if (source === "codex-transcript") return text;
  let start = 0, offset = 0;
  for (const line of text.split("\n")) {
    if (line.includes("context_clear") || line.includes("/clear")) {
      try { if (isContextClear(JSON.parse(line), source)) start = offset + line.length + 1; } catch { /* torn line */ }
    }
    offset += line.length + 1;
  }
  return text.slice(start);
}
