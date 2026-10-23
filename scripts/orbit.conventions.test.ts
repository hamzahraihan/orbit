import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, files, matches, repo } from "./source-scan.ts";

/**
 * Orbit's own rules, added as features were removed. Upstream's rules live in
 * scripts/conventions.test.ts (repo-wide), server/conventions.test.ts and src/conventions.test.ts.
 * Each `it` here names a service Orbit does not talk to, so a removed feature
 * cannot come back through a merge or a cherry-picked upstream commit.
 */

/** Every source file that ships: not tests. */
const SOURCES = [...files("{src,server,shared,scripts}/**/*.{ts,tsx,mjs,cjs,js}"), "vite.config.ts"];

/** The modules Orbit removed, and the files that must not come back. */
function absent(removed: string[]): string[] {
  return removed.filter((file) => existsSync(join(repo, file)));
}

describe("Orbit's removed features", () => {
  it("sends nothing to the telemetry worker", () => {
    const offenders = matches(SOURCES.filter((file) => !file.endsWith(".test.ts")), /herdr-web-ui-telemetry\.devswha\.workers\.dev/).map((match) => match.at);
    fail(offenders, "Orbit removed the anonymous usage counts: no source file may name the telemetry worker.");
    expect(offenders).toEqual([]);
  });

  it("does not poll for app updates", () => {
    const present = absent([
      "server/updater.ts",
      "server/supervisor.ts",
      "src/lib/updates.ts",
      "src/lib/updateNotes.ts",
      "src/lib/updateProgress.ts",
    ]);
    fail(present, "Orbit removed the app update checks: the updater and its supervisor must not come back.");
    expect(present).toEqual([]);
    // the remote-PC bundle URL is Task 6's business: it names the upstream releases until
    // Task 6 repoints it, and Task 6's own guard covers that file
    // (a path is written the way the platform writes it, so the name is compared without it)
    const portable = (file: string): string => file.replaceAll("\\", "/");
    const offenders = matches(SOURCES.filter((file) => !file.endsWith(".test.ts") && portable(file) !== "server/remote-bundle.ts"), /github\.com\/devswha\/herdr-web-ui\/releases/).map((match) => match.at);
    fail(offenders, "Orbit removed the app update checks: no source file may poll the upstream releases.");
    expect(offenders).toEqual([]);
  });

  it("does not read a provider account for a usage meter", () => {
    const present = absent([
      "server/usage.ts",
      "server/usage-login.ts",
      "shared/usage-login.ts",
      "src/lib/usage.ts",
      "src/components/UsageMeters.tsx",
      "src/components/UsageSettings.tsx",
      "server/cliproxy.ts",
    ]);
    fail(present, "Orbit removed the subscription usage meters: the provider adapters must not come back.");
    expect(present).toEqual([]);
    const offenders = matches(SOURCES.filter((file) => !file.endsWith(".test.ts")),
      /api\.anthropic\.com\/api\/oauth\/usage|chatgpt\.com\/backend-api\/wham\/usage|api2\.cursor\.sh|cli-chat-proxy\.grok\.com|cloudcode-pa\.googleapis\.com|opencode\.ai\/zen/).map((match) => match.at);
    fail(offenders, "Orbit removed the subscription usage meters: no source file may read a provider's usage endpoint.");
    expect(offenders).toEqual([]);
  });

  it("runs no relay of the author's", () => {
    const present = absent([
      "server/portal.ts",
      "src/components/PortalPanel.tsx",
      "src/lib/portal.ts",
    ]);
    fail(present, "Orbit removed the Portal relay: the portal service must not come back.");
    expect(present).toEqual([]);
    const offenders = matches(SOURCES.filter((file) => !file.endsWith(".test.ts")), /\bportal expose\b|--strip-request-header\b/).map((match) => match.at);
    fail(offenders, "Orbit removed the Portal relay: no source file may drive the portal binary.");
    expect(offenders).toEqual([]);
  });
});
