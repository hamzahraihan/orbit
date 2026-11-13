import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { createHash } from "node:crypto";

import { agentGet, paneProcessInfo } from "./herdr/client.ts";
import { runsAgent } from "./gjc-runtime.ts";
import { processEnviron } from "./omo.ts";
import { piAgentDir } from "./pi-models.ts";
import { activeHistoryText, readTranscriptPage, resolveStream, streamFiles, type ParseTurns, type StreamSpec, type StreamStat } from "./conversation-reader.ts";
import { forgetAllPiIndexes, forgetPiIndex, piAbandonedTurns, piBranchRecords, piBranchSegments } from "./pi-tree.ts";
import { isContextClear, parseOmpTranscript, piImageBlock, piMessage, piResults } from "./transcript-records.ts";
import { TOOL_OUTPUT_MAX, TOOL_REF } from "./tool-output.ts";
import { ConversationNotStarted, ConversationUnavailable, type ConversationPage, type NativeTranscript, type RecognizedConversation, type TranscriptSources } from "./conversation-shared.ts";
import { startScreenMetadata } from "./start-screen.ts";
import type { ProviderContext, TranscriptProvider } from "./conversation-providers.ts";
import type { HerdrPane } from "../shared/protocol.ts";

/**
 * pi's session store. `PI_CODING_AGENT_SESSION_DIR` moves it, exactly as CODEX_HOME
 * moves Codex's, and `PI_CODING_AGENT_DIR` moves the agent directory it sits in (seen on
 * pi 0.87.1: the store is `<agent dir>/sessions`); pi's `--session-dir` flag and its
 * `sessionDir` setting move it too, but this process cannot see either, so a pane started
 * that way keeps the terminal.
 */
export const defaultPiSessionDir = (): string =>
  process.env["PI_CODING_AGENT_SESSION_DIR"] || join(piAgentDir(), "sessions");

/**
 * The canonical file inside the store, or null. pi names an absolute path itself, so
 * the store is checked rather than trusted: a path elsewhere, a link out of it or a
 * non-session file is no evidence, and an unreadable store holds nothing readable.
 */
export function piTranscriptInStore(path: string, sessionDir: string): string | null {
  let canonical: string;
  let root: string;
  try {
    canonical = realpathSync(path);
    root = realpathSync(sessionDir);
  } catch { return null; }
  const inside = relative(root, canonical);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  if (!canonical.endsWith(".jsonl")) return null;
  // A directory wearing the extension answers no transcript read later: refuse it here.
  let fd: number | undefined;
  try {
    fd = openSync(canonical, constants.O_RDONLY | constants.O_NONBLOCK);
    return fstatSync(fd).isFile() ? canonical : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

const absent = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === "ENOENT";

/**
 * The session an agent named but has not written, or null. pi and omp write their file only
 * once the first answer is in (pi's SessionManager waits for an assistant message), so until
 * then the reported path does not exist. Only an absent `.jsonl` file whose nearest existing
 * ancestor is a directory inside the store, both resolved, counts: nothing is read from it,
 * its display id and canonical prospective path keep equally named sessions distinct.
 */
export function unwrittenSession(path: string, sessionDir: string): { id: string; path: string } | null {
  if (!isAbsolute(path) || !path.endsWith(".jsonl")) return null;
  let root: string;
  try { root = realpathSync(sessionDir); } catch { return null; }
  try {
    lstatSync(path);
    return null;
  } catch (error) { if (!absent(error)) return null; }
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    try {
      const real = realpathSync(dir);
      if (!statSync(real).isDirectory()) return null;
      const inside = relative(root, real);
      if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
      return { id: basename(path, ".jsonl"), path: join(real, relative(dir, path)) };
    } catch (error) {
      if (!absent(error) || dirname(dir) === dir) return null;
      // a link to nowhere is a place the agent cannot write to, not a directory still to come
      try { lstatSync(dir); return null; } catch (missing) { if (!absent(missing)) return null; }
    }
  }
}

const PI_EXECUTABLE = /(^|[\\/])pi(?:\.exe|\.[cm]?js)?$/i;
const PI_NPM_ENTRY = /(^|[\\/])node_modules[\\/]@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]bundle[\\/]cli\.js$/i;

type PiProcess = { pid?: number; name?: string; argv?: readonly string[] | null; cwd?: string | null };
type PiTranscriptOptions = {
  agent?: Awaited<ReturnType<typeof agentGet>> | null;
  processes?: readonly PiProcess[];
  environOf?: (pid: number) => readonly string[] | null;
  argvOf?: (pid: number) => readonly string[] | null;
  home?: string;
};

/** True for Pi's binary/script launch forms and the official npm bundle entry. */
function isPiProcess(argv: readonly string[]): boolean {
  return runsAgent(argv, PI_EXECUTABLE)
    || /(^|[\\/])(?:bun|node)(?:\.exe)?$/i.test(argv[0] ?? "") && PI_NPM_ENTRY.test(argv[1] ?? "");
}

/** Linux Herdr versions can omit argv; recover it from this foreground PID, never its name. */
function processArgv(pid: number): readonly string[] | null {
  if (process.platform !== "linux") return null;
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean); }
  catch { return null; }
}

type PiStoreResolution = { kind: "default" } | { kind: "store"; path: string } | { kind: "reject" };
type VerifiedPiProcess = Omit<PiProcess, "argv" | "pid"> & { pid: number; argv: readonly string[] };

/** Resolve only stores the pane's Pi process identifies; an unseen CLI override is unsafe. */
function piSessionDirForProcess(
  argv: readonly string[],
  environ: readonly string[] | null,
  home: string,
  cwd: string,
): PiStoreResolution {
  if (!isPiProcess(argv)) return { kind: "reject" };
  if (argv.some((word) => word === "--session-dir" || word.startsWith("--session-dir="))) return { kind: "reject" };
  if (environ === null) return { kind: "default" };
  const value = (name: string) => environ.find((word) => word.startsWith(`${name}=`))?.slice(name.length + 1) || null;
  const processHome = value("HOME") ?? value("USERPROFILE") ?? home;
  const sessionEntry = value("PI_CODING_AGENT_SESSION_DIR");
  const agentEntry = value("PI_CODING_AGENT_DIR");
  const raw = sessionEntry || (agentEntry ? join(agentEntry, "sessions") : join(processHome, ".pi", "agent", "sessions"));
  const expanded = raw === "~" ? processHome : raw.startsWith("~/") ? join(processHome, raw.slice(2)) : raw;
  if (!isAbsolute(expanded) && !cwd) return { kind: "reject" };
  return { kind: "store", path: resolve(isAbsolute(expanded) ? expanded : join(cwd, expanded)) };
}

/**
 * pi's transcript for a pane, or the session it has not written yet. The agent report names
 * the active session; Linux process metadata ties a custom store to the Pi process in this pane.
 * Where the OS cannot expose that process environment, only the bridge's default store is used.
 */
export async function piTranscriptPath(
  paneId: string,
  sessionDir = defaultPiSessionDir(),
  options: PiTranscriptOptions = {},
): Promise<{ path: string } | { unwritten: { id: string; path: string } } | null> {
  const agent = options.agent === undefined ? await agentGet(paneId).catch(() => null) : options.agent;
  const session = agent?.agent_session;
  if (agent?.agent !== "pi" || session?.agent !== "pi" || session.source !== "herdr:pi" || session.kind !== "path" || typeof session.value !== "string") return null;

  const info = options.processes === undefined
    ? await paneProcessInfo(paneId).catch(() => undefined)
    : { foreground_processes: [...options.processes] };
  const home = options.home ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const environOf = options.environOf ?? processEnviron;
  const argvOf = options.argvOf ?? processArgv;
  const piProcesses: VerifiedPiProcess[] = [];
  for (const entry of info?.foreground_processes ?? []) {
    if (typeof entry.pid !== "number") continue;
    const argv = entry.argv?.length ? entry.argv : argvOf(entry.pid);
    if (argv?.length) {
      if (isPiProcess(argv)) piProcesses.push({ ...entry, pid: entry.pid, argv });
    }
  }

  const processStores = new Set<string>();
  for (const process of piProcesses) {
    const resolved = piSessionDirForProcess(process.argv ?? [], environOf(process.pid!), home, process.cwd ?? "");
    if (resolved.kind === "reject") return null;
    processStores.add(resolved.kind === "store" ? resolved.path : sessionDir);
  }
  const canonicalProcessStores = new Set<string>();
  for (const store of processStores) {
    try { canonicalProcessStores.add(realpathSync(store)); } catch { /* an absent store holds no session */ }
  }
  if (canonicalProcessStores.size > 1) return null;
  const canonicalStores = new Set<string>();
  // A process-owned custom profile replaces the bridge default. Including both would let a
  // stale report from the bridge's unrelated profile appear valid for this pane.
  const candidateStores = piProcesses.length === 0 ? [sessionDir] : [...canonicalProcessStores];
  for (const store of candidateStores) {
    try { canonicalStores.add(realpathSync(store)); } catch { /* an absent store holds no session */ }
  }
  // Preserve default-store behavior on platforms where process_info names only the shell or
  // process environments cannot be read. A custom store is never guessed in those cases.
  const matches = [...canonicalStores].filter((store) => piTranscriptInStore(session.value, store) !== null || unwrittenSession(session.value, store) !== null);
  if (matches.length !== 1) return null;
  const path = piTranscriptInStore(session.value, matches[0]!);
  if (path !== null) return { path };
  const unwritten = unwrittenSession(session.value, matches[0]!);
  return unwritten === null ? null : { unwritten };
}

/** The image a pi tool call returned, by the ref the page gave it (`pi:<call id>:<nth image>`). */
export const PI_IMAGE_REF = /^pi:([A-Za-z0-9_:.\-]{1,128}):(\d{1,3})$/;

/** pi's tool output from one candidate line, read the way the page parses records. */
function piOutputInText(line: string, ref: string): string | null {
  const text = activeHistoryText(line, "pi-transcript");
  const needle = JSON.stringify(ref);
  for (const raw of text.split("\n")) {
    if (!raw.includes(needle)) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    const message = piMessage(entry);
    let output: string | null = null;
    if (message) output = piResults(message).find((result) => result.id === ref)?.text ?? null;
    if (output !== null) return output.length > TOOL_OUTPUT_MAX ? `${output.slice(0, TOOL_OUTPUT_MAX)}\n… trimmed` : output;
  }
  return null;
}

/**
 * The output a pi transcript holds for one tool call id, whole (up to TOOL_OUTPUT_MAX).
 * A pi output lives on the active branch only: reading the file whole would answer a ref
 * from a branch a /tree abandoned, whose output the chat never showed, so the branch is
 * read the way the conversation is.
 */
export function piToolOutput(path: string, ref: string): string | null {
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
    if (output === null && line.includes(needle)) output = piOutputInText(line, ref);
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

/** The transcript file this provider reads: its own source, or the answer the hub gives for one it does not know. */
function piPath(resolved: NativeTranscript): string {
  if (resolved.source !== "pi-transcript") throw new ConversationUnavailable("no_recognized_transcript");
  return resolved.path;
}

/**
 * pi's provider: the session herdr's agent.get names — or the pane's pi process adopts for a custom store —
 * read through the generic reader on the branch the leaf stands on. Every method mirrors
 * what the hub does for a pi pane today.
 */
export const piProvider: TranscriptProvider = {
  async resolve(pane: HerdrPane, _cwd: string, _sources: TranscriptSources, _panes?: HerdrPane[]): Promise<NativeTranscript> {
    const found = await piTranscriptPath(pane.pane_id);
    if (found === null) throw new ConversationUnavailable("no_session_path");
    if ("unwritten" in found) throw new ConversationNotStarted(found.unwritten.id, "pi-transcript", found.unwritten.path);
    return { source: "pi-transcript", path: found.path };
  },

  page(call: ProviderContext, page: ConversationPage): RecognizedConversation {
    const path = piPath(call.resolved);
    let stat: StreamStat;
    try { stat = statSync(path); } catch { throw new ConversationUnavailable("transcript_missing"); }
    const branch = piBranchSegments(path, stat.size);
    if (branch === null) throw new ConversationUnavailable("branch_unreadable");
    const segments = branch.map((segment) => ({ path, start: segment.start, end: segment.end }));
    const files = streamFiles(segments, path, stat);
    const layout = files.map((file, at) => (at === files.length - 1 ? `${file.offset}` : `${file.offset}\0${file.length}`)).join("\n");
    const chain = `-${createHash("sha256").update(layout).digest("base64url").slice(0, 10)}`;
    const spec: StreamSpec = { segments, chain };
    const stream = resolveStream(call.reuse, "pi-transcript", path, stat, spec);
    const piParse: ParseTurns = (_source, _p, text) => parseOmpTranscript(text, Infinity, { toolImages: true });
    return readTranscriptPage(stream, "pi-transcript", path, stat, page, piParse, { abandoned: (p, size) => piAbandonedTurns(p, size) ?? undefined });
  },

  async readImage(call: ProviderContext, ref: string) {
    const path = piPath(call.resolved);
    return piTranscriptImage(path, ref);
  },

  readToolOutput(call: ProviderContext, ref: string): string | null {
    const path = piPath(call.resolved);
    if (!TOOL_REF.test(ref)) return null;
    return piToolOutput(path, ref);
  },

  invalidateCache(path?: string): void {
    if (path === undefined) forgetAllPiIndexes();
    else forgetPiIndex(path);
  },

  startScreenMetadata(screen: string) {
    return startScreenMetadata("pi-transcript", screen);
  },

  mapError(error: unknown): ConversationUnavailable | ConversationNotStarted | null {
    if (error instanceof ConversationUnavailable || error instanceof ConversationNotStarted) return error;
    return null;
  },
};
