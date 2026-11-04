// server/workspace-routes.linked-worktree-fallback.test.ts
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { workspaceCreate, workspaceClose, sessionSnapshot } from "./herdr/client.ts";

describe("linked worktree fallback when source workspace missing", () => {
  let server: ReturnType<typeof createServer>;
  const stateDir = mkdtempSync(join(tmpdir(), "herdr-web-ui-linked-wt-fallback-"));

  beforeAll(() => {
    server = createServer({ port: 0, stateDir, machines: false });
  });

  afterAll(() => {
    server?.stop();
    rmSync(stateDir, { recursive: true, force: true });
  });

  const base = () => `http://localhost:${server.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /api/worktree/create falls back to source workspace when linked_worktree_source fails", async () => {
    // Create a test repo with a commit
    const testRepoPath = mkdtempSync(join(tmpdir(), "herdr-test-repo-fallback-"));
    const { $ } = await import("bun");
    await $`git -C ${testRepoPath} init`.quiet();
    await $`git -C ${testRepoPath} config user.email "test@test.com"`.quiet();
    await $`git -C ${testRepoPath} config user.name "Test"`.quiet();
    await $`echo "test" > ${testRepoPath}/README.md`.quiet();
    await $`git -C ${testRepoPath} add README.md`.quiet();
    await $`git -C ${testRepoPath} commit -m "initial"`.quiet();

    const ownedWorkspaces: string[] = [];
    const checkouts = `${testRepoPath}-checkouts`;

    try {
      // Step 1: Create parent workspace (source) from main repo - KEEP IT OPEN
      const wsResp = await post("/api/workspace/create", { cwd: testRepoPath, label: "fallback-parent" });
      expect(wsResp.status).toBe(200);
      const { workspace_id: ws1 } = await wsResp.json();
      ownedWorkspaces.push(ws1);

      // Step 2: Create a linked checkout via git worktree add (not via herdr)
      await $`git -C ${testRepoPath} worktree add -q -b linked-branch ${join(checkouts, "linked-checkout")}`.quiet();

      // Step 3: Open the linked checkout as a workspace (ws2)
      // herdr does not mark this as a linked worktree since it wasn't created via herdr
      const linkedWsResp = await post("/api/workspace/create", { cwd: join(checkouts, "linked-checkout"), label: "fallback-linked" });
      expect(linkedWsResp.status).toBe(200);
      const { workspace_id: ws2 } = await linkedWsResp.json();
      ownedWorkspaces.push(ws2);

      // Verify ws2 is NOT marked as a linked worktree
      let snapshot = await sessionSnapshot();
      let ws2Info = snapshot.workspaces.find((w) => w.workspace_id === ws2);
      expect(ws2Info?.worktree?.is_linked_worktree).not.toBeTrue();

      // Step 4: Try to create a worktree from ws2 (the linked checkout workspace)
      // This should fail with linked_worktree_source, then fallback to find ws1 via worktreeList
      // and retry from ws1 (which is open). The fallback at workspace-routes.ts:211-216 handles this.
      const openResp = await post("/api/worktree/create", {
        workspace_id: ws2,
        branch: "new-branch-from-linked",
        path: join(checkouts, "new-branch"),
      });

      // Should succeed via fallback (finds ws1 as source_workspace_id, retries from ws1)
      expect(openResp.status).toBe(200);
      const body = await openResp.json();
      expect(body.workspace_id).toBeDefined();
      expect(body.branch).toBe("new-branch-from-linked");
      expect(body.path).toBe(join(checkouts, "new-branch"));

      // Verify the new worktree was created and is a linked worktree
      const newWsId = body.workspace_id;
      ownedWorkspaces.push(newWsId);
      snapshot = await sessionSnapshot();
      const newWsInfo = snapshot.workspaces.find((w) => w.workspace_id === newWsId);
      expect(newWsInfo?.worktree?.is_linked_worktree).toBeTrue();

    } finally {
      // Cleanup: close any remaining workspaces
      for (const id of ownedWorkspaces) {
        await workspaceClose(id).catch(() => undefined);
      }
      // Best-effort cleanup; ignore errors if still in use by herdr
      try { rmSync(checkouts, { recursive: true, force: true }); } catch {}
      try { rmSync(testRepoPath, { recursive: true, force: true }); } catch {}
    }
  }, 30_000);
});