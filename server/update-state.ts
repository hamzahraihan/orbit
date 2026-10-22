/** Where app state lives. Dependency-free on purpose: the server and the plugin scripts import
 * it, and it must stay small. */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function defaultStateDir(): string {
  const override = process.env["HERDR_WEB_STATE_DIR"];
  if (override) return override;
  return join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "herdr-web-ui");
}

/** One update state per source checkout and port, so two checkouts or ports never share builds. */
export function updateStateDir(root: string, port: number, stateDir = defaultStateDir()): string {
  return join(resolve(stateDir), "updates",
    createHash("sha256").update(`${resolve(root)}:${port}`).digest("hex").slice(0, 16));
}
