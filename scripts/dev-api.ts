import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

/**
 * Dev only: `bun run dev` serves the client, whose proxy expects the API on :7317. A backend that
 * was never started (or was stopped) turns every client poll into an `http proxy error` stack in
 * the terminal, so Vite starts the API itself when nothing answers on that port. A server the user
 * runs by hand is left alone: any answer at all means the port is taken, and the API outlives
 * Vite's own restarts, so editing this config does not cut the panes attached to it. The API stops
 * when the `bun run dev` process exits, and its output shares Vite's terminal.
 *
 * An API this plugin started is restarted when `server/` or `shared/` changes, which is what
 * `bun run server` needs done by hand; a server the user runs keeps its own restart.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// a second checkout on one PC takes another Vite --port and another ORBIT_DEV_API_PORT
const API_HOST = `127.0.0.1:${process.env["ORBIT_DEV_API_PORT"] || "7317"}`;
/** The proxy's targets (vite.config.ts) and the port this plugin starts the API on, in one place. */
export const API_URL = `http://${API_HOST}`;
export const API_WS_URL = `ws://${API_HOST}`;
export const API_WS_URL_OVERRIDE = process.env["ORBIT_DEV_WS_URL"] ?? API_WS_URL;
const API_PORT = Number(API_HOST.split(":")[1]);
const API_HEALTH = `${API_URL}/api/health`;
const SOURCE = /\.(?:ts|tsx|js|mjs|cjs|json)$/;
const RESTART_DELAY_MS = 150;
const WATCHED = [join(ROOT, "server"), join(ROOT, "shared")];

/** Any answer at all means the port is taken, by this checkout's API or by another app. */
async function answers(): Promise<boolean> {
  try {
    await fetch(API_HEALTH, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

/** Vite re-evaluates this file for a config reload, so the child has to live outside the module. */
interface DevApiState {
  api: Bun.Subprocess | null;
  exitHooked: boolean;
}
const state: DevApiState = ((globalThis as { __orbitDevApi?: DevApiState }).__orbitDevApi ??= { api: null, exitHooked: false });

function killApi(): void {
  state.api?.kill();
  state.api = null;
}

async function spawnApi(server: ViteDevServer): Promise<void> {
  if (typeof Bun === "undefined") {
    server.config.logger.warn(`orbit: nothing answers on :${API_PORT}; start \`bun run server\` for the API`);
    return;
  }
  if (!state.exitHooked) {
    state.exitHooked = true;
    process.once("exit", killApi);
  }
  const child = Bun.spawn([process.execPath, "server/index.ts"], {
    cwd: ROOT,
    // the proxy names 7317, so a PORT in the shell must not move the API out from under it
    env: { ...process.env, PORT: String(API_PORT) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  state.api = child;
  // Hold Vite's first request until the API answers: a client loaded before it would repeat
  // exactly the proxy errors this plugin exists to prevent.
  const deadline = Date.now() + 10_000;
  while (!(await answers())) {
    if (child.exitCode !== null || Date.now() > deadline) {
      server.config.logger.warn(`orbit: the API did not answer on :${API_PORT}; its output is above`);
      return;
    }
    await Bun.sleep(50);
  }
}

/** Restart the API this plugin owns; one the user started is not ours to touch. */
async function restartApi(server: ViteDevServer): Promise<void> {
  if (state.api === null) return;
  state.api.kill();
  state.api = null;
  // A new server cannot bind while the old process still holds the port; wait it out, bounded.
  const deadline = Date.now() + 5000;
  while (await answers()) {
    if (Date.now() > deadline) {
      server.config.logger.warn(`orbit: the API is still on :${API_PORT}; restart \`bun run dev\` if it stopped responding`);
      return;
    }
    await Bun.sleep(25);
  }
  await spawnApi(server);
}

export function devApi(): Plugin {
  return {
    name: "orbit-dev-api",
    apply: "serve",
    async configureServer(server) {
      let restart: Promise<void> = Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = (): void => {
        restart = restart.then(() => restartApi(server)).catch((error: unknown) => {
          server.config.logger.warn(`orbit: could not restart the API: ${String(error)}`);
        });
      };
      server.watcher.on("all", (_event, file) => {
        if (state.api === null) return;
        if (!SOURCE.test(file) || !WATCHED.some((dir) => file.startsWith(`${dir}${sep}`))) return;
        clearTimeout(timer);
        timer = setTimeout(schedule, RESTART_DELAY_MS);
      });
      server.httpServer?.once("close", () => clearTimeout(timer));

      // A config reload builds a new server and a new watcher; the API it spawned is still ours.
      if (state.api !== null && state.api.exitCode === null) return;
      state.api = null;
      if (await answers()) return;
      await spawnApi(server);
    },
  };
}
