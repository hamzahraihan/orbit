/** Export the Orbit mark without redrawing it. Requires ffmpeg with drawtext. */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "docs/brand/icon-source.png");
mkdirSync(join(root, "public/icons"), { recursive: true });

/** drawtext needs a font file where fontconfig is absent (Windows): DejaVu on Linux, Arial on Windows. */
const socialFont = [
  process.env["BRAND_FONT"],
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
].find((path): path is string => path !== undefined && existsSync(path));
if (!socialFont) throw new Error("Set BRAND_FONT to a TrueType font for the social preview.");
const font = `fontfile='${socialFont.replaceAll(":", "\\:").replaceAll("'", "\\'")}'`;

/** Alpha is everything that is not the light square: the ink ring and the amber satellite. */
const MARK_ALPHA = "a='clip(max(215-r(X,Y),max(abs(216-g(X,Y)),abs(216-b(X,Y))))*2.5,0,255)'";

function exportImage(path: string, filter: string, extra: string[] = []): void {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-vf", filter, "-frames:v", "1", "-threads", "1", ...extra, join(root, path),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not export ${path}`);
  console.log(path);
}

for (const size of [192, 512]) {
  exportImage(`public/icons/icon-${size}.png`, `scale=${size}:${size}:flags=lanczos`);
  const inset = Math.round(size * 0.76);
  exportImage(`public/icons/icon-maskable-${size}.png`,
    `scale=${inset}:${inset}:flags=lanczos,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0xd7d8d8`);
}
// Android draws a notification's small icon from its alpha alone: the dark artwork becomes
// white on transparent, cropped to the mark. Without it Chrome shows its own bell.
exportImage("public/icons/badge-96.png",
  `crop=1040:1040:120:120,scale=96:96:flags=lanczos,format=rgba,geq=r=255:g=255:b=255:${MARK_ALPHA}`);
exportImage("public/apple-touch-icon.png", "scale=180:180:flags=lanczos");
exportImage("public/favicon.png", "scale=64:64:flags=lanczos");
exportImage("public/favicon.ico", "scale=32:32:flags=lanczos", ["-c:v", "bmp"]);
exportImage("public/social-preview.png", [
  "scale=640:640:flags=lanczos",
  "pad=1280:640:0:0:color=0xd7d8d8",
  `drawtext=${font}:fontcolor=0x2c3133:fontsize=76:text='Orbit':x=660:y=218`,
  `drawtext=${font}:fontcolor=0x454c50:fontsize=28:text='Run herdr from anywhere.':x=664:y=330`,
  `drawtext=${font}:fontcolor=0x454c50:fontsize=20:text='CHAT  /  TERMINAL  /  MOBILE':x=666:y=410`,
].join(","));
