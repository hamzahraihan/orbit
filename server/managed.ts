/**
 * Stable entry for `bun run start` and the herdr plugin (whose PID file records this process).
 * It runs the server from this checkout and forwards its exit code. Orbit has no release
 * channel, so there is no supervisor to hand over to: the server runs until it stops.
 */
import { join, resolve } from "node:path";

export async function runManaged(root = resolve(import.meta.dir, "..")) {
  root = resolve(root);
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => { stopping = true; child?.kill(signal); };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  child = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts")], {
    cwd: root, windowsHide: true, stdin: "ignore", stdout: "inherit", stderr: "inherit",
    env: { ...process.env, HERDR_WEB_SOURCE_ROOT: root },
  });
  const code = await child.exited;
  if (stopping) process.exit(0);
  process.exit(code ?? 1);
}

if (import.meta.main) await runManaged();
