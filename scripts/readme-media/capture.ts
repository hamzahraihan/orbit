/**
 * Regenerates the README media in docs/screenshots from a staged demo session (stage.ts):
 * phone stills (transparent PNGs) and a phone walkthrough, recorded at 2x (record.ts) and composed
 * with a camera, a cursor and taps (compose.ts) into MP4 and GIF. Needs ffmpeg.
 *
 *   bun run build && bun scripts/readme-media/capture.ts [shots] [video]
 */
import { stage } from "./stage.ts";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Recorder } from "./record.ts";
import { closeCompositor, composeStill, composeVideo } from "./compose.ts";
import { chromePath } from "../chrome-path.ts";
const { herdrRpc } = await import("../../server/herdr/client.ts");

const OUT = join(import.meta.dir, "../../docs/screenshots");
const what = process.argv.slice(2);
const want = (part: string) => what.length === 0 || what.includes(part);
mkdirSync(OUT, { recursive: true });
const demo = await stage();
// headless screencasts come at 1x unless the whole browser renders at 2x
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--force-device-scale-factor=2"] });
const views = Object.fromEntries(demo.panes.map((x) => ["herdr-web-ui:view:" + x.pane, x.agent ? "chat" : "terminal"]));
const PHONE = { width: 390, height: 844 };

async function open(key: string): Promise<{ context: BrowserContext; page: Page }> {
  await demo.reset();
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, colorScheme: "dark", isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await demo.routes(page);
  await page.addInitScript((items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v as string); }, views);
  await page.goto(`${demo.base}/?pane=${encodeURIComponent(demo.pane(key).pane)}`);
  await Bun.sleep(4000);
  return { context, page };
}

async function shots() {
  await herdrRpc("pane.send_text", { pane_id: demo.pane("shell").pane, text: `git log --oneline --graph --decorate --color=always | cat && bun test\n` });
  const shot = async (name: string, key: string, then?: (page: Page) => Promise<void>) => {
    const { context, page } = await open(key);
    await then?.(page);
    await composeStill(await page.screenshot(), "phone", { w: PHONE.width, h: PHONE.height }, join(OUT, `${name}.png`));
    await context.close();
  };
  await shot("mobile-chat", "api");
  await shot("mobile-terminal", "shell");
  await shot("mobile-sessions", "api", async (page) => { await page.locator(".drawer-toggle").tap(); await Bun.sleep(800); });
}

const row = (key: string) => `.pane-select[title^="${demo.pane(key).pane} "]`;

async function phoneVideo() {
  const { context, page } = await open("api");
  const hand = new Recorder(page, PHONE.width, PHONE.height);
  await hand.begin();
  await Bun.sleep(1200);
  await hand.drag(200, 380, 700); await Bun.sleep(1200);                 // read back
  await hand.tap(".drawer-toggle"); await Bun.sleep(1300);               // every agent
  await hand.tap(row("web")); await Bun.sleep(2000);                     // Codex asks
  await hand.tap(".prompt-card-options button"); await Bun.sleep(1600);
  await hand.tap(".drawer-toggle"); await Bun.sleep(1000);
  await hand.tap(row("shell")); await Bun.sleep(1400);                   // the terminal, with a key bar
  await herdrRpc("pane.send_text", { pane_id: demo.pane("shell").pane, text: `git log --oneline --graph --decorate --color=always | cat\n` }); await Bun.sleep(1800);
  await hand.tap(".drawer-toggle"); await Bun.sleep(900);
  await hand.tap(row("api")); await Bun.sleep(1400);
  await hand.tap(".composer-text"); await page.keyboard.type("Ship it, then tag v1.4.1", { delay: 60 }); await Bun.sleep(1600);
  const recording = await hand.end();
  await context.close();
  await composeVideo(recording, "phone", { mp4: join(OUT, "demo-mobile.mp4"), gif: join(OUT, "demo-mobile.gif"), gifWidth: 320 });
}

try {
  if (want("shots")) await shots();
  if (want("video")) await phoneVideo();
} finally {
  await browser.close();
  await closeCompositor();
  await demo.teardown();
}
process.exit(0);
