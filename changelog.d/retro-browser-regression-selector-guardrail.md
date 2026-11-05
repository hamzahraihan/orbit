# Retro: Browser regression selector drift

## What happened

PR #20's `CI / Browser regression (ui-regression)` failed because `scripts/ui-regression.ts` used DOM selectors (`.workspace-group`, `.workspace-header`, `.workspace-name`, `.pane-select`, `.pane-item.is-selected`) that were removed in the sidebar redesign between PR #15 and PR #20. The first assertion timed out after 10s because `.workspace-name` no longer exists.

The earlier `daa9500e` ("fix(ci): unblock fast checks and browser regression on main") only treated a symptom — it seeded `herdr-web-ui:onboarded=1` to work around the onboarding overlay — but did not fix the root cause: stale selectors in test scripts.

## Root cause

The repo enforces conventions through `conventions.test.ts` files (imports, fixed sleeps, demo transport, CSS tokens, etc.), but there is **no guardrail that catches stale DOM selectors in browser test scripts**. Every regression test script queries classes like `.workspace-name` and `.pane-select`, and nothing verifies those classes still exist in `src/` when the sidebar or any DOM structure changes.

## Fix

Two micro commits:
- `abb74356` — `scripts/ui-regression.ts`: rewrote all stale selectors to the current DOM (`.sidebar-row[data-workspace=...]`, `.sidebar-row-title`, `[data-pane][title^="... —"]`, `.sidebar-row.is-selected`, etc.).
- `9a095b87` — `scripts/ui-regression.ts` + `scripts/palette-keys-regression.ts`: fixed palette-search to wait for paneB's result rather than exactly 1 result, replaced unreliable Tab navigation with a direct click, and applied the same `.pane-select` fix.

## Retro candidates (severity order)

### 1. Missing guardrail for DOM selector drift (High)

**Automated checks.** The conventions tests protect imports, fixed sleeps, demo transport, CSS tokens, and removed features — but nothing prevents a test script from querying a selector that no longer exists in the app. This is a **mechanical** violation: a fixed syntactic pattern (a CSS class string in a test script) whose absence from the source can be checked deterministically.

**Recommendation:** Add a conventions test (likely in `scripts/conventions.test.ts` or a new `scripts/selectors.test.ts`) that scans `scripts/*-regression.ts`, `scripts/*-browser-qa.ts`, and similar test scripts for CSS class selectors (`.foo`, `[data-foo]`, etc.) and fails when a referenced class does not appear in `src/` component files or `src/styles.css`. This catches selector drift at commit time, before CI.

This is cheaper than the review agent catching it: the review agent receives a diff with no easy way to know whether `.workspace-name` still exists in `src/`.

### 2. Symptom-only fix merged (Medium)

`daa9500e` merged because it addressed the onboarding overlay symptom while leaving the selector drift in place. The convention tests passed, so the PR looked green locally; the failure only appeared in CI's browser lane.

**Recommendation:** The new selector guardrail (above) would have blocked `daa9500e` itself if it touched selectors, and will block any future PR that changes the DOM without updating test scripts.

### 3. Navigation (Low)

Finding the failing script was easy (CI job name → `scripts/ui-regression.ts`), but mapping old selectors to new ones required reading `src/components/Sidebar.tsx`, `src/components/CommandPalette.tsx`, and `src/styles.css`. A navigation pointer in `AGENTS.md` like "DOM selector changes: check `scripts/*-regression.ts`" would have shortened the investigation.

## Decisions

- The selector fix is a **mechanical** rule (class-name existence) → implement as an automated check, not a coding-standard prose rule in `CODING_STANDARDS.md`.
- No changes to `AGENTS.md` needed yet; the existing conventions-test mechanism is the right place for the new guardrail.
- No tool-economy changes: the local `CHECK_DIR=.ci bun scripts/ui-regression.ts` reproduction loop was effective once the failing script was identified.
