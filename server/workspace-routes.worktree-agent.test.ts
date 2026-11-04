// server/workspace-routes.worktree-agent.test.ts
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { agentGet } from "./herdr/client.ts";

describe("worktree create with agent", () => {
  let server: ReturnType<typeof createServer>;
  const stateDir = mkdtempSync(join(tmpdir(), "herdr-web-ui-worktree-agent-"));

  beforeAll(() => {
    server = createServer({ port: 0, stateDir });
  });

  afterAll(() => {
    server?.stop();
  });

  const base = () => `http://localhost:${server.port}`;

  it("POST /api/worktree/create with agent starts agent in new worktree", async () => {
    // Create workspace with a repo that has commits (use temp dir as test repo)
    const testRepoPath = mkdtempSync(join(tmpdir(), "herdr-test-repo-"));
    
    // Initialize a git repo with a commit
    const { $ } = await import("bun");
    await $`git -C ${testRepoPath} init`.quiet();
    await $`git -C ${testRepoPath} config user.email "test@test.com"`.quiet();
    await $`git -C ${testRepoPath} config user.name "Test"`.quiet();
    await $`echo "test" > ${testRepoPath}/README.md`.quiet();
    await $`git -C ${testRepoPath} add README.md`.quiet();
    await $`git -C ${testRepoPath} commit -m "initial"`.quiet();

    // Create workspace via HTTP
    const wsResp = await fetch(`${base()}/api/workspace/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: testRepoPath, agent: null })
    });
    expect(wsResp.status).toBe(200);
    const wsBody = await wsResp.json();
    const { workspace_id } = wsBody;

    // Create worktree with agent via HTTP
    const wtResp = await fetch(`${base()}/api/worktree/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id, branch: "worktree/test-agent", agent: { kind: "claude", name: "test-agent" } })
    });

    expect(wtResp.status).toBe(200);
    const body = await wtResp.json();
    expect(body.agent_started).toBe(true);
    expect(body.pane_id).toBeDefined();
    expect(body.branch).toBe("worktree/test-agent");

    // Verify herdr sees the agent in the new pane
    const agent = await agentGet(body.pane_id);
    expect(agent.name).toBe("test-agent");
  }, 60000);
});