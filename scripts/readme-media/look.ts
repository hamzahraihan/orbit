/**
 * Regenerates the stills the README and the user guide embed (`docs/media/look-*.png`,
 * `docs/screenshots/mobile-*.png`) from the website demo build (`bun run build:site`): the
 * real app on the fictional session the fixtures carry. Each capture is framed in a browser
 * window or a phone on a transparent backdrop by `composeStill`.
 *
 *   bun run build:site && bun scripts/readme-media/look.ts
 *
 * Needs node_modules and a Chromium the playwright install knows about. Binds a loopback
 * port only while the captures are taken.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "../chrome-path.ts";
import { closeCompositor, composeStill } from "./compose.ts";

const ROOT = join(import.meta.dir, "../..");
const SITE = join(ROOT, "_site");
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".woff2": "font/woff2", ".map": "application/json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  let file = join(SITE, normalize(path));
  if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});
const { promise: listening, resolve: listeningNow } = Promise.withResolvers<void>();
server.listen(0, "127.0.0.1", listeningNow);
await listening;
const address = server.address();
if (!address || typeof address === "string") throw new Error("the demo server did not bind to a port");
const port = address.port;

/** The panes the demo opens for these shots: see site/demo/fixtures/panes.json. */
const PANES = { api: "w1C:p1", web: "w1D:p1", shell: "w1G:p1" } as const;
type Key = keyof typeof PANES;
type Frame = { png: Buffer; viewport: { w: number; h: number }; kind: "window" | "phone"; out: string };
type Spec = { pane: Key; view: "chat" | "terminal"; desktop: string; mobile: string | null };

const SPECS: Spec[] = [
  { pane: "api", view: "chat", desktop: "docs/media/look-chat.png", mobile: "docs/screenshots/mobile-chat.png" },
  { pane: "web", view: "chat", desktop: "docs/media/look-prompt.png", mobile: null },
  { pane: "shell", view: "terminal", desktop: "docs/media/look-terminal.png", mobile: "docs/screenshots/mobile-terminal.png" },
];

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--force-device-scale-factor=2"] });
const frames: Frame[] = [];

async function capture(spec: Spec, phone: boolean, drawer: boolean): Promise<Frame> {
  const pane = PANES[spec.pane];
  const mobile = phone;
  const viewport = mobile ? MOBILE : DESKTOP;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: "dark", ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  await context.addInitScript((paneId: string) => {
    const view = new URL(window.location.href).searchParams.get("view");
    if (view) localStorage.setItem(`herdr-web-ui:view:${paneId}`, view);
    localStorage.setItem("herdr-web-ui:onboarded", "1");
  }, pane);
  await page.goto(`http://127.0.0.1:${port}/demo/app/?pane=${encodeURIComponent(pane)}&view=${spec.view}`, { waitUntil: "load" });
  await Bun.sleep(4500);
  if (drawer) {
    await page.locator(".drawer-toggle").first().tap().catch(() => {});
    await Bun.sleep(1200);
  }
  const png = Buffer.from(await page.screenshot());
  await context.close();
  return { png, viewport: { w: viewport.width, h: viewport.height }, kind: mobile ? "phone" : "window", out: mobile ? (spec.mobile ?? "") : spec.desktop };
}

for (const spec of SPECS) {
  frames.push(await capture(spec, false, false));
  if (spec.mobile) frames.push(await capture(spec, true, false));
}
// the session drawer open on a phone: the agents list every workspace holds
frames.push(await capture({ pane: "api", view: "chat", desktop: "", mobile: "docs/screenshots/mobile-sessions.png" }, true, true));

await browser.close();
server.close();
for (const frame of frames) {
  if (!frame.out) continue;
  await composeStill(frame.png, frame.kind, frame.viewport, join(ROOT, frame.out));
  console.log(frame.out);
}
await closeCompositor();
process.exit(0);