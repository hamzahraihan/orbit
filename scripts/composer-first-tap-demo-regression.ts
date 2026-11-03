import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import panes from "../site/demo/fixtures/panes.json";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

// The quiet composer at rest shows only the mark and the context ring. A phone's first tap on the
// plan chip must not open the model label and widen the status column between touch and click: the
// chip would move out from under the finger and the click would land on Attach files. This runs the
// real client over the demo's fixture transport, cold (no focus in the composer), and records the
// chip's x at every input event and animation frame until its menu is inserted.
const app = mkdtempSync(join(tmpdir(), "herdr-composer-first-tap-"));
const API = panes.api;
const wsOf = (pane: string) => pane.split(":")[0]!;

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
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
      try {
        await context.addInitScript(() => {
          localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
          // the welcome card would sit over the composer, and this is not the screen under test
          localStorage.setItem("herdr-web-ui:onboarded", "1");
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${url}?ws=${wsOf(API)}&pane=${encodeURIComponent(API)}&view=chat`);
        await page.locator(".conn-live").waitFor({ state: "attached" });
        const chip = page.locator(".composer .bg-tasks-toggle");
        await chip.waitFor({ state: "visible", timeout: 10_000 });
        // A phone hides the word Plan in the compact chip; the done/total count still names it.
        assert.match(await chip.locator(".bg-tasks-plan").innerText(), /^\d+\/\d+$/, "the chip under test is the plan chip");

        const cold = await chip.evaluate((node) => {
          const surface = node.closest(".composer-surface");
          if (!surface) throw new Error("the chip is not in the composer surface");
          return {
            quiet: surface.hasAttribute("data-quiet"),
            open: surface.hasAttribute("data-quiet-open"),
            textFocused: document.activeElement?.classList.contains("composer-text") ?? false,
            x: node.getBoundingClientRect().x,
            menu: document.querySelector(".bg-tasks-menu") !== null,
          };
        });
        assert.equal(cold.quiet, true, "the phone composer starts quiet");
        assert.equal(cold.open, false, "the label has not been opened by a focus yet");
        assert.equal(cold.textFocused, false, "the tap is cold: nothing in the composer holds focus");
        assert.equal(cold.menu, false, "the plan is closed before the tap");

        await page.evaluate(() => {
          const chip = document.querySelector<HTMLElement>(".composer .bg-tasks-toggle");
          if (!chip) throw new Error("no plan chip to watch");
          const samples: { at: string; x: number }[] = [];
          let watching = true;
          const record = (at: string) => samples.push({ at, x: chip.getBoundingClientRect().x });
          for (const type of ["pointerdown", "touchstart", "mousedown", "focusin", "mouseup", "pointerup", "click"]) {
            document.addEventListener(type, () => { if (watching) record(type); }, true);
          }
          const tick = () => { if (!watching) return; record("frame"); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          // The menu is inserted by the state the click sets; the samples stop at that insertion so
          // nothing the menu itself paints can hide a move that happened on the way there.
          const observer = new MutationObserver(() => {
            if (!document.querySelector(".bg-tasks-menu")) return;
            record("menu");
            watching = false;
            observer.disconnect();
          });
          observer.observe(document.body, { childList: true, subtree: true });
          (window as any).__firstTap = { initial: chip.getBoundingClientRect().x, samples };
        });

        // No focus() first, no pointer down elsewhere: the chip is tapped from the cold page.
        await chip.tap();
        let opened = true;
        try { await page.locator(".bg-tasks-menu").waitFor({ state: "visible", timeout: 5_000 }); }
        catch { opened = false; }

        const captured = await page.evaluate(() => (window as any).__firstTap as { initial: number; samples: { at: string; x: number }[] });
        const seen = captured.samples.map((sample) => sample.at);
        for (const phase of ["pointerdown", "touchstart", "mousedown"])
          assert.ok(seen.includes(phase), `the gesture was sampled at ${phase}: ${JSON.stringify(seen)}`);
        const moved = captured.samples.filter((sample) => Math.abs(sample.x - captured.initial) > 1);
        assert.deepEqual(moved, [], `the plan chip never moved before its menu opened (cold x ${captured.initial}, moved ${moved.length} times: ${JSON.stringify(moved.slice(0, 6))})`);
        assert.equal(opened, true, "the tap opened the plan");
        assert.equal(await chip.getAttribute("aria-expanded"), "true", "the tap opened the plan");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
      console.log("PASS a phone's first tap on the quiet plan chip keeps it still through the gesture and opens the plan");
    } finally {
      await browser.close();
    }
  } finally {
    server.stop(true);
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}
