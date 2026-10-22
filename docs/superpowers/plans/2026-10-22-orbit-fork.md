# Orbit Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `devswha/herdr-web-ui` into `hamzahraihan/orbit` — a local-first fork with telemetry, app update checks, usage meters and the author-operated portal relay removed, and the remote-PC bundle repointed at the fork.

**Architecture:** Eight sequential commits on `main`, each ending with a green typecheck + build + test gate. Five feature areas are removed from one codebase; the coupling between them concentrates in four shared files (`shared/protocol.ts`, `shared/update.ts`, `src/lib/settings.ts`, `src/lib/api.ts`), each edited exactly once. Every removal is pinned by a permanent source-scanning guard in `scripts/orbit.conventions.test.ts`, so a removed feature cannot quietly return. The base is upstream `main` at `97a48035` — the commit that was running on this machine.

**Tech Stack:** Bun 1.4.2 · TypeScript · React 19 · Vite (rolldown) · Bun test · herdr 0.9.5

**Spec:** `docs/superpowers/specs/2026-10-22-orbit-fork-design.md` — read it before Task 1. It carries the per-area file inventory with line numbers; this plan carries the executable steps.

**Acronym:** Orbit = **O**rchestrated **R**emote **B**ackground **I**ntegration **T**erminal.

## Global Constraints

- Working directory for every task: `C:\herdr-plugins-project\orbit`
- Base commit is `97a48035`; `origin` is `github.com/hamzahraihan/orbit` (public); `upstream` is `github.com/devswha/herdr-web-ui` and is **read-only** — never `git merge upstream/main`
- Plugin id is `hamzahraihan.orbit`; qualified actions are `hamzahraihan.orbit.<action>`; local action ids stay `start`, `start-windows`, `stop`, `stop-windows`, `status`, `status-windows`, `phone`, `phone-windows`
- Package name is `orbit`, version is `0.5.0`
- The MIT licence and its copyright notice (`Copyright (c) 2026 devswha`) are retained verbatim in `LICENSE`; `NOTICE` records the fork
- The remote-PC bundle URL must point at `github.com/hamzahraihan/orbit` and **never** at `devswha`
- No telemetry, update-check, usage-meter or portal code may survive in `server/`, `shared/`, `src/`, `scripts/` or `dist/`
- **Every task's gate:** `bun run typecheck`, `bun run build`, `bun scripts/ci-tests.ts unit` and `bun scripts/ci-tests.ts integration` all exit 0
- `herdr plugin link` does **not** run build commands, so `bun install` and `bun run build` must run before the plugin is linked (Task 8)
- The build is `bun --bun vite build` and takes ~90s; the baseline is verified green at `97a48035`
- **No Docker.** Nothing in this plan uses it. The two upstream scripts named `fresh-install-docker.ts` and `ssh-password-docker.ts` are not `*.test.ts` files, so no test lane runs them; `scripts/self-hosted-runner.test.ts` writes a fake `docker` shell script into a temp directory and asserts on it. The test lanes use the local `herdr` binary and a `herdr-web-ui-test` session. Do not install, start or shell out to Docker

## Review Focus

The five inputs most likely to bite a person using Orbit, most likely first. Each line gets its test in the task that owns the code.

1. **A `dist/` that is stale or absent.** `herdr plugin link` does not run build commands, so the server serves whatever `dist/` holds. A stale bundle keeps the removed features alive in the browser even though the server routes are gone. → Task 1 builds it; Task 8 rebuilds before linking; Task 8 greps `dist/`.
2. **A settings payload from an older browser still carrying removed keys** (`showUsage`, `usageCount`, `usageGlance`, `usageOrder`, `usageHidden`). The shared-preferences endpoint and the settings sanitiser must ignore unknown keys, not crash on them. → Task 4.
3. **A persisted `telemetry.json` left in the state dir.** The file stays on disk after the code is gone; nothing may read it and nothing may send it. → Task 2.
4. **A browser tab that loaded the pre-removal bundle** calls `/api/telemetry` and gets `404 not_found`. The app must treat that as "no telemetry" — no error surfaced, no retry loop. → Task 2.
5. **The remote-PC manifest for `remote-v31`.** It must exist in `hamzahraihan/orbit`; a remote PC must never be pointed at `devswha`'s release, and a missing manifest must fail loudly rather than silently fall back to someone else's bundle. → Task 6 and Task 8.

---

## File Structure

**New files**

| Path | Responsibility |
| --- | --- |
| `NOTICE` | Records that Orbit is a modified fork of `devswha/herdr-web-ui`, retaining the MIT notice |
| `scripts/orbit.conventions.test.ts` | The permanent guard: no source file may reference a removed service's host, and no removed module may exist. One `it()` is added per removed area |
| `docs/superpowers/plans/2026-10-22-orbit-fork.md` | This plan |

**Files deleted** (grouped by the task that deletes them)

| Task | Deleted |
| --- | --- |
| 2 | `server/telemetry.ts`, `server/telemetry.test.ts`, `shared/telemetry.ts`, `src/components/TelemetryControls.tsx`, `telemetry/` (6 files), `scripts/telemetry-deployed.test.ts`, `scripts/telemetry-regression.ts` |
| 3 | `server/updater.ts`, `server/updater.test.ts`, `server/supervisor.ts`, `server/release-notes.ts`, `server/release-notes.test.ts`, `src/lib/updates.ts`, `src/lib/updateNotes.ts`, `src/lib/updateNotes.test.ts`, `src/lib/updateProgress.ts`, `src/lib/updateProgress.test.ts` |
| 4 | `server/usage.ts`, `server/usage.test.ts`, `server/usage-login.ts`, `server/usage-login.contract.test.ts`, `shared/usage-login.ts`, `src/lib/usage.ts`, `src/lib/usage.test.ts`, `src/components/UsageMeters.tsx(.css)`, `UsageSettings.tsx(.css)`, `UsageAccountDialog.tsx(.css)`, `UsageHubConnect.tsx`, `UsageLocalLogin.tsx`, `CLIProxyLogin.tsx`, `server/cliproxy.ts`, `server/cliproxy-routes.ts`, `server/cliproxy.test.ts`, `server/cliproxy.fake.ts`, `scripts/usage-regression.ts` |
| 5 | `server/portal.ts`, `server/portal.test.ts`, `src/components/PortalPanel.tsx(.css)`, `src/lib/portal.ts`, `scripts/portal-regression.ts` |

**Files heavily edited** (one commit each): `server/index.ts`, `server/core/status.ts`, `server/update-api.ts`, `server/managed.ts`, `server/update-state.ts`, `shared/protocol.ts`, `shared/update.ts`, `shared/preferences.ts`, `src/App.tsx`, `src/components/SettingsDialog.tsx`, `src/components/UpdateControls.tsx`, `src/lib/api.ts`, `src/lib/settings.ts`, `src/lib/paletteSettings.ts`, `src/lib/runningVersion.ts`, `src/components/Composer.tsx`, `src/components/MachineSidebar.tsx`.

**Files edited for i18n** (`src/lib/i18n.ja.ts`, `i18n.ko.ts`, `i18n.zh.ts`): the dictionary entries for each removed feature ship **in the same commit** as the code that used them — `src/lib/i18n.test.ts` fails on an entry nothing uses.

---

### Task 1: Rename Orbit and prove the baseline

**Files:**
- Modify: `package.json`
- Modify: `herdr-plugin.toml`
- Create: `NOTICE`
- Modify: 35 files in the reference sweep (list in Step 5)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the plugin id `hamzahraihan.orbit` and package `orbit@0.5.0` that every later task's manifest and config paths depend on

- [ ] **Step 1: Confirm the baseline is green before touching anything**

```bash
cd C:\herdr-plugins-project\orbit
bun install
bun run typecheck
bun run build
```

Expected: `bun install` reports `232 packages installed`; typecheck exits 0; build prints `✓ built in`. If the build fails here, stop — the fork is broken before any surgery and every later diagnosis becomes ambiguous.

- [ ] **Step 2: Rename the package**

In `package.json`, change exactly these lines:

```json
  "name": "orbit",
  "version": "0.5.0",
  "description": "Orchestrated Remote Background Integration Terminal - a local-first browser and phone client for herdr",
```

and the repository block:

```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/hamzahraihan/orbit.git"
  },
```

`bun.lock` records the root package's name, so it goes stale the moment `package.json` changes.
Refresh it and commit the result, or CI's `bun install --frozen-lockfile` (ten workflows use it)
fails on the name mismatch:

```bash
bun install
git diff --stat bun.lock
```

Expected: `bun.lock` changes on exactly one line — the root workspace's `"name"` becomes `"orbit"`.
No dependency version may move. If a version moved, the install resolved something new: revert
`bun.lock` and re-run `bun install` with the lockfile's existing pins intact.

- [ ] **Step 3: Rename the plugin manifest**

In `herdr-plugin.toml`, replace the first five lines with:

```toml
id = "hamzahraihan.orbit"
name = "Orbit"
version = "0.5.0"
min_herdr_version = "0.9.0"
description = "Orchestrated Remote Background Integration Terminal: a local-first browser and phone client for herdr"
platforms = ["linux", "macos", "windows"]
```

Leave every `[[build]]`, `[[startup]]`, `[[actions]]` and `[[panes]]` block untouched — the local action ids stay `start` / `start-windows` / `stop` / `stop-windows` / `status` / `status-windows` / `phone` / `phone-windows`, and `platforms = ["linux", "macos"]` vs `["windows"]` on each pair is what makes the Windows variants reachable.

- [ ] **Step 4: Create `NOTICE`**

```bash
cd C:\herdr-plugins-project\orbit
cat > NOTICE <<'EOF'
Orbit
======

Orbit is a modified fork of herdr-web-ui, Copyright (c) 2026 devswha.
https://github.com/devswha/herdr-web-ui

Orbit is distributed under the same MIT licence as the original work. The
copyright notice and permission notice in LICENSE are retained verbatim, as
the licence requires.

Changes from upstream: the anonymous usage counts (telemetry), the app
update checks, the subscription usage meters and the Portal relay were
removed; the remote-PC runtime bundle is fetched from this repository
instead of the original author's; the plugin id and package name were
changed.
EOF
```

- [ ] **Step 5: Sweep the repository references**

Run this, which rewrites every remaining `devswha/herdr-web-ui` to `hamzahraihan/orbit`:

```bash
cd C:\herdr-plugins-project\orbit
git grep -l "devswha/herdr-web-ui" -- . ':!CHANGELOG.md' ':!docs/superpowers' \
  ':!server/remote-bundle.ts' ':!server/remote-bundle.test.ts' ':!telemetry/' \
  | while read -r f; do sed -i 's#devswha/herdr-web-ui#hamzahraihan/orbit#g' "$f"; done
```

`server/remote-bundle.ts` and its test are excluded on purpose: Task 6 changes that URL test-first, with a failing test, rather than by a sweep. `CHANGELOG.md` is history and `docs/superpowers/` deliberately names the upstream.

Verify only the intended files changed:

```bash
git grep -n "devswha/herdr-web-ui" -- . ':!CHANGELOG.md' ':!docs/superpowers' ':!server/remote-bundle.ts' ':!server/remote-bundle.test.ts' ':!telemetry/'
```

Expected: five hits, all of them links to upstream's own history, which the sweep must not move:
`docs/guide.md` (the `[#451]` issue) and `docs/ios-home-screen-testing.md` (the `[PR #199]`, the
`[#164]` and its two issue-comment anchors). The fork's tracker starts empty, so those links
would 404 there. A link to an upstream issue or pull request is history, like `CHANGELOG.md`'s
release links, and stays with the project it happened in.

- [ ] **Step 6: Fix the tests that asserted the old URL**

The sweep rewrote the URL inside these test expectations too, but any test that builds the expected URL from a constant rather than a literal needs the constant changed. Run the suite and fix each failure by pointing it at `hamzahraihan/orbit`:

```bash
bun scripts/ci-tests.ts unit
```

The known files to check are `scripts/install-star.test.ts`, `scripts/changelog-fold.test.ts`, `scripts/ci-runner-route.test.ts`, `server/push.test.ts`, `src/lib/markdown.test.ts`, `src/lib/webPanel.test.ts`, `scripts/windows-install.test.ps1`, `scripts/windows-install-e2e.ps1`.

- [ ] **Step 7: Gate**

```bash
bun run typecheck
bun run build
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: all four exit 0. The integration lane needs a `herdr` binary on `PATH` (0.9.5 is installed) and starts its own `herdr-web-ui-test` session; it never touches the session you work in.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename the plugin to Orbit

The plugin id becomes hamzahraihan.orbit and the package orbit@0.5.0.
Every repository reference now points at hamzahraihan/orbit. The MIT
notice is retained and NOTICE records the fork."
git push origin main
```

---

### Task 2: Remove telemetry

**Files:**
- Delete: `server/telemetry.ts`, `server/telemetry.test.ts`, `shared/telemetry.ts`, `src/components/TelemetryControls.tsx`, `telemetry/worker.ts`, `telemetry/worker.test.ts`, `telemetry/schema.sql`, `telemetry/wrangler.toml`, `telemetry/deployed.json`, `telemetry/README.md`, `scripts/telemetry-deployed.test.ts`, `scripts/telemetry-regression.ts`
- Modify: `server/index.ts`, `server/core/status.ts`, `src/App.tsx`, `src/components/SettingsDialog.tsx`, `src/lib/api.ts`, `src/lib/settings.ts`, `shared/protocol.ts`, `scripts/release-guards.ts`, `scripts/ui-contexts-checks.ts`, `scripts/ci-tests.ts`, `scripts/conventions.test.ts`, `scripts/fixed-sleeps.ts`, `server/conventions.test.ts`, `tsconfig.json`, `site/demo/transport.ts`, `src/lib/i18n.{ja,ko,zh}.ts`, `server/api.contract.test.ts`
- Create: `scripts/orbit.conventions.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `scripts/orbit.conventions.test.ts` — the guard file that Tasks 3, 4 and 5 each append an `it()` to

- [ ] **Step 1: Write the failing guard**

Create `scripts/orbit.conventions.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
bun test scripts/orbit.conventions.test.ts
```

Expected: FAIL, naming `server/telemetry.ts` — the URL `https://herdr-web-ui-telemetry.devswha.workers.dev/v1/events` is still there.

- [ ] **Step 3: Delete the telemetry modules**

```bash
cd C:\herdr-plugins-project\orbit
git rm server/telemetry.ts server/telemetry.test.ts shared/telemetry.ts \
  src/components/TelemetryControls.tsx \
  telemetry/worker.ts telemetry/worker.test.ts telemetry/schema.sql telemetry/wrangler.toml telemetry/deployed.json telemetry/README.md \
  scripts/telemetry-deployed.test.ts scripts/telemetry-regression.ts
```

- [ ] **Step 4: Remove the server wiring**

In `server/index.ts` delete these five lines exactly:

```ts
import { handleTelemetryRequest, Telemetry } from "./telemetry.ts";
```

```ts
    /** anonymous install and update counts (server/telemetry.ts); unset, the server sends none and answers 404. Only the real entrypoint passes one. */
    telemetry?: Telemetry;
```

```ts
      if (pathname === "/api/telemetry") return handleTelemetryRequest(request, options.telemetry);
```

```ts
  const telemetry = new Telemetry({ stateDir: defaultStateDir(), version, env: process.env, fetch, previousVersion: () => updates.installed().previous_version });
```

```ts
  telemetry.start();
```

```ts
  telemetry.stop();
```

and edit the `createServer` call to drop the `telemetry` field:

```ts
    instance = createServer({ updates, herdrUpdate: new HerdrUpdater(), portal, registerBridge: true, herdrProfiles: readHerdrProfiles });
```

Then run `bun run typecheck`. If it reports `version` is declared but never read, delete this line too — the telemetry constructor was its only reader:

```ts
  const version = (JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { version: string }).version;
```

In `server/core/status.ts`:

- delete `import type { Telemetry } from "../telemetry.ts";`
- delete the `telemetry?: Telemetry;` line from the options type
- delete `const VISIT_READ_MS = 10 * 60_000;`
- delete the whole `countVisit` function, from its doc comment through its closing brace — it is the only function in the file with that name
- delete `countVisit,` from the object returned at the end of `createStatusHub`
- delete every call to `countVisit(...)` in the file

- [ ] **Step 5: Remove the client wiring**

In `src/App.tsx` delete `import { TelemetryNotice } from "./components/TelemetryControls.tsx";` and the `<TelemetryNotice … />` line.

In `src/components/SettingsDialog.tsx` delete `import { TelemetryControls } from "./TelemetryControls.tsx";` and the `<TelemetryControls />` line inside `AboutPage`.

In `src/lib/api.ts` delete `import type { TelemetryChange, TelemetryStatus } from "../../shared/telemetry.ts";`, `fetchTelemetry()` and `changeTelemetry()`.

In `src/lib/settings.ts` delete `import type { TelemetrySettings } from "../../shared/telemetry.ts";`, the `TelemetrySourceSettings` type and the whole `telemetrySettingsSnapshot()` function. Its only caller was the telemetry notice, which is gone.

In `shared/protocol.ts` delete the `/api/telemetry` doc block.

- [ ] **Step 6: Remove the build and release references**

- `scripts/release-guards.ts`: delete `WORKER_SOURCES`, `DEPLOYED_FILE`, `workerFingerprint()`, `workerProblems()`, the `...workerProblems(...)` spread inside the `problems` array in `check()`, and the `--worker-deployed` branch with its console text.
- `scripts/ui-contexts-checks.ts`: delete the `checkTelemetrySettings` import and its `await timed("checkTelemetrySettings", …)` call.
- `scripts/ci-tests.ts`: the test-file glob `{src,shared,server,scripts,telemetry}/**/*.test.ts` becomes `{src,shared,server,scripts}/**/*.test.ts`.
- `scripts/conventions.test.ts`: the `SOURCES` glob `{src,server,shared,scripts,site,telemetry}/**/*…` drops `telemetry`.
- `scripts/fixed-sleeps.ts`: the glob `{server,src,shared,scripts,site,telemetry}/**/*…` drops `telemetry`.
- `server/conventions.test.ts`: both globs that list `telemetry` drop it.
- `tsconfig.json`: remove `"telemetry",` from `include`.
- `site/demo/transport.ts`: remove the `/api/telemetry` branch.

- [ ] **Step 7: Remove the telemetry dictionary entries**

The i18n test names the exact entries to delete:

```bash
bun test src/lib/i18n.test.ts
```

Expected: FAIL, listing stale keys. Delete each of those keys from `src/lib/i18n.ja.ts`, `src/lib/i18n.ko.ts` and `src/lib/i18n.zh.ts` — the English key, its Japanese, Korean and Chinese translations, and the `grab("lib/usage.ts", …)`-style scrapes if any point at the removed modules.

Re-run the test. Expected: PASS.

- [ ] **Step 8: Remove the telemetry contract test**

In `server/api.contract.test.ts`, delete the whole `describe("telemetry API", …)` block, and delete the imports it needed:

```ts
import { Telemetry } from "./telemetry.ts";
import { NOTICE_VERSION, telemetryHarnesses, type TelemetryActive, type TelemetryEvent, type TelemetryStatus } from "../shared/telemetry.ts";
import { DEFAULT_SETTINGS, telemetrySettingsSnapshot } from "../src/lib/settings.ts";
```

`DEFAULT_SETTINGS` may still be used elsewhere in that file — check before deleting that import.

- [ ] **Step 9: Verify the guard passes and the feature is gone**

```bash
bun test scripts/orbit.conventions.test.ts
```

Expected: PASS.

Then confirm no telemetry state file is written and nothing references the worker:

```bash
bun run typecheck
bun run build
grep -r "workers.dev" dist/ server/ shared/ src/ 2>/dev/null; echo "grep exit=$? (1 means no hits)"
```

Expected: typecheck and build exit 0; the grep finds nothing.

- [ ] **Step 10: Gate**

```bash
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: remove telemetry

Orbit sends no anonymous usage counts. The collector, the event schema,
the Settings switch, the notice line, the Cloudflare Worker receiver and
the release guard that tracked it are gone. scripts/orbit.conventions.test.ts
keeps the worker host out of the tree."
git push origin main
```

---

### Task 3: Remove the app update checks

**Files:**
- Delete: `server/updater.ts`, `server/updater.test.ts`, `server/supervisor.ts`, `server/release-notes.ts`, `server/release-notes.test.ts`, `src/lib/updates.ts`, `src/lib/updateNotes.ts`, `src/lib/updateNotes.test.ts`, `src/lib/updateProgress.ts`, `src/lib/updateProgress.test.ts`
- Modify: `server/index.ts`, `server/managed.ts`, `server/update-api.ts`, `server/update-state.ts`, `shared/protocol.ts`, `shared/update.ts`, `src/App.tsx`, `src/components/SettingsDialog.tsx`, `src/components/UpdateControls.tsx`, `src/lib/api.ts`, `src/lib/runningVersion.ts`, `src/lib/i18n.{ja,ko,zh}.ts`, `scripts/orbit.conventions.test.ts`

**Interfaces:**
- Consumes: `scripts/orbit.conventions.test.ts` from Task 2
- Produces: `server/managed.ts` reduced to a launcher that spawns `server/index.ts`; `server/update-api.ts` reduced to `updateRequestAllowed(request)`; `shared/update.ts` reduced to the herdr-update surface

- [ ] **Step 1: Extend the failing guard**

Append this `it()` inside `describe("Orbit's removed features", …)` in `scripts/orbit.conventions.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
bun test scripts/orbit.conventions.test.ts
```

Expected: FAIL, naming `server/updater.ts`.

- [ ] **Step 3: Delete the update modules**

```bash
cd C:\herdr-plugins-project\orbit
git rm server/updater.ts server/updater.test.ts server/supervisor.ts \
  server/release-notes.ts server/release-notes.test.ts \
  src/lib/updates.ts src/lib/updateNotes.ts src/lib/updateNotes.test.ts \
  src/lib/updateProgress.ts src/lib/updateProgress.test.ts
```

`src/lib/updateNotes.ts` goes whole: `reloadReason()`'s only production caller was `src/lib/updates.ts`. `ChunkFailureNotice` never used it — it reads `src/lib/lazyChunk.ts` alone and is already written to stand without the update model.

- [ ] **Step 4: Move the release-tooling helpers into `scripts/`**

`server/release-notes.ts` was imported by `scripts/release-guards.ts` (for `SUMMARIES_FILE`) and `scripts/release-notes.ts` (for `SUMMARIES_FILE` and `releaseSummaries`). Move both into `scripts/release-notes.ts`, which already exports a **different** `releaseNotes` — merge the declarations, do not replace one body with the other:

```ts
export const SUMMARIES_FILE = "release-summaries.json";
```

and

```ts
export function releaseSummaries(text: string): Map<string, ReleaseSummary> {
```

(the body moves verbatim from `server/release-notes.ts`, with its `ReleaseSummary` type and any helper it used). Then update the two importers to take them from `./release-notes.ts` instead of `../server/release-notes.ts`.

`compareVersions` and the server-side `releaseNotes` were used only by the deleted updater and go with it.

- [ ] **Step 5: Reduce `server/update-api.ts` to the guard**

`server/update-api.ts` keeps only what the herdr self-update still needs. Delete `UpdateService`, `servedRevision()`, `connectUpdater()` and `handleUpdateRequest()`, and leave:

```ts
export function updateRequestAllowed(request: Request): boolean {
```

with the body unchanged. Add a comment above it explaining that it is now the only thing in the file: the app's update checks are gone, and the herdr self-update and the portal still post through it.

- [ ] **Step 6: Reduce `server/managed.ts` to a launcher**

The supervisor existed only to drive the updater and hand over between releases. With no releases there is nothing to hand over. Replace the whole file with:

```ts
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
```

- [ ] **Step 7: Remove the update routes and lifecycle**

In `server/index.ts`:

- delete `import { connectUpdater, handleUpdateRequest, type UpdateService } from "./update-api.ts";`
- delete the `updates?: UpdateService;` option line
- delete the route block that starts `if (pathname === "/api/updates" || pathname.startsWith("/api/updates/"))`
- delete `const updates = connectUpdater();`
- edit the `createServer` call to drop `updates`: `instance = createServer({ herdrUpdate: new HerdrUpdater(), portal, registerBridge: true, herdrProfiles: readHerdrProfiles });`

Keep `handleHerdrUpdateRequest` and `options.herdrUpdate` — the herdr self-update stays.

In `shared/protocol.ts` delete the `/api/updates` doc block.

In `shared/update.ts` keep only what `server/herdr-update.ts` and the herdr-update frontend still need: `HerdrUpdateStatus` and its neighbours. `server/herdr-update.ts` imports exactly one symbol from it:

```ts
import type { HerdrUpdateStatus } from "../shared/update.ts";
```

`server/api.contract.test.ts` also imports `noInstalledNotes` and `unmanagedUpdateStatus` from `shared/update.ts` — check whether the contract test still needs them once the telemetry and update blocks are gone, and delete them if not.

In `server/update-state.ts` delete `export const HANDOVER_EXIT = 75;` — only `managed.ts` and `supervisor.ts` used it, and both are gone. Keep `defaultStateDir()` and `updateStateDir()`: `scripts/phone-setup.test.ts` and `scripts/plugin-runtime.test.ts` still import `updateStateDir`.

- [ ] **Step 8: Remove the update UI**

In `src/App.tsx` delete `import { useUpdates } from "./lib/updates.ts";`, `import { UpdateNotice } from "./components/UpdateControls.tsx";`, the `const updates = useUpdates(locked === false);` line, the `<UpdateNotice … />` line, the `updates={updates}` prop on `<SettingsDialog …>`, and the `settingsSection` state if nothing else sets `"updates"`.

In `src/components/SettingsDialog.tsx` delete the `UpdatesModel` type import, the `UpdateControls` import and the `<UpdateControls … />` line, and the `updates` prop from `SettingsDialogProps`. Keep `HerdrUpdateControls`: the herdr self-update stays. Its `bridgesFollow` prop went with `UpdateControls`, so `AboutPage` no longer takes it.

In `src/components/UpdateControls.tsx` delete `ReleaseNotes`, `UpdateProgress`, `UpdateControls` and `UpdateNotice`. **Keep `ChunkFailureNotice`** and keep `src/components/UpdateControls.css` — `LanExposureNotice.css` shares the `.update-notice` layout.

In `src/lib/api.ts` delete `fetchUpdateStatus()`, `fetchUpdateNotes()`, `fetchInstalledNotes()` and `requestUpdate()`.

In `src/lib/runningVersion.ts` delete the app-update exports (`runningAppVersion`, `staleClientVersion`) and keep `runningHerdrVersion` and `versionLabel` if `HerdrUpdateControls` still uses them.

- [ ] **Step 8: Remove the update contract tests**

`server/api.contract.test.ts` carries a whole `describe("update API", …)` block whose first five
tests are about the app update service that no longer exists. Delete exactly these five `it()`
blocks, keeping the block itself so the herdr-update tests that follow stay:

- `it("reports unmanaged servers without performing network discovery", …)`
- `it("answers what the available update brings, and nothing where no supervisor told it", …)`
- `it("tells the served build's commit once it differs from the running revision", …)`
- `it("answers what the last update brought, and nothing where no update was installed", …)`
- `it("refuses cross-site/form update requests and unmanaged installs", …)`

Keep these three, which test the herdr self-update that stays:

- `it("offers no herdr update on a server started without the updater", …)`
- `it("updates herdr through the server and reports what herdr said", …)`
- `it("keeps status and update actions behind the token gate", …)`

The kept tests may still reference the `updates` service through the server options. Check each
one and remove only the parts that build an `updates:` option object — those servers are created
with `createServer({ port: 0, stateDir, updates: { status: () => (…), notes: () => (…), installed: …, request() {} } })`,
and the `updates` field no longer exists in the options type, so those `createServer` calls must
drop the field.

Then clean the imports: `noInstalledNotes`, `unmanagedUpdateStatus` and the `InstalledNotes` /
`UpdateNotes` types come from `shared/update.ts` and may now be unused. Keep `HerdrUpdateStatus`,
which the herdr-update tests still use.

```bash
bun run typecheck
```

Expected: exit 0. If `shared/update.ts` now has no consumer for `UpdateNotes` or `InstalledNotes`,
delete those types too — but only if `bun run typecheck` confirms nothing references them.

- [ ] **Step 9: Remove the update dictionary entries**

```bash
bun test src/lib/i18n.test.ts
```

Delete every stale key it names from `src/lib/i18n.ja.ts`, `src/lib/i18n.ko.ts` and `src/lib/i18n.zh.ts`. Also delete the `grab("lib/updateProgress.ts", "STEPS", …)` scrape in `src/lib/i18n.test.ts` — it throws once the module is gone. Re-run the test. Expected: PASS.

- [ ] **Step 10: Verify the guard passes**

```bash
bun test scripts/orbit.conventions.test.ts
bun run typecheck
bun run build
```

Expected: guard PASS; typecheck and build exit 0.

- [ ] **Step 11: Gate**

```bash
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: both exit 0.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: remove the app update checks

Orbit has no release channel: it is updated by pulling this repository.
The updater, the supervisor that handed over between releases, the
Settings > About > Updates panel and the update notice line are gone.
The herdr self-update button stays."
git push origin main
```

---

### Task 4: Remove the usage meters and the CLI-proxy Hub

**Files:**
- Delete: `server/usage.ts`, `server/usage.test.ts`, `server/usage-login.ts`, `server/usage-login.contract.test.ts`, `shared/usage-login.ts`, `src/lib/usage.ts`, `src/lib/usage.test.ts`, `src/components/UsageMeters.tsx`, `src/components/UsageMeters.css`, `src/components/UsageSettings.tsx`, `src/components/UsageSettings.css`, `src/components/UsageAccountDialog.tsx`, `src/components/UsageAccountDialog.css`, `src/components/UsageHubConnect.tsx`, `src/components/UsageLocalLogin.tsx`, `src/components/CLIProxyLogin.tsx`, `server/cliproxy.ts`, `server/cliproxy-routes.ts`, `server/cliproxy.test.ts`, `server/cliproxy.fake.ts`, `scripts/usage-regression.ts`
- Modify: `server/index.ts`, `server/core/status.ts`, `shared/protocol.ts`, `shared/preferences.ts`, `src/lib/api.ts`, `src/lib/settings.ts`, `src/lib/paletteSettings.ts`, `src/lib/i18n.test.ts`, `src/lib/i18n.{ja,ko,zh}.ts`, `src/App.tsx`, `src/components/SettingsDialog.tsx`, `src/components/Composer.tsx`, `src/components/MachineSidebar.tsx`, `scripts/ui-contexts-checks.ts`, `scripts/ci-browser.sh`, `scripts/ci-browser.test.ts`, `scripts/pages-gate.test.ts`, `scripts/orbit.conventions.test.ts`

**Interfaces:**
- Consumes: `scripts/orbit.conventions.test.ts`
- Produces: the `Settings` type without the five usage keys; `shared/preferences.ts` without them from `SHARED_SETTING_KEYS`

- [ ] **Step 1: Extend the failing guard**

Append inside `describe("Orbit's removed features", …)`:

```ts
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
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
bun test scripts/orbit.conventions.test.ts
```

Expected: FAIL, naming `server/usage.ts`.

- [ ] **Step 3: Delete the usage modules**

```bash
cd C:\herdr-plugins-project\orbit
git rm server/usage.ts server/usage.test.ts server/usage-login.ts server/usage-login.contract.test.ts \
  shared/usage-login.ts src/lib/usage.ts src/lib/usage.test.ts \
  src/components/UsageMeters.tsx src/components/UsageMeters.css \
  src/components/UsageSettings.tsx src/components/UsageSettings.css \
  src/components/UsageAccountDialog.tsx src/components/UsageAccountDialog.css \
  src/components/UsageHubConnect.tsx src/components/UsageLocalLogin.tsx src/components/CLIProxyLogin.tsx \
  server/cliproxy.ts server/cliproxy-routes.ts server/cliproxy.test.ts server/cliproxy.fake.ts \
  scripts/usage-regression.ts
```

The CLI-proxy "Hub" goes with them: `server/cliproxy.ts` existed only to contribute provider accounts to the usage report.

- [ ] **Step 4: Remove the server wiring**

In `server/index.ts` delete:

```ts
import { handleUsageRequest, UsageService } from "./usage.ts";
import { CLIProxyService } from "./cliproxy.ts";
import { CLIProxyRoutes } from "./cliproxy-routes.ts";
import { UsageLoginService } from "./usage-login.ts";
```

the `usage?: UsageService;`, `cliProxy?: CLIProxyService;` and `usageLogin?: UsageLoginService;` option lines, the constructions

```ts
  const cliProxy = options.cliProxy ?? new CLIProxyService(options.stateDir ?? defaultStateDir());
  const cliProxyRoutes = new CLIProxyRoutes(cliProxy);
  const usageLogin = options.usageLogin ?? new UsageLoginService();
  const usage = options.usage ?? new UsageService(undefined, undefined, (refresh) => cliProxy.report(refresh));
```

the routes

```ts
      if (pathname === "/api/usage") return handleUsageRequest(request, url, usage);
```

and the `/api/cliproxy` route block. Edit the `createStatusHub({ … })` call to drop the `usage` and `usageLogin` arguments.

In `server/core/status.ts` delete the `UsageLoginService` and `UsageService` type imports, the `usage: UsageService;` and `usageLogin: UsageLoginService;` parameters, the matching destructuring, and the `if (usageLogin.ended(paneId)) usage.invalidate();` line.

- [ ] **Step 4b: Remove the usage contract tests**

`server/api.contract.test.ts` carries a `describe("usage API", …)` block with two `it()` blocks:

- `it("returns OpenCode Go windows without exposing its credential", …)`
- `it("answers the report and keeps it behind the token gate", …)`

Delete the whole `describe("usage API", …)` block. Also delete the imports it needed:

```ts
import { USAGE_PROVIDERS, UsageService } from "./usage.ts";
```

and the `UsageReport` entry from the long `shared/protocol.ts` type import at the top of the file.

- [ ] **Step 5: Remove the usage settings**

In `src/lib/settings.ts`:

- delete the `UsageCount` and `UsageGlance` types
- delete `showUsage`, `usageCount`, `usageGlance`, `usageOrder` and `usageHidden` from the `Settings` interface
- delete their `DEFAULT_SETTINGS` entries
- delete their `sanitizeSettings` handling
- delete them from `SETTING_SCOPE`, the shared/device classification map
- delete the `usageKeys` helper, which only fed `usageOrder` and `usageHidden`

In `shared/preferences.ts` remove exactly these five keys from `SHARED_SETTING_KEYS`:

```ts
  "showUsage", "usageCount",
  "usageGlance", "usageOrder", "usageHidden",
```

In `shared/protocol.ts` remove `UsageProviderId`, `UsageWindow`, `UsageProblem`, `ProviderUsage`, `UsageReport`, the `CLIProxy*` types and the `/api/usage` doc block.

- [ ] **Step 6: Write the failing test for a stale settings payload**

A browser that loaded the pre-removal bundle still sends the five removed keys. `src/lib/settings.test.ts`
already imports `sanitizeSettings` and `DEFAULT_SETTINGS` from `./settings.ts`, so add this test
inside the existing `describe` block for settings sanitising:

```ts
  it("ignores a settings payload that still carries the removed usage keys", () => {
    const stale = { ...DEFAULT_SETTINGS, showUsage: true, usageCount: "used", usageGlance: "week", usageOrder: ["claude"], usageHidden: ["cursor"] };
    const settings = sanitizeSettings(stale);
    expect("showUsage" in settings).toBe(false);
    expect("usageCount" in settings).toBe(false);
    expect("usageGlance" in settings).toBe(false);
    expect("usageOrder" in settings).toBe(false);
    expect("usageHidden" in settings).toBe(false);
  });
```

Run it:

```bash
bun test src/lib/settings.test.ts
```

Expected: FAIL — `sanitizeSettings` still reads the removed keys, so they survive into the result.

- [ ] **Step 7: Make the sanitiser ignore the removed keys**

The `sanitizeSettings` implementation must not carry the removed keys through. Delete their handling so the sanitiser falls back to the defaults for keys it no longer knows:

```ts
    showUsage: typeof record["showUsage"] === "boolean" ? record["showUsage"] : DEFAULT_SETTINGS.showUsage,
    usageCount: record["usageCount"] === "used" || record["usageCount"] === "left" ? record["usageCount"] : DEFAULT_SETTINGS.usageCount,
    usageGlance: record["usageGlance"] === "week" || record["usageGlance"] === "session" ? record["usageGlance"] : DEFAULT_SETTINGS.usageGlance,
    usageOrder: usageKeys(record["usageOrder"]),
    usageHidden: usageKeys(record["usageHidden"]),
```

and the `usageKeys` helper, if nothing else uses it.

Re-run the test. Expected: PASS.

- [ ] **Step 8: Remove the client wiring**

In `src/lib/api.ts` delete `fetchUsageLoginProviders()`, `fetchUsageLoginAccounts()`, `startUsageLogin()`, `fetchUsage()`, `cliProxyRequest()` and the `UsageLogin*` / `UsageReport` type imports.

In `src/components/SettingsDialog.tsx` delete the `UsageSettings` import, the `case "usage": return <UsageSettings … />` line, the `"usage"` entry in `PAGES`, and the `onUsageLogin` prop.

In `src/lib/paletteSettings.ts` remove `"usage"` from `SettingsPageId` and its palette entry.

In `src/components/MachineSidebar.tsx` delete the `UsageMeters` import and the `<UsageMeters />` line.

In `src/components/Composer.tsx` delete the `../lib/usage.ts` import, `usageEnabled`, `useUsage`, `composerUsage`, `usageWindows`, `usageLimit`, `usageDetail`, `usageCaption`, `usageAccessible`, the `usage` entry in the resize dependency list, and the `.composer-usage` JSX block.

In `src/App.tsx` delete the `window.dispatchEvent(new Event("herdr-usage-changed"))` line and the `onUsageLogin` prop on `<SettingsDialog>`.

- [ ] **Step 9: Remove the usage dictionary entries and the scrapes**

```bash
bun test src/lib/i18n.test.ts
```

Delete every stale key it names from the three dictionaries. In `src/lib/i18n.test.ts` delete the `grab("lib/usage.ts", "WINDOW_LABEL", …)` line — it throws once the module is gone — and the `grab("lib/updateProgress.ts", "STEPS", …)` line if Task 3 left it. Re-run the test. Expected: PASS.

- [ ] **Step 10: Remove the usage test infrastructure**

- `scripts/ui-contexts-checks.ts`: delete the `checkUsageMeters` import and its `await timed("checkUsageMeters", …)` call.
- `scripts/ci-browser.sh`: delete the `run_script scripts/cliproxy-settings-regression.ts` row.
- `scripts/ci-browser.test.ts`: update the expected lane list.
- `scripts/pages-gate.test.ts`: remove `checkUsageMeters` from the expected check names.

- [ ] **Step 11: Verify the guard passes and the feature is gone**

```bash
bun test scripts/orbit.conventions.test.ts
bun run typecheck
bun run build
grep -r "api.anthropic.com\|chatgpt.com\|api2.cursor.sh\|cli-chat-proxy.grok.com\|cloudcode-pa\|opencode.ai/zen" dist/ server/ src/ 2>/dev/null; echo "grep exit=$? (1 means no hits)"
```

Expected: guard PASS; typecheck and build exit 0; the grep finds nothing.

- [ ] **Step 12: Gate**

```bash
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: both exit 0.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: remove the subscription usage meters

Orbit reads no provider account. The Anthropic, ChatGPT, Cursor, Copilot,
Grok, Antigravity and OpenCode adapters, the sign-in flow, the CLI-proxy
hub and the quota chips are gone, along with the five settings that drove
them. A browser still sending the old keys gets the defaults."
git push origin main
```

---

### Task 5: Remove the Portal relay

**Files:**
- Delete: `server/portal.ts`, `server/portal.test.ts`, `src/components/PortalPanel.tsx`, `src/components/PortalPanel.css`, `src/lib/portal.ts`, `scripts/portal-regression.ts`
- Modify: `server/index.ts`, `shared/protocol.ts`, `src/components/SettingsDialog.tsx`, `src/lib/api.ts`, `site/demo/transport.ts`, `scripts/ci-browser.sh`, `scripts/ci-browser.test.ts`, `src/lib/i18n.{ja,ko,zh}.ts`, `scripts/orbit.conventions.test.ts`

**Interfaces:**
- Consumes: `scripts/orbit.conventions.test.ts`
- Produces: a server with no `/api/portal` route; the phone setup path (`PhonePanel`, `DevicesPanel`) untouched

- [ ] **Step 1: Extend the failing guard**

Append inside `describe("Orbit's removed features", …)`:

```ts
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
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
bun test scripts/orbit.conventions.test.ts
```

Expected: FAIL, naming `server/portal.ts`.

- [ ] **Step 3: Delete the portal modules**

```bash
cd C:\herdr-plugins-project\orbit
git rm server/portal.ts server/portal.test.ts \
  src/components/PortalPanel.tsx src/components/PortalPanel.css src/lib/portal.ts \
  scripts/portal-regression.ts
```

`chunksOf` needs no relocation: it lives in `server/remote-bundle.ts`, which survives Task 6. Only `server/portal.ts` stops importing it.

- [ ] **Step 4: Remove the server wiring**

In `server/index.ts` delete:

```ts
import { handlePortalRequest, PortalService } from "./portal.ts";
```

the `portal?: PortalService;` option line, the route block that starts `if (pathname === "/api/portal" || pathname.startsWith("/api/portal/"))`, the construction

```ts
  const portal = new PortalService({ stateDir: defaultStateDir() });
```

the `portal` field from the `createServer` call, the `settlePortalStartup({ ok: false, error: … })` call inside `instance.stop()`, the `void options.portal?.shutdown();` call, the `portal.shutdown()` call in the SIGTERM handler, and the whole `settlePortalStartup` helper (its declaration and its assignment).

- [ ] **Step 4b: Remove the portal contract tests**

`server/api.contract.test.ts` carries a `describe("Portal API", …)` block with three `it()` blocks:

- `it("does not serve requests until startup cleanup completes", …)`
- `it("fails closed when startup cleanup rejects", …)`
- `it("opens a public address only behind the token, and closes it again", …)`

Delete the whole `describe("Portal API", …)` block. Also delete the imports it needed:

```ts
import { PortalService } from "./portal.ts";
```

and the `PortalStatus` entry from the long `shared/protocol.ts` type import at the top of the file.

- [ ] **Step 5: Remove the client wiring**

In `src/components/SettingsDialog.tsx` delete the `PortalPanel` import and the `<PortalPanel readOnly={…} />` line.

In `src/lib/api.ts` delete `fetchPortal()`, `requestPortal()` and the `PortalStatus` type import.

In `shared/protocol.ts` delete the `PortalStatus` interface and the `/api/portal` doc block.

In `site/demo/transport.ts` delete the `/api/portal` branches and the `PortalStatus` import.

In `scripts/ci-browser.sh` delete the `run_script scripts/portal-regression.ts` row. In `scripts/ci-browser.test.ts` delete the expectation that names that script.

- [ ] **Step 6: Remove the portal dictionary entries**

```bash
bun test src/lib/i18n.test.ts
```

Delete every stale key it names from the three dictionaries. Re-run the test. Expected: PASS.

- [ ] **Step 7: Verify the guard passes**

```bash
bun test scripts/orbit.conventions.test.ts
bun run typecheck
bun run build
```

Expected: guard PASS; typecheck and build exit 0.

- [ ] **Step 8: Gate**

```bash
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove the Portal relay

Orbit is reached directly, over Tailscale, a LAN address or an SSH
tunnel; it never registers itself with the author's relay. The portal
service, its Settings panel and the browser QA lane are gone. Phone
setup was never routed through it and is unchanged."
git push origin main
```

---

### Task 6: Point the remote-PC bundle at orbit

**Files:**
- Modify: `server/remote-bundle.ts`, `server/remote-bundle.test.ts`
- Modify: `scripts/orbit.conventions.test.ts`

**Interfaces:**
- Consumes: `scripts/orbit.conventions.test.ts`
- Produces: `bundleManifestSource(platform, options)` returning a URL under `github.com/hamzahraihan/orbit`

- [ ] **Step 1: Write the failing test**

In `server/remote-bundle.test.ts`, the test named *"uses the release only when the requested platform has no local manifest"* asserts the upstream URL. Change that one expectation to:

```ts
    expect(await bundleManifestSource("darwin-arm64", { directory, manifest: "" })).toBe(`https://github.com/hamzahraihan/orbit/releases/download/remote-v${REMOTE_BUNDLE_VERSION}/manifest.json`);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test server/remote-bundle.test.ts
```

Expected: FAIL, showing `https://github.com/devswha/herdr-web-ui/releases/download/remote-v31/manifest.json` where `hamzahraihan/orbit` was expected.

- [ ] **Step 3: Change the URL**

In `server/remote-bundle.ts`, the release URL is built in one function. Change it to:

```ts
  return `https://github.com/hamzahraihan/orbit/releases/download/remote-v${REMOTE_BUNDLE_VERSION}/manifest.json`;
```

`REMOTE_BUNDLE_VERSION` stays `"31"`: the fork publishes its own `remote-v31` release, and the version number keeps the bridge-compatibility check meaningful.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test server/remote-bundle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend the guard**

Append inside `describe("Orbit's removed features", …)`:

```ts
  it("never points a remote PC at the upstream release", () => {
    const offenders = matches(SOURCES.filter((file) => !file.endsWith(".test.ts")), /github\.com\/devswha\/herdr-web-ui/).map((match) => match.at);
    fail(offenders, "A remote PC must fetch its runtime from hamzahraihan/orbit, never from the upstream project.");
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 6: Verify the guard passes**

```bash
bun test scripts/orbit.conventions.test.ts
```

Expected: PASS. If it fails, another source file still names the upstream release — find it with the `matches` helper's output, which names `file:line`.

- [ ] **Step 7: Gate**

```bash
bun run typecheck
bun run build
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: point the remote-PC bundle at orbit

A remote PC fetches its runtime from github.com/hamzahraihan/orbit, the
public fork, instead of the upstream project's releases. The bridge
version stays remote-v31, which this repository publishes itself."
git push origin main
```

---

### Task 7: Finish the documentation sweep

**Files:**
- Modify: `README.md`, `README.ja.md`, `README.ko.md`, `README.zh-CN.md`, `docs/guide.md`, `docs/development.md`, `DESIGN.md`, `docs/remote-pcs.md`, `INSTALL.md`
- Create: `changelog.d/orbit-fork.md` if the repo's changelog fragment folder is the convention (it is — `changelog.d/` exists)

**Interfaces:**
- Consumes: the removals from Tasks 2–5
- Produces: documentation that no longer describes a feature that is gone

- [ ] **Step 1: Find every mention of a removed feature**

```bash
cd C:\herdr-plugins-project\orbit
git grep -n -i "telemetry\|anonymous usage count\|HERDR_WEB_TELEMETRY" -- '*.md' ':!CHANGELOG.md'
git grep -n -i "portal relay\|HERDR_WEB_TAILSCALE_SERVE_ONLY\|/api/portal" -- '*.md' ':!CHANGELOG.md'
git grep -n -i "subscription usage\|usage meter\|/api/usage" -- '*.md' ':!CHANGELOG.md'
git grep -n -i "check for updates\|what's new\|/api/updates" -- '*.md' ':!CHANGELOG.md'
```

Each command lists the passages to rewrite.

- [ ] **Step 2: Rewrite the passages**

- `docs/guide.md`: delete the "## Anonymous usage counts" section; delete the `HERDR_WEB_TELEMETRY` row from the configuration table; delete the Portal paragraphs and the Portal row; delete the usage-meter and update-check rows; keep the rows for `HOST`, `PORT`, `HERDR_SOCKET`, `HERDR_WEB_TOKEN`, `HERDR_WEB_STATE_DIR` and `HERDR_WEB_AUTO_UPDATE` — the last still applies to nothing now, so check whether the row should stay.
- `docs/development.md`: delete the telemetry Worker deploy steps.
- `DESIGN.md`: update the Settings-layout notes that describe the Portal group.
- `README*.md`: replace the anonymous-count sentence with a line saying Orbit sends nothing; add a short "This is a fork" note pointing at `NOTICE`.
- `INSTALL.md`, `docs/remote-pcs.md`: update the remote-PC bundle references to `hamzahraihan/orbit` and note that `remote-v31` must be published from the fork.

- [ ] **Step 3: Write the changelog entry**

Create `changelog.d/orbit-fork.md`:

```markdown
## Orbit

Orbit is a local-first fork of herdr-web-ui.

- The anonymous usage counts (telemetry) are removed: Orbit sends nothing to its maintainer.
- The app update checks are removed: Orbit is updated by pulling this repository.
- The subscription usage meters are removed: Orbit reads no provider account.
- The Portal relay is removed: Orbit is reached directly, over Tailscale, a LAN address or an SSH tunnel.
- The remote-PC runtime bundle is fetched from this repository instead of the upstream project's releases.
- The plugin id is `hamzahraihan.orbit`; the package is `orbit`.
```

- [ ] **Step 4: Verify the docs no longer describe what is gone**

Re-run the four `git grep` commands from Step 1. Expected: no output for the telemetry, usage-meter and portal greps. The update-check grep may still match the herdr self-update section, which stays.

- [ ] **Step 5: Gate**

```bash
bun run typecheck
bun run build
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: drop the removed features from the documentation

The guide, the READMEs and DESIGN.md describe what Orbit is: a local
client that sends nothing to its maintainer, checks for no updates, reads
no provider account and uses no relay of anyone's."
git push origin main
```

---

### Task 8: Install Orbit as the herdr plugin

**Files:**
- Modify: `C:\Users\Asep Saepuloh\AppData\Roaming\herdr\plugins\config\hamzahraihan.orbit\env` (create)
- Read: `C:\Users\Asep Saepuloh\AppData\Roaming\herdr\plugins\config\devswha.herdr-web-ui\env` (the file written during the diagnosis)

**Interfaces:**
- Consumes: everything from Tasks 1–7
- Produces: the plugin `hamzahraihan.orbit` registered with herdr and serving on 127.0.0.1:7317

- [ ] **Step 1: Build the plugin's working tree**

`herdr plugin link` does not run build commands, so the tree must be built by hand first:

```bash
cd C:\herdr-plugins-project\orbit
bun install
bun run build
```

Expected: build prints `✓ built in`.

- [ ] **Step 2: Move the plugin config to the new id**

The config directory is named after the plugin id, so it changes with the rename. The `env` file written during the diagnosis disables telemetry — Orbit no longer has any, so the file becomes a place for local overrides only:

```bash
mkdir -p "C:/Users/Asep Saepuloh/AppData/Roaming/herdr/plugins/config/hamzahraihan.orbit"
cat > "C:/Users/Asep Saepuloh/AppData/Roaming/herdr/plugins/config/hamzahraihan.orbit/env" <<'EOF'
# Orbit plugin settings.
# Read by the plugin launcher (scripts/plugin.ts) and passed to the server process.
# Orbit sends no telemetry: the collector is not in the tree.
EOF
rm -rf "C:/Users/Asep Saepuloh/AppData/Roaming/herdr/plugins/config/devswha.herdr-web-ui"
```

Do **not** delete `C:\Users\Asep Saepuloh\.config\herdr-web-ui` — that is the app's own state directory (push keys, device subscriptions, preferences), not the plugin's, and it survives the rename.

- [ ] **Step 3: Stop the old plugin and unregister it**

```bash
herdr plugin action invoke devswha.herdr-web-ui.stop-windows
herdr plugin uninstall devswha.herdr-web-ui
```

Expected: the action reports `stopped herdr web ui`; the uninstall reports the plugin unregistered.

- [ ] **Step 4: Link the fork**

```bash
herdr plugin link "C:\herdr-plugins-project\orbit"
herdr plugin list
```

Expected: the list shows `hamzahraihan.orbit` as `local:C:\herdr-plugins-project\orbit`, enabled, and no longer shows `devswha.herdr-web-ui`.

- [ ] **Step 5: Start it and verify the health**

```bash
herdr plugin action invoke hamzahraihan.orbit.start-windows
sleep 8
curl -s -m 5 http://127.0.0.1:7317/api/health
```

Expected: `{"ok":true,"herdr":{"version":"0.9.5",…},"web_ui":{…}}` with HTTP 200.

- [ ] **Step 6: Verify every removed endpoint is gone**

```bash
for path in /api/telemetry /api/usage /api/portal /api/updates /api/cliproxy; do
  printf "%s -> " "$path"
  curl -s -o /dev/null -w "%{http_code}\n" -m 5 "http://127.0.0.1:7317$path"
done
```

Expected: `404` for every one of them.

- [ ] **Step 7: Verify the served bundle is the new one**

```bash
grep -r "workers.dev" "C:/herdr-plugins-project/orbit/dist" 2>/dev/null; echo "exit=$? (1 means no hits)"
grep -r "api.anthropic.com\|chatgpt.com\|api2.cursor.sh" "C:/herdr-plugins-project/orbit/dist" 2>/dev/null; echo "exit=$? (1 means no hits)"
```

Expected: both greps find nothing. A hit means `dist/` is stale — re-run `bun run build` and restart.

- [ ] **Step 8: Verify the phone setup still works**

```bash
herdr plugin action invoke hamzahraihan.orbit.phone-windows
```

Expected: the Phone setup pane opens and renders its QR code. The phone path never went through the Portal, so this is the regression check for that claim.

- [ ] **Step 9: Publish `remote-v31` from the fork**

A remote PC needs a manifest at `github.com/hamzahraihan/orbit/releases/download/remote-v31/manifest.json`, and the fetch is unauthenticated, so the release must be public (the repository already is).

Enable the workflow in the fork's Actions tab, then push the tag:

```bash
cd C:\herdr-plugins-project\orbit
git tag remote-v31
git push origin remote-v31
```

The `remote-bundles.yml` workflow builds the bundle and publishes the release. Watch it in the Actions tab; the release must exist before a remote PC can be set up.

If the workflow does not fire for a tag pushed from a fork, run the publish step locally instead: `bun run build:remote` produces the bundle, and `bun scripts/release-guards.ts --release 31` records the metadata.

- [ ] **Step 10: Verify a remote PC end to end**

Add one remote PC through the Machines panel and complete its setup. It must fetch the manifest from `hamzahraihan/orbit` and install the bridge. A failure here means the `remote-v31` release is missing or the bundle URL is wrong.

- [ ] **Step 11: Commit the config change**

The plugin config lives outside the repository, so there is nothing to commit. Record the state in the repository instead, so the next person knows the layout:

```bash
cd C:\herdr-plugins-project\orbit
cat >> docs/guide.md <<'EOF'

## Running Orbit as a herdr plugin

```sh
herdr plugin link C:\herdr-plugins-project\orbit
herdr plugin action invoke hamzahraihan.orbit.start-windows
```

The plugin's own settings live in the file herdr names after the plugin id:
`%APPDATA%\herdr\plugins\config\hamzahraihan.orbit\env`.
EOF
git add docs/guide.md
git commit -m "docs: record how Orbit is linked as a herdr plugin"
git push origin main
```

- [ ] **Step 12: Final gate**

```bash
cd C:\herdr-plugins-project\orbit
bun run typecheck
bun run build
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts integration
herdr plugin list
```

Expected: all four commands exit 0; the plugin list shows `hamzahraihan.orbit` enabled and no `devswha.herdr-web-ui`.

---

## Appendix: the removal inventory

The spec (`docs/superpowers/specs/2026-10-22-orbit-fork-design.md` §4) carries the per-area
inventory with line numbers. This table maps each area to its task.

| Area | Task | Guard `it()` in `scripts/orbit.conventions.test.ts` |
| --- | --- | --- |
| Telemetry | 2 | `sends nothing to the telemetry worker` |
| App update checks | 3 | `does not poll for app updates` |
| Usage meters + Hub | 4 | `does not read a provider account for a usage meter` |
| Portal relay | 5 | `runs no relay of the author's` |
| Remote-PC bundle | 6 | `never points a remote PC at the upstream release` |

## Appendix: commands that need no herdr session

`bun scripts/ci-tests.ts unit` runs every file that is not `*.contract.test.ts` and needs no
herdr. `bun scripts/ci-tests.ts integration` runs the `*.contract.test.ts` files, which start
their own `herdr-web-ui-test` herdr session and never touch the session you work in. Both
require the `herdr` binary on `PATH`.
