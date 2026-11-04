/** Phone UI worktree dialog with agent picker - browser regression test. Run after `bun run build`. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "../server/index.ts";
import { herdrRpc, sessionSnapshot, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { chromePath } from "./chrome-path.ts";

// The test needs a real git repo for the worktree to be created from
const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-web-ui-phone-worktree-agent-")));
const repo = join(root, `herdr-web-ui-test-phone-worktree-agent-${process.pid.toString(36)}`);
mkdirSync(repo);
const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=herdr-web-ui test", "-c", "user.email=test@example.invalid", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
assert.equal(git("init", "-q", "-b", "main").exitCode, 0, "git init");
writeFileSync(join(repo, "README.md"), "worktree agent fixture\n");
assert.equal(git("add", "README.md").exitCode, 0);
assert.equal(git("commit", "-q", "-m", "fixture").exitCode, 0, "git commit");

const owned: string[] = [];
const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state") });

try {
  // Create a parent workspace in the test repo
  const parent = await workspaceCreate({ cwd: repo, label: "herdr-web-ui-test-phone-worktree-agent" });
  owned.push(parent.workspace.workspace_id);

  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  try {
    // Phone viewport
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
    await context.addInitScript(() => {
      localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
      localStorage.setItem("herdr-web-ui:onboarded", "1");
    });
    const page = await context.newPage();

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    // Wait for the worktree create API call
    const created = page.waitForResponse((response) => response.url().endsWith("/api/worktree/create"));

    // Navigate to the workspace in phone view (mobile viewport triggers phone layout)
    await page.goto(`http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(parent.root_pane.pane_id)}`);
    await page.locator(".conn-live").waitFor();

    // Wait for onboarding overlay to disappear (if present)
    await page.locator(".onboarding-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

    // Open workspace drawer (mobile sidebar)
    const drawerButton = page.locator('button[aria-controls="workspace-drawer"]');
    await drawerButton.click();

    // Wait for drawer to open and workspace list to populate
    await page.waitForFunction(() => {
      const drawer = document.querySelector('#workspace-drawer.is-open');
      if (!drawer) return false;
      const rows = drawer.querySelectorAll('[data-workspace]');
      return rows.length > 0;
    }, { timeout: 10000 });

    // Wait for workspace row to be visible
    await page.locator(`[data-workspace="${parent.workspace.workspace_id}"]`).waitFor();

    // Open row menu for the workspace
    await page.locator(`[data-workspace="${parent.workspace.workspace_id}"] .row-menu-toggle`).first().click();

    // Wait for row sheet to appear
    await page.locator(".row-sheet").waitFor();

    // Click "New worktree"
    await page.locator(".row-sheet").getByRole("button", { name: "New worktree", exact: true }).click();

    // Wait for the worktree dialog to appear
    const dialog = page.getByRole("dialog", { name: /^New worktree/ });
    await dialog.waitFor();

    // Verify the agent picker is visible
    const agentPicker = dialog.getByRole("combobox", { name: "Agent" });
    await agentPicker.waitFor();

    // Open the agent picker and verify options
    await agentPicker.click();
    const list = page.locator(".agent-picker-menu");
    await list.waitFor();

    // Verify at least "Shell" is in the list (and possibly other agents)
    const options = list.getByRole("option");
    const optionCount = await options.count();
    assert.ok(optionCount > 0, "agent picker has at least one option");

    // Select an agent (e.g., "claude" if available, otherwise "Shell")
    const agentOptions = await options.allTextContents();

    // Pick "Shell" to avoid requiring an actual agent binary
    await page.getByRole("option", { name: "Shell", exact: true }).click();

    // Fill in branch name
    const branchInput = dialog.locator('input[required]'); // The branch input is required
    await branchInput.fill("worktree/implement-api-test");

    // Click Create worktree button
    await dialog.getByRole("button", { name: "Create worktree", exact: true }).click();

    // Wait for the create API response
    const opened = await (await created).json() as { workspace_id: string; pane_id: string; agent_started?: boolean };

    // Wait for dialog to close
    await dialog.waitFor({ state: "detached" });

    // Verify navigation to the new worktree (pane URL parameter updates)
    await page.waitForFunction((pane) => new URLSearchParams(location.search).get("pane") === pane, opened.pane_id, { timeout: 10_000 });
    assert.equal(await page.locator(".pane-frame.is-current").getAttribute("data-layout-pane"), opened.pane_id, "the checkout's pane is the one shown");

    // Verify the launch landed in the new worktree. "Shell" is the no-agent choice.
    // Selecting a pane in the browser does not move herdr's own focus (AGENTS.md),
    // so herdr may keep focus on the parent workspace; the UI's focused pane and a
    // live terminal are what prove the launch landed.
    const fresh = await sessionSnapshot();
    const newPane = fresh.panes.find((pane) => pane.pane_id === opened.pane_id);
    assert.ok(newPane, "herdr lists the new worktree pane");
    await page.locator(".pane-frame.is-current .xterm").first().waitFor({ timeout: 15_000 });

    // Verify no JS errors
    assert.deepEqual(errors, []);

    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  // Cleanup: remove any worktree checkouts created during test
  const leftovers: unknown[] = [];
  const snapshot = await sessionSnapshot().catch((error: unknown) => { leftovers.push(error); return null; });
  for (const workspace of snapshot?.workspaces ?? []) {
    if (!workspace.worktree?.is_linked_worktree || workspace.worktree.repo_root !== repo) continue;
    try {
      await herdrRpc("worktree.remove", { workspace_id: workspace.workspace_id, force: true });
    } catch (error) {
      leftovers.push(error);
      continue;
    }
    await workspaceClose(workspace.workspace_id).catch(() => undefined);
  }
  try { rmSync(join(homedir(), ".herdr", "worktrees", basename(repo)), { recursive: true, force: true }); } catch { /* not there, or not empty: not ours */ }
  for (const id of owned.reverse()) await workspaceClose(id).catch(() => {});
  server.stop();
  rmSync(root, { recursive: true, force: true });
  if (leftovers.length > 0) {
    console.error("FAIL the run's worktree checkout may remain under ~/.herdr/worktrees:", ...leftovers);
    process.exitCode = 1;
  }
}
