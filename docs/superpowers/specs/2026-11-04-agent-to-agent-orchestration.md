# Agent-to-Agent Orchestration Spec

> **For agentic workers:** This spec defines the job-to-be-done and acceptance criteria. The implementation plan (`docs/superpowers/plans/...`) argues from this spec.

**Goal:** Enable a human on phone/browser to launch a second agent from a first agent's findings — "explore→implement" — without opening desktop herdr. Orbit implements the launch via herdr's `worktree.create` + `agent.start`; herdr owns the new pty.

**Architecture:** Reuse existing server/client worktree/tab/agent flows (`server/workspace-routes.ts`, `server/agent-launch.ts`, `shared/protocol.ts`, `src/lib/api.ts`, `Sidebar.tsx` → New worktree → `WorktreeDialog.tsx`). No new message bus, no agent self-spawn, no conductor. All orchestration is human-triggered via Orbit UI.

**Tech Stack:** React 19 (src/), Bun server (server/), shared wire protocol (shared/), herdr RPC over unix socket.

**Spec:** This document. **Decision trail:** `GLOSSARY.md`, `docs/adr/0001-agent-to-agent-orchestration.md`, `docs/research/competitor-gaps-2026-11-04.md`.

---

## 1. Job Story (from PRODUCT.md)

> When I'm away from my desk (couch, commute, phone in hand) and an agent finishes exploration, I want to launch an implementation agent from its findings with one tap — so long-running agent tasks keep moving without me sitting at a desktop terminal.

## 2. Scope

**In scope:**
- Phone/desktop UI: from an agent's chat view, "New worktree" action pre-fills branch from current worktree, offers agent picker, and on submit calls `POST /api/worktree/create` with `agent` payload → herdr creates worktree + tab + starts agent.
- Server: `workspace-routes.ts` already accepts `agent` on worktree create (line 195: `agent` only honoured on create). `agentLaunch` called after `worktreeCreate` returns `root_pane`.
- Client: `WorktreeDialog.tsx` already has `agent` field via `launchAgent()` defaulting to remembered agent (line 47, 98). `api.ts` `createWorktree` sends full body.
- Herdr contract: `worktree.create` returns `WorkspaceCreated` with `root_pane`; `agent.start` takes `AgentStartParams{name,kind,pane_id,args?,timeout_ms?}`.

**Out of scope (ADR-0001):**
- Agent-to-agent messaging (walky-talky)
- Conductor/router assigning work
- Agent self-spawn (running agent launches helpers)
- Native apps, cloud relays, telemetry, `--takeover`

## 3. Acceptance Criteria (Proof Scenario)

From `docs/guide.md:300` and `PRODUCT.md`:

1. **Phone opens agent A's chat** (e.g. "explore-api" on branch `worktree/explore-api-abc`).
2. **Phone taps ⋯ → New worktree** → dialog opens, branch pre-filled as `worktree/implement-api-xyz`, agent picker defaults to remembered agent (or last used).
3. **Phone taps Create** → `POST /api/worktree/create {workspace_id, branch, agent: {kind, name?, args?}}`.
4. **Server** creates worktree via `worktreeCreate`, then `agentLaunch(root_pane.pane_id, agent)`.
5. **Response** includes `{workspace_id, pane_id, agent_started: true, branch, path}`.
6. **Phone UI** shows new worktree in sidebar, tapping it opens agent B's chat — same pane, new branch, agent running.
7. **Desktop herdr** unchanged — worktree appears as new tab under same workspace, agent running in it. No desync.
8. **Draft safety** (`AGENTS.md`): nothing typed is sent automatically across disconnects; held input waits in draft banner.
9. **Bridge purity** (`AGENTS.md`): never pass `--takeover` to `herdr terminal attach` on Orbit's initiative; herdr owns pty lifecycle.

## 4. Current State vs Required Changes

| Component | Current | Required |
|-----------|---------|----------|
| `server/workspace-routes.ts:165-233` | Accepts `agent` on create, calls `agentLaunch` | ✅ Already works — verify tests cover it |
| `server/agent-launch.ts:28-71` | `agentLaunch(paneId, agent)` retries busy/name-taken, auto-names | ✅ Already works |
| `shared/protocol.ts:774-783` | `CreateWorktreeRequest.agent?: {kind, name?, args?}` | ✅ Already typed |
| `src/lib/api.ts:608-611` | `createWorktree` POSTs full body incl. agent | ✅ Already works |
| `src/components/WorktreeDialog.tsx:138` | Sends `agent: launchAgent(agentKind, settings)` | ✅ Already wired |
| `src/components/Sidebar.tsx:407-410` | "New worktree" action opens dialog | ✅ Already wired |
| **Tests** | Unit: `server/agent-launch.test.ts`? Contract: `bun run check integration`? Browser: `bun scripts/...` | ❓ Verify coverage; add missing e2e for phone flow |
| **Phone UX** | Dialog shows agent picker, remembered default | ❓ Verify `launchAgent()` fallback chain works for first-time users |

## 5. Constraints (Global)

- **Bridge purity**: herdr owns ptys, processes, scrollback. Orbit never `--takeover`, never loads `node-pty` in Bun. (`AGENTS.md`, `PRODUCT.md`)
- **Single RPC per call**: herdr closes socket after each answer; only `events.subscribe` stays open. (`AGENTS.md`)
- **Draft safety**: user input waits in explicit draft banner; never auto-sent on reconnect. (`AGENTS.md`)
- **Zero telemetry/cloud**: local-first, private. (`PRODUCT.md`)
- **Theme/token rules**: colors only in `src/styles.css` theme blocks; run `generate:themes` after. (`AGENTS.md`, `docs/development.md`)
- **Generated files**: never edit `shared/herdr-api.generated.ts`, `src/lib/themes.generated.ts`; run `generate:types`, `generate:themes`. (`AGENTS.md`)

## 6. Review Focus (inputs spec implies but tasks may not exercise)

1. **Empty repo**: `worktree.create` on repo with no commits → 409 `repository_without_commits` (server/workspace-routes.ts:228-230) — test handles gracefully in UI.
2. **Concurrent create**: two rapid New worktree taps → `agent_name_taken` retry logic (agent-launch.ts:55-56) — test shows one succeeds, one retries with new name.
3. **Agent pane busy**: `agent_pane_busy` retry up to 10s deadline (agent-launch.ts:38,51-54) — test with slow agent start shows retry + success.
4. **Linked worktree source missing**: fallback to `worktreeList` source workspace (workspace-routes.ts:211-216) — test when source workspace gone.
5. **Draft preserved across worktree switch**: user typing in agent A, switches to agent B via sidebar, returns — draft for A intact (src/lib/drafts.ts if exists, or composer state).

---

**Spec complete.** Next: `/to-tickets` to split into tracer-bullet tickets with blocking edges, then `/implement` per ticket (multi-session) or `/implement-spec` (one run).