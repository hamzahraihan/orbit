/**
 * Stops what an interrupted check or browser run left behind.
 *
 * A check owns a process group and a herdr config of its own, and usually cleans both up when a
 * signal arrives. A tool that kills it outright skips that cleanup, and on Windows a detached
 * lane outlives its parent: the lane, its Chromium and its test herdr keep running, one browser
 * tree per script. This command finds those leftovers without touching a live run:
 *
 * - a stray lane or browser process whose parent chain no longer reaches a live process is
 *   killed with its tree (`taskkill /T /F` on Windows);
 * - this project's test herdr sessions (`herdr-web-ui-test`, `herdr-web-ui-demo`, a check's
 *   `check-…`) are stopped when no test or check process is active;
 * - an interrupted check's own directory (`hwc-…` in the temp dir) is removed with its sessions.
 *
 * A user's dev server, the app server and the default herdr session are not touched.
 * `bun run clean:processes --dry-run` lists what it would do.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { windowsProcessTable, type ProcessRow } from "../server/windows-processes.ts";
import { processAlive } from "./process-tree.ts";

const WINDOWS = process.platform === "win32";
const HERDR = process.env["HERDR_WEB_HERDR_BIN"] || "herdr";

export interface CleanupRow {
  pid: number;
  parent: number;
  commandLine: string;
  /** The executable's file name, when the platform reports it. */
  image?: string;
  started?: number;
}

/** A live process that owns what runs below it; a missing link below one of these is still a lost process. */
const ANCHORS: Record<string, true> = {
  explorer: true,
  herdr: true,
  omp: true,
  alacritty: true,
  wezterm: true,
  windowsterminal: true,
  cmd: true,
  powershell: true,
  pwsh: true,
  bash: true,
  zsh: true,
  sh: true,
  conhost: true,
  openconsole: true,
};

/** Whether a command line is one of this project's test or check processes. */
export function isTestArtifact(commandLine: string): boolean {
  const line = commandLine.replaceAll("\\", "/").toLowerCase();
  if (line.includes("clean-processes")) return false;
  // Playwright's own Chromium runs from its cache with a disposable profile, not from the repo.
  if (line.includes("playwright_chromiumdev_profile") || (line.includes("--user-data-dir=") && line.includes("herdr-"))) return true;
  return /(?:^|[\s"/])(?:scripts\/(?:check\.ts|ci-(?:tests|lanes|browser)|demo-build\.ts)|server\/pty\/pty-host\.mjs)/.test(line)
    || /(?:^|[\s"/])scripts\/[\w./-]*(?:-regression|-browser-qa|-qa|smoke)\.(?:ts|mjs)/.test(line)
    || /(?:^|[\s"/])scripts\/(?:fixtures|film|readme-media)\//.test(line);
}

/** Whether a process lost its root: Windows keeps a child's parent number after that parent exits, POSIX reparents it to 1. */
export function isOrphan(rows: readonly CleanupRow[], pid: number, windows = WINDOWS): boolean {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  let current = byPid.get(pid);
  while (current) {
    if (current.parent <= 0) return false;
    if (!windows && current.parent === 1) return true;
    if (seen.has(current.parent)) return false;
    seen.add(current.parent);
    const parent = byPid.get(current.parent);
    if (!parent) return windows;
    if (parent.image !== undefined && ANCHORS[parent.image.replace(/\.exe$/, "")]) return false;
    current = parent;
  }
  return windows;
}

export interface CleanupPlan {
  /** Test processes whose root is gone, and so may be killed. */
  orphans: CleanupRow[];
  /** A test or check process still runs under a live parent: its sessions and temp dir must stay. */
  active: boolean;
}

export function planCleanup(rows: readonly CleanupRow[]): CleanupPlan {
  const self = new Set<number>([process.pid]);
  for (let pid = process.ppid; pid > 0 && !self.has(pid);) {
    self.add(pid);
    pid = rows.find((row) => row.pid === pid)?.parent ?? 0;
  }
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const artifacts = new Set(rows.filter((row) => isTestArtifact(row.commandLine)).map((row) => row.pid));
  // a lane's children are its leftovers even when their own command line names no test script
  const partOfRun = (row: CleanupRow): boolean => {
    if (isTestArtifact(row.commandLine)) return true;
    const seen = new Set<number>();
    for (let parent = row.parent; parent > 0 && !seen.has(parent);) {
      if (artifacts.has(parent)) return true;
      seen.add(parent);
      parent = byPid.get(parent)?.parent ?? 0;
    }
    return false;
  };
  const candidates = rows
    .filter((row) => row.pid > 4 && !self.has(row.pid) && partOfRun(row))
    .map((row) => ({ row, orphan: isOrphan(rows, row.pid) }));
  return {
    orphans: candidates.filter((candidate) => candidate.orphan).map((candidate) => candidate.row),
    active: candidates.some((candidate) => !candidate.orphan),
  };
}

/** A herdr session this project's tests or checks own; the user's default and other sessions never match. */
export function isTestSession(name: string): boolean {
  return /^herdr-web-ui-(?:test|demo|task)[\w.-]*$/.test(name)
    || /^orbit-(?:docs|recheck)[\w.-]*$/.test(name)
    || /^check-[0-9a-f]{6}(?:-\d+)?$/.test(name);
}

async function processRows(): Promise<CleanupRow[]> {
  if (WINDOWS) {
    const table = await windowsProcessTable(15_000);
    return table.map((row: ProcessRow) => ({
      pid: row.pid,
      parent: row.parent,
      commandLine: row.commandLine ?? "",
      ...(row.path === null ? {} : { image: basename(row.path).toLowerCase() }),
      ...(row.started === undefined ? {} : { started: row.started }),
    }));
  }
  const listed = spawnSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8", timeout: 10_000 });
  return (listed.stdout ?? "").split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) return [];
    const commandLine = match[3]!;
    const first = /^\s*(?:"([^"]+)"|(\S+))/.exec(commandLine);
    const image = basename(first?.[1] ?? first?.[2] ?? "").toLowerCase();
    return [{ pid: Number(match[1]), parent: Number(match[2]), commandLine, ...(image === "" ? {} : { image }) }];
  });
}

function runningSessions(env: Record<string, string | undefined> = process.env): string[] {
  const listed = spawnSync(HERDR, ["session", "list", "--json"], { encoding: "utf8", env, timeout: 15_000, windowsHide: true });
  if (listed.status !== 0) return [];
  try {
    const parsed = JSON.parse(listed.stdout) as { sessions?: unknown };
    if (!Array.isArray(parsed.sessions)) return [];
    return parsed.sessions.flatMap((entry: unknown) => {
      if (entry === null || typeof entry !== "object") return [];
      const session = entry as { name?: unknown; running?: unknown };
      return typeof session.name === "string" && session.running === true ? [session.name] : [];
    });
  } catch {
    return [];
  }
}

/** The default isolation directories of interrupted checks and of browser-suite scratch space. */
function staleCheckDirs(): string[] {
  // Bun's `/tmp` is a directory of its own on Windows, while tmpdir() follows TMPDIR/TEMP.
  const bases = new Set([tmpdir(), ...(existsSync("/tmp") ? [resolve("/tmp")] : [])]);
  const found: string[] = [];
  for (const base of bases) {
    let names: string[];
    try {
      names = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^hwc-[A-Za-z0-9-]+$/.test(name)) continue;
      const directory = join(base, name);
      try {
        if (statSync(directory).isDirectory()) found.push(directory);
      } catch { /* gone meanwhile */ }
    }
  }
  return found;
}

async function kill(rows: readonly CleanupRow[]): Promise<{ killed: number; failed: number }> {
  const pids = rows.map((row) => row.pid);
  if (WINDOWS) {
    // One taskkill per lost tree; a tree rooted under another orphan goes with it. A root that
    // vanished first leaves its children for the second pass.
    for (const row of rows.filter((entry) => !pids.includes(entry.parent))) {
      spawnSync("taskkill", ["/pid", String(row.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    }
  } else {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch { /* already gone */ }
    }
    const termDeadline = Date.now() + 2_000;
    while (pids.some(processAlive) && Date.now() < termDeadline) await Bun.sleep(25);
  }
  for (const pid of pids.filter(processAlive)) {
    if (WINDOWS) spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    else {
      try {
        process.kill(pid, "SIGKILL");
      } catch { /* gone meanwhile */ }
    }
  }
  const deadline = Date.now() + 2_000;
  while (pids.some(processAlive) && Date.now() < deadline) await Bun.sleep(25);
  const failed = pids.filter(processAlive).length;
  return { killed: pids.length - failed, failed };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await processRows();
  if (rows.length === 0) {
    console.error("clean:processes: the process table could not be read");
    process.exit(1);
  }
  const plan = planCleanup(rows);
  const actions: string[] = [];

  if (plan.orphans.length > 0) {
    if (dryRun) {
      for (const row of plan.orphans) {
        const command = row.commandLine.length > 140 ? `${row.commandLine.slice(0, 140)}…` : row.commandLine;
        console.log(`would kill ${row.pid}: ${command}`);
      }
      actions.push(`would kill ${plan.orphans.length} orphaned test process${plan.orphans.length === 1 ? "" : "es"}`);
    } else {
      const { killed, failed } = await kill(plan.orphans);
      actions.push(`killed ${killed} orphaned test process${killed === 1 ? "" : "es"}`);
      if (failed > 0) actions.push(`${failed} could not be stopped`);
    }
  }

  if (plan.active) {
    actions.push("a test or check run is active, so its sessions and temp directories were left alone");
  } else {
    const stopped: string[] = [];
    for (const name of runningSessions()) {
      if (!isTestSession(name)) continue;
      if (dryRun) {
        stopped.push(name);
        continue;
      }
      if (spawnSync(HERDR, ["--session", name, "server", "stop"], { stdio: "ignore", timeout: 15_000, windowsHide: true }).status === 0) stopped.push(name);
    }
    if (stopped.length > 0) actions.push(`${dryRun ? "would stop" : "stopped"} ${stopped.length} test herdr session${stopped.length === 1 ? "" : "s"}: ${stopped.join(", ")}`);

    for (const directory of staleCheckDirs()) {
      const config = join(directory, "config");
      const sessions = join(config, "herdr", "sessions");
      for (const name of existsSync(sessions) ? readdirSync(sessions) : []) {
        if (!isTestSession(name)) continue;
        if (!dryRun) spawnSync(HERDR, ["--session", name, "server", "stop"], { env: { ...process.env, XDG_CONFIG_HOME: config }, stdio: "ignore", timeout: 15_000, windowsHide: true });
      }
      if (dryRun) {
        actions.push(`would remove ${directory}`);
      } else {
        rmSync(directory, { recursive: true, force: true });
        actions.push(`removed ${directory}`);
      }
    }
  }

  console.log(actions.length === 0 ? "clean:processes: nothing to clean" : `clean:processes: ${actions.join("; ")}`);
}

if (import.meta.main) await main();
