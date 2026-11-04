import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import panes from "../site/demo/fixtures/panes.json";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

// A remembered conversation search can be taken out of the palette without leaving it: the row's
// button drops one, the heading's Clear drops the rest. Both write the same list the next opening
// reads, so this seeds four searches, removes one, clears the rest, and checks the stored list
// after closing, reopening, and reloading. The real client runs over the demo's fixture transport.
const app = mkdtempSync(join(tmpdir(), "herdr-recent-searches-prune-"));
const API = panes.api;
const wsOf = (pane: string) => pane.split(":")[0]!;
const KEY = "herdr-web-ui:recent-searches";
const seeded = ["export guard", "payments", "retry flag", "theme tokens"];

let url = "";
try {
  await buildDemoApp(app);
  const index = join(app, "index.html");
  const html = readFileSync(index, "utf8");
  assert.match(html, /<script type="module"/);
  writeFileSync(index, html.replace(/<script type="module"/, '<script src="./demo-transport.js"></script>\n    <script type="module"'));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/herdr-web-ui/demo/app/")) return new Response("not found", { status: 404 });
    let file: string;
    try { file = decodeURIComponent(path.slice("/herdr-web-ui/demo/app/".length)); }
    catch { return new Response("bad path", { status: 400 }); }
    if (!file || file.endsWith("/")) file += "index.html";
    if (file.split("/").includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    const body = Bun.file(join(app, file));
    return (await body.exists()) ? new Response(body) : new Response("not found", { status: 404 });
  } });
  url = `http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/`;

  try {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
      try {
        await context.addInitScript(({ key, searches }) => {
          localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
          // the welcome card would sit over the palette, and this is not the screen under test
          localStorage.setItem("herdr-web-ui:onboarded", "1");
          // init scripts run on every navigation: seed the first load only, so a reload reads
          // whatever the palette wrote, including the cleared list
          if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(searches));
        }, { key: KEY, searches: seeded });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${url}?ws=${wsOf(API)}&pane=${encodeURIComponent(API)}&view=chat`);
        await page.locator(".conn-live").waitFor({ state: "attached" });

        const dialog = page.getByRole("dialog", { name: "Search conversations", exact: true });
        const search = dialog.getByRole("searchbox", { name: "Search conversations", exact: true });
        const rows = dialog.locator(".palette-recent-row");
        const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown, KEY);
        const open = async () => {
          await page.keyboard.press("ControlOrMeta+Shift+M");
          await dialog.waitFor({ state: "visible" });
        };
        const close = async () => {
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
        };

        await open();
        assert.equal(await rows.count(), seeded.length, "every remembered search is offered");
        assert.equal(await dialog.locator('.palette-section[data-section="recent-searches"] .palette-section-count').textContent(), String(seeded.length));
        assert.deepEqual(await stored(), seeded, "opening the palette leaves the stored list alone");

        // One row's × removes just that search, in place of the button that goes with the row.
        await dialog.getByRole("button", { name: "Remove payments from recent searches", exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll(".palette-recent-row").length === 3);
        assert.deepEqual(await stored(), ["export guard", "retry flag", "theme tokens"], "the removal is written in the stored order");
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("type")), "search", "removing a row puts the keyboard back in the search box");

        // The next opening reads the stored list, so the removed search stays gone.
        await close();
        await open();
        assert.equal(await rows.count(), 3);
        assert.deepEqual(await rows.locator(".palette-row-title").allTextContents(), ["export guard", "retry flag", "theme tokens"]);

        await dialog.getByRole("button", { name: "Clear recent searches", exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll(".palette-recent-row").length === 0);
        assert.deepEqual(await stored(), [], "Clear writes an empty list");
        assert.equal(await dialog.locator('.palette-section[data-section="recent-searches"]').count(), 0, "the empty section and its Clear are gone");
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("type")), "search", "clearing puts the keyboard back in the search box");

        // A reload cannot bring the cleared list back: nothing but this browser's storage holds it.
        await close();
        await page.reload();
        await page.locator(".conn-live").waitFor({ state: "attached" });
        await open();
        assert.equal(await rows.count(), 0, "a reload offers no cleared search");
        assert.deepEqual(await stored(), []);
        assert.deepEqual(errors, []);
        console.log("PASS removing one recent conversation search and clearing the rest leaves the stored list as expected");
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.stop(true);
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}
