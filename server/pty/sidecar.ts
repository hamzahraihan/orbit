import type { HerdrIdentity } from "../../shared/machines.ts";

/**
 * A terminal attach runs on the PTY sidecar: `node pty-host.mjs`, which imports
 * @lydell/node-pty. A runtime without either (the win32 remote bundle ships Bun alone)
 * cannot start it, whatever herdr itself can do, so its panes stay mirrored.
 */
export interface SidecarRuntime {
  node: () => boolean;
  pty: () => boolean;
}

/** a node that hangs must not hold the server: no answer in this long counts as no Node */
const PROBE_TIMEOUT_MS = 3000;

/**
 * `bun run` puts a `node` that is Bun itself first on PATH when the PC has none, and
 * node-pty must not load in Bun (oven-sh/bun#18546): only a `node` that is Node counts.
 * The probe is written for any Node, however old (no `??`).
 */
export function isRealNode(executable: string, env: Record<string, string | undefined> = process.env, timeoutMs = PROBE_TIMEOUT_MS): boolean {
  try {
    const asked = Bun.spawnSync([executable, "-p", "process.versions.bun || ''"], { env, windowsHide: true, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: timeoutMs });
    return asked.success && asked.stdout.toString().trim() === "";
  } catch {
    return false;
  }
}

/**
 * Looked up on the PATH the sidecar's spawn inherits (PtySession passes process.env), not the
 * one this process was launched with: a remote bundle adds its own bin/ at runtime
 * (server/remote-entry.ts), and a bare Bun.which() would not see the Node shipped there.
 */
function nodeOnPath(): boolean {
  const found = Bun.which("node", { PATH: process.env["PATH"] ?? "" });
  return found !== null && isRealNode(found);
}

const here: SidecarRuntime = {
  node: nodeOnPath,
  pty: () => {
    try {
      Bun.resolveSync("@lydell/node-pty", import.meta.dir);
      return true;
    } catch {
      return false;
    }
  },
};

/** How long a missing sidecar is trusted before it is looked for again: a Node or node-pty installed mid-life counts without a restart. */
const MISSING_RETRY_MS = 10_000;

/**
 * A probe whose answer is cached. A sidecar that runs stays the answer (each probe spawns Node
 * for nothing), while a missing one is looked for again after MISSING_RETRY_MS, so installing
 * Node or node-pty later, or a PATH change, is reflected.
 */
export function createSidecarProbe(runtime: SidecarRuntime, now: () => number = Date.now): () => boolean {
  let known: boolean | null = null;
  let knownAt = 0;
  return () => {
    if (known === true) return true;
    if (known === false && now() - knownAt < MISSING_RETRY_MS) return false;
    known = runtime.pty() && runtime.node();
    knownAt = now();
    return known;
  };
}

/** Whether this runtime can run the PTY sidecar: every caller (attach, /api/health, /api/bridge) asks at the moment it answers. */
export const sidecarAvailable = createSidecarProbe(here);

/** herdr's identity as this bridge can serve it: without the sidecar, told the way a herdr that cannot attach tells it. */
export function attachableIdentity(identity: HerdrIdentity, sidecar: boolean): HerdrIdentity {
  if (sidecar || identity.terminal_attach === false) return identity;
  return { ...identity, terminal_attach: false, terminal_mirror: true };
}
