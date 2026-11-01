import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

// The demo's sidebar in a short window: both the workspace list and the agent list overflow, so a
// scroll moves a row out from under its card. Pointing at or focusing a row opens the card level
// with it (DESIGN.md); this checks that the card follows that row through its own list's scroll,
// leaves only while the row is out of the list, and stays put when the chat scrolls. Only the
// disposable demo fixtures are used; no live herdr session is read.
const app = mkdtempSync(join(tmpdir(), "herdr-sidebar-hover-card-"));
const evidence = process.env["UI_EVIDENCE_DIR"];
const WORKSPACE = "w1C";
const AGENT = "w1H";
const workspaceRowSelector = `.machine-list li[data-workspace="${WORKSPACE}"] > .sidebar-row`;
const agentItemSelector = `.agent-item[data-pane="${AGENT}:p1"]`;

/** The card's and the row's tops in viewport pixels, and how many cards are open. */
const tops = (page: Page, rowSelector: string) => page.evaluate((selector) => {
  const row = document.querySelector(selector)?.getBoundingClientRect();
  const card = document.querySelector(".rail-flyout")?.getBoundingClientRect();
  return { row: row?.top ?? null, card: card?.top ?? null, cards: document.querySelectorAll(".rail-flyout").length };
}, rowSelector);

/** Waits until the open card stands level with its row. */
const follows = (page: Page, rowSelector: string) => page.waitForFunction((selector) => {
  const row = document.querySelector(selector)?.getBoundingClientRect();
  const card = document.querySelector(".rail-flyout")?.getBoundingClientRect();
  return row !== undefined && card !== undefined && Math.abs(row.top - card.top) <= 1;
}, rowSelector);

const hidden = (page: Page) => page.waitForFunction(() => document.querySelector(".rail-flyout") === null);

const scrollTo = (page: Page, selector: string, top: number) => page.locator(selector).evaluate((element, value) => { element.scrollTop = value; }, top);

try {
  await buildDemoApp(app);
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, '<script src="./demo-transport.js"></script><script type="module"'));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    let file: string;
    try { file = decodeURIComponent(path.slice(1)); } catch { return new Response("bad path", { status: 400 }); }
    if (!file || file.endsWith("/")) file += "index.html";
    if (file.split("/").includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    const body = Bun.file(join(app, file));
    return await body.exists() ? new Response(body) : new Response("not found", { status: 404 });
  } });
  try {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 520 }, locale: "en-US", colorScheme: "dark" });
      try {
        await context.addInitScript(() => {
          localStorage.setItem("herdr-web-ui:onboarded", "1");
          localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", theme: "dark" }));
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.port}/?pane=${encodeURIComponent("w1C:p1")}`);
        const workspace = page.locator(workspaceRowSelector);
        await workspace.waitFor();

        // the short window leaves both lists, and the chat, room to scroll
        const scrollable = await page.evaluate(() => {
          const box = (selector: string) => document.querySelector<HTMLElement>(selector)!;
          const overflows = (selector: string) => box(selector).scrollHeight > box(selector).clientHeight;
          return { machine: overflows(".machine-list"), agents: overflows(".agent-list-contents"), chat: overflows(".chat-view-virtual") };
        });
        assert.deepEqual(scrollable, { machine: true, agents: true, chat: true }, "the demo window lets each list scroll");

        // a focused workspace row opens its card level with it
        await workspace.evaluate((element) => (element as HTMLElement).focus());
        await follows(page, workspaceRowSelector);
        const opened = await tops(page, workspaceRowSelector);
        assert.equal(opened.cards, 1, "a focused workspace row opens one card");
        assert.ok(Math.abs(opened.card! - opened.row!) <= 1, "the card opens level with its row");

        // its list scrolls: the row moves up and the card goes with it
        await scrollTo(page, ".machine-list", 40);
        await follows(page, workspaceRowSelector);
        const scrolled = await tops(page, workspaceRowSelector);
        assert.ok(scrolled.row! < opened.row! - 20, "the workspace list moved the row");
        assert.ok(Math.abs(scrolled.card! - scrolled.row!) <= 1, "the workspace's card follows the row through the list scroll");
        if (evidence) {
          mkdirSync(evidence, { recursive: true });
          await page.screenshot({ path: join(evidence, "sidebar-hover-card-list-scroll.png") });
        }

        // the row leaves its list: the card leaves too, and comes back with the row
        await scrollTo(page, ".machine-list", 1e6);
        await hidden(page);
        assert.equal((await tops(page, workspaceRowSelector)).cards, 0, "a row scrolled out of the list takes its card away");
        await scrollTo(page, ".machine-list", 0);
        await follows(page, workspaceRowSelector);
        assert.equal((await tops(page, workspaceRowSelector)).cards, 1, "the card returns when its row comes back");

        // a streaming chat scrolls its own pane: the row does not move, so its card stays put
        const beforeChat = await tops(page, workspaceRowSelector);
        await scrollTo(page, ".chat-view-virtual", 80);
        await page.waitForFunction(() => (document.querySelector(".chat-view-virtual") as HTMLElement).scrollTop > 0);
        const afterChat = await tops(page, workspaceRowSelector);
        assert.equal(afterChat.cards, 1, "the chat's scroll does not close the card");
        assert.equal(afterChat.row, beforeChat.row, "the chat's scroll does not move the row");
        assert.equal(afterChat.card, beforeChat.card, "the chat's scroll does not move the card");

        // an agent's card follows its row the same way. The row's button is `display: contents`, so
        // it is opened by pointing at it (as the demo's own hover does), not by focus.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await hidden(page);
        const agent = page.locator(`${agentItemSelector} .agent-select`);
        await agent.waitFor();
        await agent.evaluate((element) => element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body, pointerType: "mouse" })));
        await follows(page, agentItemSelector);
        const agentOpened = await tops(page, agentItemSelector);
        assert.equal(agentOpened.cards, 1, "pointing at an agent row opens one card");
        assert.ok(Math.abs(agentOpened.card! - agentOpened.row!) <= 1, "the agent's card opens level with its row");

        await scrollTo(page, ".agent-list-contents", 40);
        await follows(page, agentItemSelector);
        const agentScrolled = await tops(page, agentItemSelector);
        assert.ok(agentScrolled.row! < agentOpened.row! - 20, "the agent list moved the row");
        assert.ok(Math.abs(agentScrolled.card! - agentScrolled.row!) <= 1, "the agent's card follows the row through the list scroll");

        assert.deepEqual(errors, []);
        console.log("PASS desktop: workspace and agent cards open level with their row, follow it through a list scroll, leave while it is out of the list, and stay put when the chat scrolls");
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { server.stop(true); }
} finally {
  rmSync(app, { recursive: true, force: true });
}
