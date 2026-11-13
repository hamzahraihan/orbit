/**
 * Claude Code's own transcript: the parser that turns one session file into turns, and
 * the provider that reads the store it lives in.
 *
 * The file is `<config dir>/projects/<project>/<session>.jsonl` (claude-store.ts finds it).
 * Inside it Claude Code records the prompts, the answers, the tool calls and their results,
 * the skill invocations, the notices it writes instead of answering (a refused slash command,
 * a usage limit), the images pasted into a prompt and the subagent tasks it started.
 *
 * The parser here is pure: text in, turns out. Which file a pane's session is in, and when
 * that session has written nothing yet, is the store's business (claude-store.ts), and the
 * `claudeProvider` below is what the hub asks for a page, an image or a tool output.
 *
 * Must NOT:
 *   - Import server/conversation.ts (the hub): a provider module that imports the hub back
 *     makes a runtime cycle (server/conventions.test.ts keeps both edges one-way).
 *   - Change how a Claude transcript is parsed: the options (`maxTurns`, `subagents`,
 *     `noticed`) and every reason code stay exactly as they were.
 */

import { readFileSync, statSync } from "node:fs";

import type { ConversationPart, ConversationTurn, HerdrPane } from "../shared/protocol.ts";
import { lineNotifications, subagentDetails, taskNotification, type SubagentDetail } from "./claude-subagents.ts";
import { AmbiguousClaudeStore, claudeProcessSession, claudeTranscriptFile, defaultClaudeConfigDir, forgetClaudeSessionFile, forgetClaudeSessions, isClaudeProcess, processClaudeConfigDir } from "./claude-store.ts";
import { ConversationNotStarted, ConversationUnavailable, type ConversationPage, type NativeTranscript, type TranscriptSources } from "./conversation-shared.ts";
import type { ProviderContext, TranscriptProvider } from "./conversation-providers.ts";
import { activeHistoryText, isCommandEntry, readTranscriptPage, resolveStream, type ParseTurns, type StreamSpec, type StreamStat, type TranscriptEntry } from "./conversation-reader.ts";
import { herdrRpc } from "./herdr/client.ts";
import { processStartedAt } from "./process-start.ts";
import { invokedSkill } from "./skill-activity.ts";
import { claudeCommandEcho } from "./skill-invocations/claude.ts";
import { startScreenMetadata } from "./start-screen.ts";
import { TOOL_OUTPUT_MAX, TOOL_REF, trimOutput } from "./tool-output.ts";
import { agentTaskResult, claudePeerId, claudePeerNotice, isContextClear, MAX_TURNS, toolSummary } from "./transcript-records.ts";

/** A command's answer is a notice, not a log: the rest of a long one stays in the terminal. */
const LOCAL_COMMAND_MAX_CHARS = 4000;

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
 * What a slash command printed, from the `local_command` entry Claude Code records it in. The
 * command's echo (`<command-name>…`) is a separate entry with no output tag, and reads as nothing.
 */
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

/** The text a tool result carries: a string, or the parts of an array. */
export function claudeResultText(output: unknown): string {
  return typeof output === "string" ? output
    : Array.isArray(output) ? output.map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : "")).join("")
      : "";
}

/** The image types a chat shows; anything else stays out of the page. */
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

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

/** What the meta files of the subagents a Claude page's notifications name say of them: read only when the page has one. */
export function subagentsOnPage(path: string, text: string): ReadonlyMap<string, SubagentDetail> | undefined {
  if (!text.includes("<task-notification>")) return undefined;
  // ids come from notifications only: other text on the page (a fetched web page) can hold the tag too
  const ids = new Set<string>();
  for (const line of text.split("\n")) for (const notice of lineNotifications(line)) if (notice.agent) ids.add(notice.taskId);
  return ids.size === 0 ? undefined : subagentDetails(path, ids);
}

/** Session ids are uuids; refusing anything else keeps the path traversal-free. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
export async function claudeTranscriptPath(paneId: string, cwds: readonly (string | null | undefined)[], onProcess?: (pid: number) => void): Promise<string> {
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

/** The ref an image part carries in a Claude transcript (`<entry uuid>:<block index>`). */
export const IMAGE_REF = /^([0-9a-f-]{8,64}):(\d{1,3})$/i;

/**
 * One image a user pasted into a Claude prompt, by the ref its image part carries
 * (`<entry uuid>:<block index>`): the transcript holds it as base64, so it is decoded
 * here rather than sent with every poll of the conversation. Null when there is no such
 * image.
 */
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

/** The result a Claude transcript entry carries for one tool_use id; null when it carries none. */
export function claudeToolResult(entry: unknown, ref: string): string | null {
  const content = (entry as { message?: { content?: unknown } } | undefined)?.message?.content;
  const result = Array.isArray(content)
    ? content.find((block) => (block as { type?: unknown; tool_use_id?: unknown } | null)?.type === "tool_result" && (block as { tool_use_id?: unknown }).tool_use_id === ref)
    : undefined;
  if (result === undefined) return null;
  return claudeResultText((result as { content?: unknown }).content);
}

/**
 * The whole output of a tool call a Claude transcript answers, by its tool_use id; null when
 * the transcript answers none. The output is bounded: a page of it, not a log file.
 */
export function claudeToolOutput(path: string, ref: string): string | null {
  if (!TOOL_REF.test(ref)) return null;
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  text = activeHistoryText(text, "claude-transcript");
  const needle = JSON.stringify(ref);
  for (const line of text.split("\n")) {
    if (!line.includes(needle)) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    const output = claudeToolResult(entry, ref);
    if (output !== null) return output.length > TOOL_OUTPUT_MAX ? `${output.slice(0, TOOL_OUTPUT_MAX)}\n… trimmed` : output;
  }
  return null;
}

/** How a Claude page is parsed: the subagents its notifications name, and the completions already drawn. */
const claudeParse: ParseTurns = (_source, path, text, _taskTitles, noticed) =>
  parseClaudeTranscript(text, Infinity, { subagents: subagentsOnPage(path, text), noticed });

/** The transcript file this provider reads: its own source, or the answer the hub gives for one it does not know. */
function claudePath(resolved: NativeTranscript): string {
  if (resolved.source !== "claude-transcript") throw new ConversationUnavailable("no_recognized_transcript");
  return resolved.path;
}

/**
 * Claude Code's provider: the store it writes, read through the generic reader.
 *
 * Every method mirrors what the hub does for a Claude pane today, one for one: the same
 * calls, the same reads, the same reason codes.
 */
export const claudeProvider: TranscriptProvider = {
  /** The session herdr names, or the one live Claude's own record names, and the file it writes. */
  async resolve(pane: HerdrPane, cwd: string, _sources: TranscriptSources, _panes?: HerdrPane[]): Promise<NativeTranscript> {
    return { source: "claude-transcript", path: await claudeTranscriptPath(pane.pane_id, [cwd, pane.foreground_cwd]) };
  },

  /** One page of the transcript: the whole file as one stream, parsed by Claude's own parser. */
  page(call: ProviderContext, page: ConversationPage) {
    const path = claudePath(call.resolved);
    let stat: StreamStat;
    try { stat = statSync(path); } catch { throw new ConversationUnavailable("transcript_missing"); }
    const spec: StreamSpec = { segments: [{ path, start: 0, end: stat.size }], chain: "" };
    const stream = resolveStream(call.reuse, "claude-transcript", path, stat, spec);
    return readTranscriptPage(stream, "claude-transcript", path, stat, page, claudeParse);
  },

  /** The image a pasted image part's ref names, decoded from the transcript's own base64. */
  async readImage(call: ProviderContext, ref: string) {
    return transcriptImage(claudePath(call.resolved), ref);
  },

  /** The whole output of the tool call a ref names, read from the transcript. */
  readToolOutput(call: ProviderContext, ref: string) {
    return claudeToolOutput(claudePath(call.resolved), ref);
  },

  /** What one scan remembered about the store (one file), or all of it when no file is named. */
  invalidateCache(path?: string): void {
    if (path === undefined) forgetClaudeSessions();
    else forgetClaudeSessionFile(path);
  },

  /** The model and effort Claude Code's own screen states before its first turn. */
  startScreenMetadata(screen: string) {
    return startScreenMetadata("claude-transcript", screen);
  },

  /** Claude's own errors: two stores claiming one process, and the errors the hub already speaks. */
  mapError(error: unknown): ConversationUnavailable | ConversationNotStarted | null {
    if (error instanceof AmbiguousClaudeStore) return new ConversationUnavailable("no_session_id");
    if (error instanceof ConversationUnavailable) return error;
    return null;
  },
};
