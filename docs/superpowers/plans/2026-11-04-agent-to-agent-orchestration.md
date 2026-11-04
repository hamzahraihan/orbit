# Agent-to-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable phone/desktop to launch a second agent from a first agent's findings via "New worktree" with agent picker — explore→implement without desktop herdr.

**Architecture:** Reuse existing `worktree.create` + `agent.start` flows. No new message bus, no agent self-spawn. Human-triggered only via Orbit UI (`Sidebar.tsx` → `WorktreeDialog.tsx` → `POST /api/worktree/create` with `agent` → `server/workspace-routes.ts` calls `worktreeCreate` then `agentLaunch`).

**Tech Stack:** React 19 (src/), Bun server (server/), shared wire protocol (shared/), herdr RPC over unix socket.

**Spec:** `docs/superpowers/specs/2026-11-04-agent-to-agent-orchestration.md`

---

## Global Constraints

- **Bridge purity**: herdr owns ptys, processes, scrollback. Orbit never `--takeover`, never loads `node-pty` in Bun. (`AGENTS.md`, `PRODUCT.md`)
- **Single RPC per call**: herdr closes socket after each answer; only `events.subscribe` stays open. (`AGENTS.md`)
- **Draft safety**: user input waits in explicit draft banner; never auto-sent on reconnect. (`AGENTS.md`)
- **Zero telemetry/cloud**: local-first, private. (`PRODUCT.md`)
- **Theme/token rules**: colors only in `src/styles.css` theme blocks; run `generate:themes` after. (`AGENTS.md`, `docs/development.md`)
- **Generated files**: never edit `shared/herdr-api.generated.ts`, `src/lib/themes.generated.ts`; run `generate:types`, `generate:themes`. (`AGENTS.md`)
- **Test isolation**: tests use isolated herdr session (`herdr-web-ui-test`), `mkdtempSync` stateDir, `port: 0`. Never touch real herdr. (`docs/development.md`)
- **TypeScript strict**: `bun run typecheck` must pass. Generated types refreshed via `bun run generate:types --refresh`.

---

## Review Focus (spec-implied inputs most likely to bite)

1. **Empty repo**: `worktree.create` on repo with no commits → 409 `repository_without_commits` (server/workspace-routes.ts:228-230) — test handles gracefully in UI.
2. **Concurrent create**: two rapid New worktree taps → `agent_name_taken` retry logic (agent-launch.ts:55-56) — test shows one succeeds, one retries with new name.
3. **Agent pane busy**: `agent_pane_busy` retry up to 10s deadline (agent-launch.ts:38,51-54) — test with slow agent start shows retry + success.
4. **Linked worktree source missing**: fallback to `worktreeList` source workspace (workspace-routes.ts:211-216) — test when source workspace gone.
5. **Draft preserved across worktree switch**: user typing in agent A, switches to agent B via sidebar, returns — draft for A intact (composer state).

---

## Task 1: Verify existing worktree+agent create flow works end-to-end

**Files:**
- Test: `server/workspace-routes.test.ts` (new)
- Modify: none (read-only verification)

**Interfaces:**
- Consumes: `server/workspace-routes.ts:165-233` (`POST /api/worktree/create`), `server/agent-launch.ts:28-71` (`agentLaunch`), `server/herdr/client.ts:436-448` (`worktreeCreate`)
- Produces: passing integration test proving flow works

- [ ] **Step 1: Write failing integration test for worktree create with agent**

```typescript
// server/workspace-routes.worktree-agent.test.ts
import { createServer } from "./server.ts";
import { createTestHerdr } from "../scripts/test-herdr.ts";

test("POST /api/worktree/create with agent starts agent in new worktree", async () => {
  const herdr = await createTestHerdr();
  const server = createServer({ herdrSocket: herdr.socketPath });
  
  // Create workspace with a repo that has commits
  const wsResp = await server.inject({ method: "POST", url: "/api/workspace/create", payload: { cwd: herdr.testRepoPath, agent: null } });
  const { workspace_id } = await wsResp.json();
  
  // Create worktree with agent
  const wtResp = await server.inject({
    method: "POST",
    url: "/api/worktree/create",
    payload: { workspace_id, branch: "worktree/test-agent", agent: { kind: "claude", name: "test-agent" } }
  });
  
  expect(wtResp.statusCode).toBe(200);
  const body = await wtResp.json();
  expect(body.agent_started).toBe(true);
  expect(body.pane_id).toBeDefined();
  expect(body.branch).toBe("worktree/test-agent");
  
  // Verify herdr sees the new worktree + agent
  const panes = await herdr.rpc("pane.list", {});
  const newPane = panes.find(p => p.agent?.name === "test-agent");
  expect(newPane).toBeDefined();
  
  await herdr.stop();
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails (no test file exists yet)**

Run: `bun test server/workspace-routes.worktree-agent.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Create test file with the test above**

Create: `server/workspace-routes.worktree-agent.test.ts` with the test code

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/workspace-routes.worktree-agent.test.ts --timeout 30000`
Expected: PASS — proves existing flow works

- [ ] **Step 5: Run typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/workspace-routes.worktree-agent.test.ts
git commit -m "test: verify worktree create with agent flow works"
```

---

## Task 2: Add unit test for empty repo error handling in worktree create

**Files:**
- Test: `server/workspace-routes.empty-repo.test.ts` (new)
- Modify: none

**Interfaces:**
- Consumes: `server/workspace-routes.ts:228-230` (empty repo → 409)
- Produces: passing unit test

- [ ] **Step 1: Write failing unit test for empty repo**

```typescript
// server/workspace-routes.empty-repo.test.ts
import { createServer } from "./server.ts";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

test("POST /api/worktree/create on empty repo returns 409 repository_without_commits", async () => {
  const emptyRepo = mkdtempSync(`${tmpdir()}/empty-repo-`);
  // git init but no commits
  await $`git init`.cwd(emptyRepo).quiet();
  await $`git config user.email "test@test"`.cwd(emptyRepo).quiet();
  await $`git config user.name "Test"`.cwd(emptyRepo).quiet();
  
  const server = createServer({ /* minimal config */ });
  
  const wsResp = await server.inject({ method: "POST", url: "/api/workspace/create", payload: { cwd: emptyRepo, agent: null } });
  const { workspace_id } = await wsResp.json();
  
  const wtResp = await server.inject({
    method: "POST",
    url: "/api/worktree/create",
    payload: { workspace_id, branch: "worktree/test", agent: { kind: "claude" } }
  });
  
  expect(wtResp.statusCode).toBe(409);
  const body = await wtResp.json();
  expect(body.error).toBe("repository_without_commits");
  
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/workspace-routes.empty-repo.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Create test file**

Create: `server/workspace-routes.empty-repo.test.ts` with the test

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/workspace-routes.empty-repo.test.ts --timeout 15000`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/workspace-routes.empty-repo.test.ts
git commit -m "test: empty repo returns 409 on worktree create"
```

---

## Task 3: Add unit test for agent_name_taken retry (concurrent creates)

**Files:**
- Test: `server/agent-launch.concurrent-name.test.ts` (new)
- Modify: none

**Interfaces:**
- Consumes: `server/agent-launch.ts:55-56` (retries up to 3 times when name not explicit)
- Produces: passing unit test

- [ ] **Step 1: Write failing test for concurrent name collision**

```typescript
// server/agent-launch.concurrent-name.test.ts
import { agentLaunch } from "./agent-launch.ts";
import { createMockHerdrClient } from "./herdr/client.mock.ts";

test("agentLaunch retries on agent_name_taken when name not explicit", async () => {
  const mockClient = createMockHerdrClient();
  let callCount = 0;
  mockClient.agentStart = async (params) => {
    callCount++;
    if (callCount <= 2) throw { code: "agent_name_taken", message: "name taken" };
    return { type: "agent_started", agent: { name: params.name || "claude-2" } };
  };
  
  const result = await agentLaunch("pane-1", { kind: "claude" }, mockClient);
  
  expect(result.agent_started).toBe(true);
  expect(callCount).toBe(3); // initial + 2 retries
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/agent-launch.concurrent-name.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Create test file**

Create: `server/agent-launch.concurrent-name.test.ts` with the test

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/agent-launch.concurrent-name.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/agent-launch.concurrent-name.test.ts
git commit -m "test: agentLaunch retries on name collision"
```

---

## Task 4: Add unit test for agent_pane_busy retry with deadline

**Files:**
- Test: `server/agent-launch.busy-pane.test.ts` (new)
- Modify: none

**Interfaces:**
- Consumes: `server/agent-launch.ts:38,51-54` (retries until 10s deadline)
- Produces: passing unit test

- [ ] **Step 1: Write failing test for busy pane retry**

```typescript
// server/agent-launch.busy-pane.test.ts
import { agentLaunch } from "./agent-launch.ts";
import { createMockHerdrClient } from "./herdr/client.mock.ts";

test("agentLaunch retries on agent_pane_busy until 10s deadline", async () => {
  const mockClient = createMockHerdrClient();
  let callCount = 0;
  const start = Date.now();
  mockClient.agentStart = async () => {
    callCount++;
    if (Date.now() - start < 100) throw { code: "agent_pane_busy", message: "busy" };
    return { type: "agent_started", agent: { name: "claude" } };
  };
  
  const result = await agentLaunch("pane-1", { kind: "claude" }, mockClient);
  
  expect(result.agent_started).toBe(true);
  expect(callCount).toBeGreaterThan(1);
  expect(Date.now() - start).toBeLessThan(11000); // deadline respected
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/agent-launch.busy-pane.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Create test file**

Create: `server/agent-launch.busy-pane.test.ts` with the test

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/agent-launch.busy-pane.test.ts --timeout 15000`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/agent-launch.busy-pane.test.ts
git commit -m "test: agentLaunch retries on busy pane within deadline"
```

---

## Task 5: Add unit test for linked worktree source missing fallback

**Files:**
- Test: `server/workspace-routes.linked-worktree-fallback.test.ts` (new)
- Modify: none

**Interfaces:**
- Consumes: `server/workspace-routes.ts:211-216` (fallback to `worktreeList` source workspace)
- Produces: passing unit test

- [ ] **Step 1: Write failing test for linked worktree fallback**

```typescript
// server/workspace-routes.linked-worktree-fallback.test.ts
import { createServer } from "./server.ts";
import { createTestHerdr } from "../scripts/test-herdr.ts";

test("worktree create falls back to source workspace when linked_worktree_source fails", async () => {
  const herdr = await createTestHerdr();
  const server = createServer({ herdrSocket: herdr.socketPath });
  
  // Setup: create workspace, then linked worktree, then remove source
  const wsResp = await server.inject({ method: "POST", url: "/api/workspace/create", payload: { cwd: herdr.testRepoPath } });
  const { workspace_id: ws1 } = await wsResp.json();
  
  const wtResp1 = await server.inject({
    method: "POST", url: "/api/worktree/create",
    payload: { workspace_id: ws1, branch: "linked-branch", path: "/tmp/linked-wt" }
  });
  const { workspace_id: ws2 } = await wtResp1.json();
  
  // Now simulate linked_worktree_source error by removing source workspace from herdr
  await herdr.rpc("workspace.remove", { workspace_id: ws1, force: true });
  
  // Try to open the linked worktree — should fallback
  const openResp = await server.inject({
    method: "POST", url: "/api/worktree/open",
    payload: { workspace_id: ws2, branch: "linked-branch" }
  });
  
  expect(openResp.statusCode).toBe(200);
  const body = await openResp.json();
  expect(body.workspace_id).toBeDefined();
  expect(body.already_open).toBe(true);
  
  await herdr.stop();
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/workspace-routes.linked-worktree-fallback.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Create test file**

Create: `server/workspace-routes.linked-worktree-fallback.test.ts` with the test

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/workspace-routes.linked-worktree-fallback.test.ts --timeout 30000`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/workspace-routes.linked-worktree-fallback.test.ts
git commit -m "test: linked worktree falls back to source workspace"
```

---

## Task 6: Verify phone UI worktree dialog agent picker works (browser test)

**Files:**
- Test: `scripts/worktree-agent-picker-browser.test.ts` (new)
- Modify: none (read-only verification)

**Interfaces:**
- Consumes: `src/components/WorktreeDialog.tsx`, `src/lib/api.ts:608-611`, `src/lib/agentLaunchMode.ts`
- Produces: passing browser regression test

- [ ] **Step 1: Write failing browser test for phone worktree dialog**

```typescript
// scripts/worktree-agent-picker-browser.test.ts
import { test, expect } from "@playwright/test";
import { createTestServer } from "../server/test-server.ts";

test("phone worktree dialog shows agent picker and creates worktree with agent", async ({ page }) => {
  const server = await createTestServer();
  await page.goto(`http://localhost:${server.port}?phone=1`);
  
  // Navigate to an agent chat
  await page.click('[data-testid="sidebar-workspace"] >> text=explore-api');
  await page.click('[data-testid="chat-tab"]');
  
  // Open worktree dialog
  await page.click('[data-testid="sidebar-menu-button"]');
  await page.click('text=New worktree');
  
  // Verify dialog opens with agent picker
  await expect(page.locator('[data-testid="worktree-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="agent-picker"]')).toBeVisible();
  
  // Fill branch, pick agent, create
  await page.fill('[data-testid="worktree-branch-input"]', 'worktree/implement-api-test');
  await page.selectOption('[data-testid="agent-picker"]', 'claude');
  await page.click('[data-testid="worktree-create-button"]');
  
  // Verify success — new worktree appears in sidebar
  await expect(page.locator('[data-testid="sidebar-workspace"] >> text=implement-api-test')).toBeVisible({ timeout: 10000 });
  
  // Verify agent started — chat shows agent status
  await page.click('[data-testid="sidebar-workspace"] >> text=implement-api-test');
  await expect(page.locator('[data-testid="agent-status"] >> text=Working')).toBeVisible({ timeout: 15000 });
  
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/worktree-agent-picker-browser.test.ts`
Expected: FAIL — file not found or selectors need adjustment

- [ ] **Step 3: Create test file**

Create: `scripts/worktree-agent-picker-browser.test.ts` with the test (adjust selectors to match actual DOM)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/worktree-agent-picker-browser.test.ts --timeout 60000`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/worktree-agent-picker-browser.test.ts
git commit -m "test: phone worktree dialog agent picker creates worktree with agent"
```

---

## Task 7: Verify draft preservation across worktree switch

**Files:**
- Test: `src/lib/drafts.test.ts` (new or extend existing)
- Modify: `src/lib/drafts.ts` if draft logic exists, or `src/components/ChatComposer.tsx`

**Interfaces:**
- Consumes: draft storage keyed by pane_id
- Produces: passing unit test

- [ ] **Step 1: Write failing test for draft preservation**

```typescript
// src/lib/drafts.test.ts (or extend existing)
import { DraftManager } from "./drafts.ts";

test("draft preserved when switching between panes", () => {
  const drafts = new DraftManager();
  
  // Type in pane A
  drafts.setDraft("pane-A", "explore this API");
  expect(drafts.getDraft("pane-A")).toBe("explore this API");
  
  // Switch to pane B (simulate sidebar navigation)
  drafts.setDraft("pane-B", "implement that");
  expect(drafts.getDraft("pane-B")).toBe("implement that");
  
  // Return to pane A — draft intact
  expect(drafts.getDraft("pane-A")).toBe("explore this API");
  
  // Clear pane B draft
  drafts.clearDraft("pane-B");
  expect(drafts.getDraft("pane-B")).toBe("");
  // pane A still intact
  expect(drafts.getDraft("pane-A")).toBe("explore this API");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/drafts.test.ts`
Expected: FAIL — file not found or DraftManager not exported

- [ ] **Step 3: Create/extend test file and ensure DraftManager is testable**

Create: `src/lib/drafts.test.ts` (if `src/lib/drafts.ts` exists, extend it; if not, check `ChatComposer.tsx` for draft logic and extract)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/drafts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/drafts.test.ts src/lib/drafts.ts  # if created
git commit -m "test: draft preserved across pane/worktree switch"
```

---

## Task 8: Run full check suite and verify no regressions

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: all above tests
- Produces: clean `bun run check fast` and `bun run check integration`

- [ ] **Step 1: Run fast checks**

Run: `bun run check fast`
Expected: PASS — workflow syntax, generated types, typecheck, build, unit tests

- [ ] **Step 2: Run integration checks**

Run: `bun run check integration`
Expected: PASS — build + integration tests on isolated herdr

- [ ] **Step 3: Run browser regression (optional, if CI capacity)**

Run: `bun run test:ui` or `bun run check browser`
Expected: PASS — browser scripts on isolated fixtures

- [ ] **Step 4: Commit any test adjustments**

```bash
git add -A
git commit -m "chore: test adjustments after full check suite"
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-11-04-agent-to-agent-orchestration.md`. Please review the plan. Which execution approach would you prefer?**

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

**For this plan I recommend Subagent-driven, because** the tasks are independent (each adds a test for existing code paths) and a shipped mistake in orchestration could leave agents in bad states — independent review per task catches boundary issues early. Does the plan capture what you want, and which approach should we use?