# Orbit — a private, local-first fork of herdr-web-ui

**Date:** 2026-10-22
**Status:** Approved (design), pending written-spec review
**Repo:** `github.com/hamzahraihan/orbit` (public) · base `97a48035` (upstream `main`)

---

## 1. Goal

Take `devswha/herdr-web-ui` — a browser and phone client for herdr — and make it **Orbit**, a
plugin the user owns and controls, with every channel to the original author's infrastructure
removed:

| Area | Status |
| --- | --- |
| Anonymous usage counts (telemetry) | **removed** |
| App update checks (GitHub release polling) | **removed** |
| Usage meters (provider account quota reads) | **removed** |
| Portal relay (author-operated remote access) | **removed** |
| Remote-PC runtime bundle downloads | **repointed** to `hamzahraihan/orbit` |

Orbit = **O**rchestrated **R**emote **B**ackground **I**ntegration **T**erminal.

### Non-goals

- Not a rewrite or a re-architecture. Orbit is upstream's code with features removed.
- Not a feature fork. Nothing new is added; only removals and renames.
- Not published as a product. It is a personal tool.

## 2. Identity

| | Value |
| --- | --- |
| Repository | `github.com/hamzahraihan/orbit` — **public** (see §7) |
| Local path | `C:\herdr-plugins-project\orbit` |
| `origin` | `https://github.com/hamzahraihan/orbit.git` |
| `upstream` | `https://github.com/devswha/herdr-web-ui.git` (read-only) |
| Base commit | `97a48035` — upstream `main`, 7 commits after the `v0.4.12` tag, and exactly the commit the installed plugin was running |
| Plugin id | `hamzahraihan.orbit` |
| Qualified actions | `hamzahraihan.orbit.start`, `hamzahraihan.orbit.start-windows`, … |
| Package name | `orbit` |
| Version | `0.5.0` |
| License | MIT, retained verbatim |

Actions keep their local ids (`start`, `start-windows`, `stop`, `stop-windows`, `status`,
`status-windows`, `phone`, `phone-windows`); only the plugin-id prefix changes.

A `NOTICE` file records that Orbit is a modified fork of `devswha/herdr-web-ui`, preserving the
MIT copyright notice as the licence requires.

## 3. What survives

Everything that talks only to the local machine and the local herdr server:

- Pane terminal, chat, file browser, diff viewer, skills, agents, sessions, prompts
- Local herdr socket integration (`HERDR_SOCKET`)
- **Phone access** via Tailscale, LAN or an SSH tunnel — `PhonePanel` and `DevicesPanel` are
  independent of the Portal relay and are untouched
- Push notifications (Web Push to *your* browsers)
- Voice input, against **your** OpenAI key
- **Remote PCs**, with the runtime bundle fetched from `hamzahraihan/orbit`
- **herdr self-update** (`/api/herdr/update` → `herdr update --handoff`), which updates the herdr
  binary from herdr's own repository — not the plugin author's

## 4. Removal inventory

Line numbers refer to the base commit `97a48035`. Every deletion below is followed by a typecheck, build and test
gate (§6).

### 4.1 Telemetry

**Delete**

| Path | Reason |
| --- | --- |
| `server/telemetry.ts` | The collector: install/update events, daily "active" events |
| `server/telemetry.test.ts` | |
| `shared/telemetry.ts` | The event schema and settings snapshot types |
| `src/components/TelemetryControls.tsx` | The notice line and Settings → About switch |
| `telemetry/` (whole dir) | The maintainer's Cloudflare Worker receiver (`worker.ts`, `worker.test.ts`, `schema.sql`, `wrangler.toml`, `deployed.json`, `README.md`) |
| `scripts/telemetry-deployed.test.ts` | Asserts the Worker's deployed fingerprint |
| `scripts/telemetry-regression.ts` | Browser QA for the telemetry settings |

**Edit**

| Path | Change |
| --- | --- |
| `server/index.ts` | Drop the import (L67), the `telemetry?` option (L283-284), the `/api/telemetry` route (L1278), the `Telemetry` construction (L2260), the `createServer` field (L2264), `telemetry.start()` (L2279) and `telemetry.stop()` (L2284) |
| `server/core/status.ts` | Drop the type import (L26), the option (L38), `VISIT_READ_MS` (L31-32) and `countVisit()` plus its call sites (L136-153) |
| `src/App.tsx` | Drop the import (L65) and `<TelemetryNotice>` (L1645) |
| `src/components/SettingsDialog.tsx` | Drop the import (L42) and `<TelemetryControls>` (L932) |
| `src/lib/api.ts` | Drop the type import (L67), `fetchTelemetry()` (L159-162), `changeTelemetry()` (L164-169) |
| `src/lib/settings.ts` | Drop the type import (L8), `TelemetrySourceSettings` (L180-182) and `telemetrySettingsSnapshot()` (L189-244) |
| `shared/protocol.ts` | Drop the `/api/telemetry` doc block (L79-83) |
| `scripts/release-guards.ts` | Drop `WORKER_SOURCES` (L73), `DEPLOYED_FILE` (L74), `workerFingerprint()` (L75-79), `workerProblems()` (L82-85), the call at L145 and the `--worker-deployed` branch (L152-158) |
| `scripts/ui-contexts-checks.ts` | Drop the import (L29) and the call (L107) |
| `scripts/ci-tests.ts` | Glob L17: drop `telemetry` |
| `scripts/conventions.test.ts` | Glob L11: drop `telemetry` |
| `scripts/fixed-sleeps.ts` | Glob L31: drop `telemetry` |
| `server/conventions.test.ts` | Globs L30 and L49: drop `telemetry` |
| `tsconfig.json` | Remove `"telemetry"` from `include` (L35) |
| `site/demo/transport.ts` | Drop the `/api/telemetry` branch (L531-532) |
| `.github/workflows/ci.yml` | Update the Worker-deploy comment (L144) |
| `.github/workflows/release.yml` | Update the Worker-deploy comment (L33-34) |
| `src/lib/i18n.{ja,ko,zh}.ts` | Delete the telemetry strings — `src/lib/i18n.test.ts` fails on unused entries |
| `docs/guide.md` | Drop "## Anonymous usage counts" (L526-536) and the `HERDR_WEB_TELEMETRY` row (L488) |
| `docs/development.md` | Drop the Worker deploy steps (L442-443, L466-467) |
| `README*.md` | Drop the anonymous-count sentence (README L140; ja/ko/zh-CN L143) |

### 4.2 Update checks

**Delete**

`server/updater.ts`, `server/updater.test.ts`, `server/supervisor.ts`, `src/lib/updates.ts`,
`src/lib/updateProgress.ts`, `src/lib/updateProgress.test.ts`, `src/lib/updateNotes.test.ts`.

**Keep, reworked**

| Path | Change |
| --- | --- |
| `server/managed.ts` | Becomes a thin launcher: spawn `server/index.ts`, forward its exit code, drop the `HANDOVER_EXIT` handover loop |
| `src/lib/updateNotes.ts` | **Delete the whole module.** `reloadReason()`'s only production consumer is `src/lib/updates.ts`, which this task also deletes; the rest (`offeredNotes`, `notesOffer`, `summaryFor`, `installedUpdate`, `announcesUpdate`, `readAnnounced`, `writeAnnounced`, `watchAnnounced`) exists only to serve an offered update. `ChunkFailureNotice` was already independent — it reads `src/lib/lazyChunk.ts` alone and its own comment calls it "the reload line alone, for a page without the update model" |
| `src/components/UpdateControls.tsx` | Delete `ReleaseNotes`, `UpdateProgress`, `UpdateControls`, `UpdateNotice`. **Keep `ChunkFailureNotice`** — it depends only on `src/lib/lazyChunk.ts` and is used by `FileReader.tsx` |
| `src/components/UpdateControls.css` | Keep — `LanExposureNotice.css` shares the `.update-notice` layout |
| `server/update-api.ts` | Reduce to the `updateRequestAllowed(request)` guard, still used by herdr self-update. Delete `connectUpdater`, `servedRevision`, `withServed` and the `/api/updates*` branch of `handleUpdateRequest` |
| `shared/update.ts` | Keep only the herdr-update surface: `HerdrUpdateStatus` and its neighbours, which `server/herdr-update.ts` and the herdr-update frontend still use. `reloadReason()` goes with `src/lib/updateNotes.ts` (see §5, item 2). Delete the rest of the app-update surface |
| `server/release-notes.ts` | After the updater is gone this module is used only by release tooling: `scripts/release-guards.ts` imports `SUMMARIES_FILE`, `scripts/release-notes.ts` imports `SUMMARIES_FILE` and `releaseSummaries`. Move those two into `scripts/release-notes.ts` and delete the server-side module and `server/release-notes.test.ts`. `compareVersions` and the server-side `releaseNotes` are used only by the deleted updater and go with it. Note `scripts/release-notes.ts` already exports a *different* `releaseNotes` — do not merge the two bodies |

**Edit**

`server/index.ts` (import L64, option L278, routes L1271-1273, `connectUpdater()` L2258),
`shared/protocol.ts` (L74-76), `src/App.tsx` (imports L62-63, `useUpdates` L287, `<UpdateNotice>`
L1644, the `updates` prop L1813, `settingsSection` L495), `src/components/SettingsDialog.tsx`
(L24, L41, L929-930, props), `src/lib/api.ts` (`fetchUpdateStatus`, `fetchUpdateNotes`,
`fetchInstalledNotes`, `requestUpdate`), `src/lib/runningVersion.ts` (keep the herdr half),
`src/lib/i18n.{ja,ko,zh}.ts`, `docs/guide.md`.

`server/herdr-update.ts` and `src/lib/herdrUpdate.ts` stay untouched.

### 4.3 Usage meters

**Delete**

`server/usage.ts`, `server/usage.test.ts`, `server/usage-login.ts`,
`server/usage-login.contract.test.ts`, `shared/usage-login.ts`, `src/lib/usage.ts`,
`src/lib/usage.test.ts`, `src/components/UsageMeters.tsx` + `.css`, `src/components/UsageSettings.tsx`
+ `.css`, `src/components/UsageAccountDialog.tsx` + `.css`, `src/components/UsageHubConnect.tsx`,
`src/components/UsageLocalLogin.tsx`, `src/components/CLIProxyLogin.tsx`,
`server/cliproxy.ts`, `server/cliproxy-routes.ts`, `server/cliproxy.test.ts`,
`server/cliproxy.fake.ts`, `scripts/usage-regression.ts`.

The CLI-proxy "Hub" goes with it: `server/cliproxy.ts` exists only to contribute provider accounts
to the usage report.

**Edit**

| Path | Change |
| --- | --- |
| `server/index.ts` | Imports L68/L71, options L286/L290, constructions L389-390, routes L1282-1283, `createStatusHub` args L627 |
| `server/core/status.ts` | Imports L27-28, params L52-53, destructure L34, `usageLogin.ended()` L313 |
| `shared/protocol.ts` | Remove `UsageProviderId`, `UsageWindow`, `UsageProblem`, `ProviderUsage`, `UsageReport`, the `CLIProxy*` types and the `/api/usage` doc block (L235) |
| `src/lib/api.ts` | Remove `fetchUsageLoginProviders`, `fetchUsageLoginAccounts`, `startUsageLogin`, `fetchUsage`, `cliProxyRequest` and the related type imports (L52, L72) |
| `src/lib/settings.ts` | Remove the `UsageCount`/`UsageGlance` types (L30-32) and the `showUsage`, `usageCount`, `usageGlance`, `usageOrder`, `usageHidden` fields (L139-148) with their defaults and sanitiser handling |
| `shared/preferences.ts` | Remove the five usage keys from `SHARED_SETTING_KEYS`: `showUsage`, `usageCount`, `usageGlance`, `usageOrder`, `usageHidden` |
| `src/components/SettingsDialog.tsx` | Import L43, the `"usage"` page case L1109, the `PAGES` entry L212, the `onUsageLogin` prop |
| `src/lib/paletteSettings.ts` | Remove `"usage"` from `SettingsPageId` (L3) and its palette entry (L24) |
| `src/components/MachineSidebar.tsx` | Remove the import (L13) and `<UsageMeters />` (L51) |
| `src/components/Composer.tsx` | Remove the import (L57), `usageEnabled`/`useUsage`/`composerUsage`/`usageWindows`/`usageLimit` (L251-255), the usage blocks (L1002-1007), the resize dependency (L1023) and the `.composer-usage` JSX (L1330-1336) |
| `src/App.tsx` | Remove the `herdr-usage-changed` dispatch (L713) and the `onUsageLogin` prop (L1813) |
| `src/lib/i18n.test.ts` | Remove the `grab("lib/usage.ts", "WINDOW_LABEL", …)` line (L75) — it throws once the module is gone |
| `scripts/ui-contexts-checks.ts` | Import L14, call L89 |
| `scripts/ci-browser.sh` | Remove the cliproxy lane (L68) |
| `scripts/ci-browser.test.ts` | Update the expected lane list |
| `scripts/pages-gate.test.ts` | Remove `checkUsageMeters` from the expected names (L267) |
| `src/lib/i18n.{ja,ko,zh}.ts` | Delete the usage strings |

The user already runs `herdr-quota-context-cache`, a separate local plugin, for quota display.

### 4.4 Portal relay

**Delete**

`server/portal.ts`, `server/portal.test.ts`, `src/components/PortalPanel.tsx` + `.css`,
`src/lib/portal.ts`, `scripts/portal-regression.ts`.

**Edit**

| Path | Change |
| --- | --- |
| `server/index.ts` | Import L66, options L281-282, routes L1275-1277, the `PortalService` construction L2261, the `createServer` field L2264, `settlePortalStartup()` in `instance.stop()` L2238, `options.portal?.shutdown()` L2248, `portal.shutdown()` in the SIGTERM handler L2288; delete the `settlePortalStartup` helper |
| `shared/protocol.ts` | Remove `PortalStatus` (L414-437) and the `/api/portal` doc block (L64-68) |
| `src/components/SettingsDialog.tsx` | Remove the import (L37) and `<PortalPanel>` (L863) |
| `src/lib/api.ts` | Remove `fetchPortal()` and `requestPortal()` (L135-143) and the `PortalStatus` import |
| `site/demo/transport.ts` | Remove the `/api/portal` branches (L535-536) |
| `scripts/ci-browser.sh` | Remove the portal lane (L71) |
| `scripts/ci-browser.test.ts` | Remove the portal lane expectation (L83) |
| `src/lib/i18n.{ja,ko,zh}.ts` | Delete the Portal strings |
| `docs/guide.md` | Drop the Portal paragraphs (L437-457) and the Portal references (L357, L484, L661, L674) |
| `DESIGN.md` | Update the Settings-layout notes (L1798, L1834-1838) |

`chunksOf` needs **no** relocation: it lives in `server/remote-bundle.ts`, which survives (§4.5).
Only `server/portal.ts` stops importing it.

### 4.5 Remote-PC bundles — repointed, not removed

The remote-PC feature stays. Only the download source changes.

| Path | Change |
| --- | --- |
| `server/remote-bundle.ts` | `bundleManifestSource()` L20: `github.com/devswha/herdr-web-ui` → `github.com/hamzahraihan/orbit` |
| `server/remote-bundle.test.ts` | Update the expected URL |
| `shared/machines.ts` | `REMOTE_BUNDLE_VERSION` stays `"31"`; our fork publishes its own `remote-v31` |
| `scripts/build-remote-bundle.ts` | Unchanged |
| `.github/workflows/remote-bundles.yml` | Unchanged — it publishes `remote-v*` tags from whichever repo runs it |

**Operational requirement:** the fork must have GitHub Actions enabled and must publish a
`remote-v31` release, or remote-PC setup fails to fetch a manifest. This is a release-engineering
step (§8), not a code change.

`HERDR_WEB_BUNDLE_MANIFEST` (local path or URL) keeps working as the override.

## 5. Structural edits

Three changes are not simple deletions:

1. **`server/managed.ts` becomes a thin launcher.** `server/supervisor.ts` existed only to run the
   updater and hand over between releases. With no releases there is nothing to hand over. The
   plugin's PID file and the `stop` path still point at `managed.ts`, so the contract is unchanged.
   `scripts/plugin.ts` already polls `/api/health` itself, so the supervisor's health gate was
   redundant.

2. **`src/lib/updateNotes.ts` is deleted whole, not reworked.** `reloadReason()` returned
   `"updated" | "restart" | "incomplete"`; the first two came from `/api/updates`. Its only
   production caller is `src/lib/updates.ts`, which goes with the updater, so nothing survives to
   call it. The chunk-failure line the user still needs does **not** go through it:
   `ChunkFailureNotice` reads `src/lib/lazyChunk.ts` alone and was already written to stand
   without the update model.

3. **`shared/protocol.ts`, `shared/update.ts`, `src/lib/settings.ts` and `src/lib/api.ts` each
   change exactly once**, centrally, rather than once per area. These four files carry most of
   the coupling between the removed features.

## 6. Sequencing and gates

One commit per area. After each: `bun run typecheck` **and** `bun run build` **and** `bun test`
must pass.

| # | Commit | Gate |
| --- | --- | --- |
| 0 | Fork, rename, rename package — **no removals yet** | typecheck + build + test |
| 1 | `refactor: remove telemetry` | typecheck + build + test |
| 2 | `refactor: remove app update checks` | typecheck + build + test |
| 3 | `refactor: remove usage meters` | typecheck + build + test |
| 4 | `refactor: remove the portal relay` | typecheck + build + test |
| 5 | `refactor: point the remote bundle at orbit` | typecheck + build + test |
| 6 | `docs: drop the removed features from the prose docs` | typecheck + build + test |
| 7 | `chore: install orbit as the herdr plugin` | live smoke test |

**Translation units are not split from their code.** The ja/ko/zh dictionary entries for a removed
feature ship **in the same commit** as the component that used them: `src/lib/i18n.test.ts` fails
when a dictionary holds an entry the code no longer uses, so leaving them behind breaks the gate
at commit *n* rather than commit 6. The **prose** documentation (README, `docs/guide.md`,
`docs/development.md`, `DESIGN.md`) does not affect any gate and is applied in commit 6, from
the per-area documentation lists in §4.

Commit 0 is deliberate: if the fork does not build green *before* any surgery, a broken fork and
a broken removal are indistinguishable.

Commit 0 contains: `package.json` (name `orbit`, version `0.5.0`, repository `hamzahraihan/orbit`),
`herdr-plugin.toml` (id `hamzahraihan.orbit`, name `Orbit`, version `0.5.0`, description), the
`NOTICE` file, and the `devswha/herdr-web-ui` → `hamzahraihan/orbit` reference sweep across
`README*.md`, `INSTALL.md`, `SECURITY.md`, `CONTRIBUTING.md`, `install.sh`, `install.ps1`,
`docs/`, `scripts/`, `.github/ISSUE_TEMPLATE/`, `server/push.ts`, `src/components/PhonePanel.tsx`,
`src/components/SettingsDialog.tsx`, `src/components/UpdateControls.tsx`.

## 7. Why the repository is public

The bundle fetch is a plain `fetch()` with **no `Authorization` header**, so GitHub rejects
anonymous downloads of release assets from a private repository. Two options were considered:

| Option | Outcome |
| --- | --- |
| Private repo + `HERDR_WEB_BUNDLE_TOKEN` | Works, but adds new code (token plumbing) and puts a PAT in a config file |
| **Public repo, no token** | **Chosen.** The fetch stays exactly as upstream wrote it; no new code, no secret on disk |

Consequence: Orbit's source is publicly readable. The MIT licence permits this and requires the
copyright notice, which is retained. Nothing private is in the tree — the removal is the point.

## 8. Verification

**Per commit:** `bun run typecheck`, `bun run build`, `bun test`.

**Final, against the running plugin:**

1. `herdr plugin uninstall devswha.herdr-web-ui`, then
   `herdr plugin link C:\herdr-plugins-project\orbit`
2. `herdr plugin action invoke hamzahraihan.orbit.start-windows` → exit 0
3. `GET http://127.0.0.1:7317/api/health` → 200
4. `GET http://127.0.0.1:7317/api/telemetry` → **404** (`not_found`, "This server sends no telemetry")
5. `GET /api/usage`, `/api/portal`, `/api/updates` → **404**
6. `grep -r "workers.dev" dist/ server/ shared/ src/` → **no hits**
7. `grep -r "api.anthropic.com\|chatgpt.com\|api2.cursor.sh\|cli-chat-proxy.grok.com\|cloudcode-pa\|opencode.ai/zen" dist/ server/ src/` → **no hits**
8. `grep -r "github.com/devswha/herdr-web-ui" .` (excluding `upstream` refs and `CHANGELOG.md`) → **no hits**
9. `herdr plugin action invoke hamzahraihan.orbit.phone-windows` opens the Phone setup pane and it
   still renders the QR code — the phone path never went through the Portal
10. Publish `remote-v31` from the fork and set up a remote PC end to end

## 9. Upstream drift

**Upstream is a reference, not a merge source.**

`git merge upstream/main` would conflict in nearly every file Orbit touches, because the removals
rewrite `shared/protocol.ts`, `src/lib/settings.ts` and `src/lib/api.ts` heavily. Instead:

- `upstream` stays a read-only remote.
- The removals land as isolated, well-named commits (§6), so an individual upstream fix can be
  cherry-picked: `git cherry-pick <sha>` when the fix does not touch removed code, or ported by
  hand when it does.
- `git log upstream/main -- <file>` to spot candidates.
- Orbit's `main` is the source of truth. Upstream is never merged into it automatically.

Upstream `main` is 106 commits ahead of the `97a48035` base. Those commits remain reachable and
cherry-pickable. The base was chosen as `97a48035` because it is the exact commit that was
running on this machine — the one the removal inventory in §4 was verified against — and because
it sits on the released `0.4.12` line rather than in the middle of unreleased feature work.
It is 7 commits after the `v0.4.12` tag, and those 7 commits include refactors that moved code
into `server/core/`, so the `v0.4.12` tag itself is **not** the right base: the inventory's
locations (for example `countVisit()` in `server/core/status.ts`) do not exist there.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| The i18n test fails on dictionary entries the code no longer uses | Delete the matching ja/ko/zh strings in the same commit as the component that used them (§4) |
| Four shared files carry most of the coupling | Change each once, centrally (§5, item 3) |
| `server/release-notes.ts` is used by release tooling, not only the runtime updater | Move `SUMMARIES_FILE` and `releaseSummaries` to `scripts/` rather than deleting them (§4.2) |
| The fork's CI workflows reference upstream-only infrastructure (the telemetry Worker) | Strip the Worker references from `ci.yml` and `release.yml` in commit 1 |
| The remote-PC feature has no bundle until `remote-v31` is published from the fork | Publish it as part of commit 7 (§8.10) |
| Removing the usage meters leaves the `herdr-quota-context-cache` plugin as the only quota path | Intentional — that plugin is already installed |
| The browser-QA scripts need a real browser | Out of scope for the gates; the unit suite is the gate |

## 11. Out of scope

- Adding features to Orbit
- Supporting platforms upstream does not support
- Republishing remote-PC bundles for other people's machines
- Any change to the herdr binary itself
