import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator } from "playwright-core";
import panes from "../site/demo/fixtures/panes.json";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

// The quiet composer at rest shows only the mark and the context ring. A phone's first tap must not
// open the model label and widen the status column between touch and click: the target would move
// out from under the finger. This runs the real client over the demo's fixture transport, cold (no
// focus in the composer), and records each target's box at every input event and animation frame
// until its menu opens. The plan chip and Attach are pressed cold; the model pill is not a button
// on a phone, so it is checked for a stable box and a label that stays clipped.
interface TapCapture {
  initial: { x: number; width: number };
  samples: { at: string; x: number; width: number }[];
}

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
        const chip = page.locator(".composer .bg-tasks-toggle");
        const attach = page.locator(".composer .composer-attach");
        const pill = page.locator(".composer .composer-pill");
        const ready = async (): Promise<void> => {
          await page.locator(".conn-live").waitFor({ state: "attached" });
          await chip.waitFor({ state: "visible", timeout: 10_000 });
        };
        const reload = async (): Promise<void> => {
          await page.reload();
          await ready();
        };
        const cold = async (target: Locator, name: string): Promise<void> => {
          const state = await target.evaluate((node) => {
            const surface = node.closest(".composer-surface");
            return {
              quiet: surface?.hasAttribute("data-quiet") ?? false,
              open: surface?.hasAttribute("data-quiet-open") ?? false,
              textFocused: document.activeElement?.classList.contains("composer-text") ?? false,
            };
          });
          assert.equal(state.quiet, true, `${name}: the phone composer starts quiet`);
          assert.equal(state.open, false, `${name}: the label has not been opened by a focus yet`);
          assert.equal(state.textFocused, false, `${name}: the tap is cold: nothing in the composer holds focus`);
        };
        const watch = async (selector: string, stopOn: string | null): Promise<void> => {
          await page.evaluate(({ selector, stopOn }) => {
            const node = document.querySelector<HTMLElement>(selector);
            if (!node) throw new Error(`no ${selector} to watch`);
            const samples: { at: string; x: number; width: number }[] = [];
            let watching = true;
            let observer: MutationObserver | null = null;
            const record = (at: string): void => {
              if (!watching) return;
              const box = node.getBoundingClientRect();
              samples.push({ at, x: box.x, width: box.width });
            };
            for (const type of ["pointerdown", "touchstart", "mousedown", "focusin", "mouseup", "pointerup", "click"]) {
              document.addEventListener(type, () => record(type), true);
            }
            const tick = (): void => { if (!watching) return; record("frame"); requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            // The menu is inserted by the state the click sets; the samples stop at that insertion
            // so nothing the menu itself paints can hide a move that happened on the way there.
            if (stopOn !== null) {
              observer = new MutationObserver(() => {
                if (document.querySelector(stopOn) === null) return;
                record("done");
                watching = false;
                observer?.disconnect();
              });
              observer.observe(document.body, { childList: true, subtree: true });
            }
            (window as any).__tapWatch = {
              initial: { x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width },
              samples,
              stop: () => {
                if (!watching) return;
                record("stop");
                watching = false;
                observer?.disconnect();
              },
            };
          }, { selector, stopOn });
        };
        const stopWatch = async (): Promise<void> => {
          await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            (window as any).__tapWatch.stop();
            resolve();
          }))));
        };
        const capture = async (): Promise<TapCapture> => page.evaluate(() => (window as any).__tapWatch as TapCapture);
        const stable = (name: string, tap: TapCapture, width = false): void => {
          const seen = tap.samples.map((sample) => sample.at);
          for (const phase of ["pointerdown", "touchstart", "mousedown"])
            assert.ok(seen.includes(phase), `${name}: the gesture was sampled at ${phase}: ${JSON.stringify(seen)}`);
          const moved = tap.samples.filter((sample) => Math.abs(sample.x - tap.initial.x) > 1);
          assert.deepEqual(moved, [], `${name} never moved before its action (cold x ${tap.initial.x}, moved ${moved.length} times: ${JSON.stringify(moved.slice(0, 6))})`);
          if (width) {
            const resized = tap.samples.filter((sample) => Math.abs(sample.width - tap.initial.width) > 1);
            assert.deepEqual(resized, [], `${name} never widened under the finger (cold width ${tap.initial.width}, resized ${resized.length} times: ${JSON.stringify(resized.slice(0, 6))})`);
          }
        };

        await page.goto(`${url}?ws=${wsOf(API)}&pane=${encodeURIComponent(API)}&view=chat`);
        await ready();
        // A phone hides the word Plan in the compact chip; the done/total count still names it.
        assert.match(await chip.locator(".bg-tasks-plan").innerText(), /^\d+\/\d+$/, "the chip under test is the plan chip");
        await cold(chip, "the plan chip");
        await watch(".composer .bg-tasks-toggle", ".bg-tasks-menu");
        // No focus() first, no pointer down elsewhere: the chip is tapped from the cold page.
        await chip.tap();
        let planOpened = true;
        try { await page.locator(".bg-tasks-menu").waitFor({ state: "visible", timeout: 5_000 }); }
        catch { planOpened = false; await stopWatch(); }
        stable("the plan chip", await capture());
        assert.equal(planOpened, true, "the tap opened the plan");
        assert.equal(await chip.getAttribute("aria-expanded"), "true", "the tap opened the plan");

        await reload();
        await attach.waitFor({ state: "visible", timeout: 10_000 });
        await cold(attach, "Attach");
        await watch(".composer .composer-attach", null);
        const chooser = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
        await attach.tap();
        const picked = await chooser;
        if (picked) await picked.setFiles([]);
        await stopWatch();
        stable("Attach", await capture());
        assert.ok(picked, "the cold tap opened the file chooser");

        await reload();
        await pill.waitFor({ state: "visible", timeout: 10_000 });
        assert.ok((await pill.locator(".composer-model").textContent())?.trim(), "the pill under test names a model");
        await cold(pill, "the model pill");
        await watch(".composer .composer-pill", null);
        await pill.tap();
        await stopWatch();
        stable("the model pill", await capture(), true);
        assert.equal(await page.evaluate(() => document.querySelector(".composer-surface")?.hasAttribute("data-quiet-open")), false, "a cold tap on the model pill does not open the quiet label");

        assert.deepEqual(errors, []);
        console.log("PASS a phone's cold tap on the plan chip, Attach and the model pill keeps each target still; the first two open their actions");
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
