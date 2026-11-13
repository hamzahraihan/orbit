/**
 * OMP sessions from the pane's own process when Herdr supplies no usable session path.
 * Herdr deliberately omits recognized agents' argv on WSL to avoid blocking procfs reads.
 * Recover process identity outside the bridge, then use the open transcript or breadcrumb.
 */
import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import nodePath, { type PlatformPath } from "node:path";

import { agentGet, paneProcessInfo } from "./herdr/client.ts";
import { heldTranscript, runsAgent, storeRelative } from "./gjc-runtime.ts";
import { processEnviron } from "./omo.ts";
import { isWsl, ompProcessMemory } from "./omp-process.ts";
import { piTranscriptInStore, unwrittenSession } from "./pi.ts";
import { ConversationNotStarted, ConversationUnavailable, type ConversationPage, type NativeTranscript, type RecognizedConversation, type TranscriptSources } from "./conversation-shared.ts";
import { activeHistoryText, readTranscriptPage, resolveStream, type ParseTurns, type StreamSpec, type StreamStat } from "./conversation-reader.ts";
import { parseOmpTranscript, piMessage, piResults } from "./transcript-records.ts";
import { TOOL_OUTPUT_MAX, TOOL_REF } from "./tool-output.ts";
import { startScreenMetadata } from "./start-screen.ts";
import type { ProviderContext, TranscriptProvider } from "./conversation-providers.ts";
import type { HerdrPane } from "../shared/protocol.ts";

const OMP_EXECUTABLE = /(^|[\\/])omp(?:\.exe|\.[cm]?js)?$/i;

export function isOmpProcess(argv: readonly string[]): boolean {
  return runsAgent(argv, OMP_EXECUTABLE);
}

/**
 * The agent directory one omp process keeps its sessions and terminal breadcrumbs in:
 * ~/.omp/agent, or ~/.omp/profiles/<name>/agent under `--profile <name>` or OMP_PROFILE (the flag
 * wins). null when `--session-dir` moved its sessions anywhere at all, or the profile name could
 * leave ~/.omp/profiles.
 */
export function ompAgentDir(argv: readonly string[], environ: readonly string[] | null, home: string): string | null {
  let profile = environ?.find((word) => word.startsWith("OMP_PROFILE="))?.slice(12) || null;
  for (let at = 1; at < argv.length; at++) {
    const word = argv[at]!;
    if (word === "--session-dir" || word.startsWith("--session-dir=")) return null;
    if (word === "--profile") profile = argv[at + 1] ?? "";
    else if (word.startsWith("--profile=")) profile = word.slice(10);
  }
  if (profile === null) return join(home, ".omp", "agent");
  return /^[\w.-]+$/.test(profile) && profile !== "." && profile !== ".." ? join(home, ".omp", "profiles", profile, "agent") : null;
}

/** The transcript the pane's omp process holds open or last pointed its terminal breadcrumb at, or null. */
export async function ompHeldTranscript(paneId: string, cwd: string, home = process.env["HOME"] ?? ""): Promise<string | null> {
  const info = await paneProcessInfo(paneId).catch(() => null);
  let agentDir: string | null = null;
  const pids: number[] = [];
  const environs = new Map<number, readonly string[]>();
  for (const foreground of info?.foreground_processes ?? []) {
    if (typeof foreground.pid !== "number") continue;
    let argv = Array.isArray(foreground.argv) ? foreground.argv.map(String) : [];
    if (argv.length > 0 && !isOmpProcess(argv)) continue;
    // Herdr omits a recognized agent's argv on WSL; there, and only there, procfs memory reads
    // may block, so they go through the helper. Elsewhere herdr's argv and a direct read hold.
    const probe = process.platform === "linux" && (argv.length === 0 || isWsl());
    let environ: readonly string[] | undefined;
    if (probe) {
      const memory = await ompProcessMemory(foreground.pid, argv.length === 0);
      if (memory === null) continue;
      if (argv.length === 0) argv = memory.argv;
      environ = memory.environ;
    }
    if (!isOmpProcess(argv)) continue;
    const dir = ompAgentDir(argv, environ ?? processEnviron(foreground.pid), home);
    // a moved store, or two omp processes keeping different ones: nothing says which the pane shows
    if (dir === null || agentDir !== null && dir !== agentDir) return null;
    agentDir = dir;
    pids.push(foreground.pid);
    if (environ !== undefined) environs.set(foreground.pid, environ);
  }
  if (agentDir === null) return null;
  // a probed process's environment stands in for gjcTerminal's /proc read, which could block too
  return heldTranscript(agentDir, cwd, pids, (pid) => environs.get(pid)).path;
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
export async function ompTranscriptPath(paneId: string, cwd: string): Promise<string> {
  const info = await agentGet(paneId);
  const session = info.agent_session;
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

/** The transcript file this provider reads: its own source, or the answer the hub gives for one it does not know. */
function ompPath(resolved: NativeTranscript): string {
  if (resolved.source !== "omp-transcript") throw new ConversationUnavailable("no_recognized_transcript");
  return resolved.path;
}

/**
 * omp's provider: the session herdr or the pane's own process names, read through
 * the generic reader. Every method mirrors what the hub does for an omp pane today.
 */
export const ompProvider: TranscriptProvider = {
  async resolve(pane: HerdrPane, cwd: string, _sources: TranscriptSources, _panes?: HerdrPane[]): Promise<NativeTranscript> {
    return { source: "omp-transcript", path: await ompTranscriptPath(pane.pane_id, cwd) };
  },

  page(call: ProviderContext, page: ConversationPage): RecognizedConversation {
    const path = ompPath(call.resolved);
    let stat: StreamStat;
    try { stat = statSync(path); } catch { throw new ConversationUnavailable("transcript_missing"); }
    const spec: StreamSpec = { segments: [{ path, start: 0, end: stat.size }], chain: "" };
    const stream = resolveStream(call.reuse, "omp-transcript", path, stat, spec);
    const ompParse: ParseTurns = (_source, _p, text) => parseOmpTranscript(text, Infinity, {});
    return readTranscriptPage(stream, "omp-transcript", path, stat, page, ompParse);
  },

  async readImage(_call: ProviderContext, _ref: string) {
    return null;
  },

  readToolOutput(call: ProviderContext, ref: string): string | null {
    const path = ompPath(call.resolved);
    if (!TOOL_REF.test(ref)) return null;
    let text: string;
    try { text = readFileSync(path, "utf8"); } catch { return null; }
    text = activeHistoryText(text, "omp-transcript");
    const needle = JSON.stringify(ref);
    for (const line of text.split("\n")) {
      if (!line.includes(needle)) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const message = piMessage(entry);
      let output: string | null = null;
      if (message) output = piResults(message).find((result) => result.id === ref)?.text ?? null;
      if (output !== null) return output.length > TOOL_OUTPUT_MAX ? `${output.slice(0, TOOL_OUTPUT_MAX)}\n… trimmed` : output;
    }
    return null;
  },

  /** omp keeps no cache of its own beyond the hub's generic page cache. */
  invalidateCache(path?: string): void {
    void path;
  },

  startScreenMetadata(screen: string) {
    return startScreenMetadata("omp-transcript", screen);
  },

  mapError(error: unknown): ConversationUnavailable | ConversationNotStarted | null {
    if (error instanceof ConversationUnavailable || error instanceof ConversationNotStarted) return error;
    return null;
  },
};
