/**
 * Ends a step's whole process tree.
 *
 * POSIX steps lead a process group (`detached: true` at spawn), and the group is signalled as
 * one. Windows has neither process groups nor a graceful signal for console programs, so a live
 * leader is ended with `taskkill /T /F`. Windows keeps a child's parent number after that parent
 * exits, so a tree whose leader already ended is still found by walking the process table from
 * the dead number; this is what ends the servers and browsers a lane left holding its output.
 */
import { spawnSync } from "node:child_process";
import { descendantProcesses, windowsProcessTable, type ProcessRow } from "../server/windows-processes.ts";

const WINDOWS = process.platform === "win32";
/** How long a step's processes get to end after a signal before they are killed. */
const END_GRACE_MS = 5_000;
const POLL_MS = 25;

/** Whether `pid` names a live process. An exit nobody has reaped yet still counts as live. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Ends the tree `root` leads, returning whether every process in it is gone.
 * …
 * `startedAfter` keeps the table sweep to processes that started after the step did: a number
 * Windows has reused for another process must not take that process's children with it.
 */
export async function endProcessTree(
  root: number,
  signal: NodeJS.Signals = "SIGTERM",
  { graceMs = END_GRACE_MS, startedAfter }: { graceMs?: number; startedAfter?: number } = {},
): Promise<boolean> {
  if (root <= 0) return true;
  return WINDOWS ? endWindowsTree(root, graceMs, startedAfter) : endPosixGroup(root, signal, graceMs);
}

async function endPosixGroup(root: number, signal: NodeJS.Signals, graceMs: number): Promise<boolean> {
  // only "no such process" says the group is empty: a process that may not be signalled is still there
  const none = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ESRCH";
  const left = (): boolean => {
    try {
      process.kill(-root, 0);
      return true;
    } catch (error) {
      return !none(error);
    }
  };
  try {
    process.kill(-root, signal);
  } catch (error) {
    if (none(error)) return true;
  }
  if (await waitFor(left, graceMs)) return true;
  try {
    process.kill(-root, "SIGKILL");
  } catch (error) {
    if (none(error)) return true;
  }
  return waitFor(left, 2_000);
}

const waitFor = async (left: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (left()) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(POLL_MS);
  }
  return true;
};

async function endWindowsTree(root: number, graceMs: number, startedAfter: number | undefined): Promise<boolean> {
  if (processAlive(root)) {
    // Console programs ignore taskkill's graceful request, so the tree is ended in one forced pass.
    spawnSync("taskkill", ["/pid", String(root), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return waitFor(() => processAlive(root), 2_000);
  }
  const rows = await windowsProcessTable(Math.max(1_000, graceMs));
  const pids = descendants(rows, root, startedAfter);
  for (const pid of pids) spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  return waitFor(() => pids.some(processAlive), 2_000);
}

/** The pids below `root` in the table that could have started with the step. */
function descendants(rows: readonly ProcessRow[], root: number, startedAfter: number | undefined): number[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  return descendantProcesses(rows, root).flatMap(({ pid }) => {
    const row = byPid.get(pid);
    // a number Windows reused for a process that started after the step cannot be ours
    if (!row || (startedAfter !== undefined && row.started !== undefined && row.started < startedAfter)) return [];
    return [pid];
  });
}
