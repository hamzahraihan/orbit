// server/workspace-routes.empty-repo.test.ts
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";

describe("empty repo error handling in worktree create", () => {
  let server: ReturnType<typeof createServer>;
  const stateDir = mkdtempSync(join(tmpdir(), "herdr-web-ui-empty-repo-"));

  beforeAll(() => {
    server = createServer({ port: 0, stateDir, machines: false });
  });

  afterAll(() => {
    server?.stop();
  });

  const base = () => `http://localhost:${server.port}`;

  it("POST /api/worktree/create on empty repo returns 409 repository_without_commits", async () => {
    // Create an empty git repo (no commits)
    const emptyRepo = mkdtempSync(join(tmpdir(), "empty-repo-"));
    const { $ } = await import("bun");
    await $`git -C ${emptyRepo} init`.quiet();
    await $`git -C ${emptyRepo} config user.email "test@test.com"`.quiet();
    await $`git -C ${emptyRepo} config user.name "Test"`.quiet();

    // Create workspace via HTTP
    const wsResp = await fetch(`${base()}/api/workspace/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: emptyRepo, agent: null })
    });
    expect(wsResp.status).toBe(200);
    const { workspace_id } = await wsResp.json();

    // Try to create worktree - should fail with 409
    const wtResp = await fetch(`${base()}/api/worktree/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id, branch: "worktree/test", agent: { kind: "claude" } })
    });

    expect(wtResp.status).toBe(409);
    const body = await wtResp.json();
    expect(body.error.code).toBe("repository_without_commits");
  }, 15000);
});