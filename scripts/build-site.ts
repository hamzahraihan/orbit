/**
 * Assembles the website into _site/ for GitHub Pages (.github/workflows/pages.yml) and for a local
 * look (`bun run build:site`, then serve _site/).
 *
 * The page is site/index.html, with its Simplified Chinese copy at site/zh/index.html (the same page,
 * its paths one level up; a change to one belongs in the other). The installer still and the page's
 * own logo mark are committed; the installer still is scaled down when ffmpeg is installed, and
 * `{{version}}`, `{{stars}}`, `{{contributors}}`, `{{plugin_rank}}` and `{{plugin_repo_count}}` in the
 * page are filled in here, from package.json, the GitHub API and herdr's plugin index. The page's FAQ
 * rows are also written into its head as FAQPage structured data, so the two cannot differ, and
 * sitemap.xml lists the page (the demo is noindex and stays out of it).
 *
 * demo/ is the app itself, built by Vite with relative asset paths into demo/app/, loaded behind
 * site/demo/transport.ts (bundled to demo-transport.js and injected before the app's scripts) so it
 * runs on the fixtures in site/demo/ instead of a server; site/demo/index.html frames it with a
 * banner. Building it needs node_modules (`bun install`).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");

const copies: Array<[from: string, to: string]> = [
  ["site/index.html", "index.html"],
  ["site/zh/index.html", "zh/index.html"],
  ["site/googlec8861932279eca6b.html", "googlec8861932279eca6b.html"],
  // the one-line installer: curl -fsSL https://raw.githubusercontent.com/hamzahraihan/orbit/main/install.sh | sh
  ["install.sh", "install.sh"],
  ["install.ps1", "install.ps1"],
  ["public/favicon.ico", "favicon.ico"],
  ["public/favicon.png", "favicon.png"],
  ["public/apple-touch-icon.png", "apple-touch-icon.png"],
  ["public/icons/icon-192.png", "assets/icon-192.png"],
  ["public/social-preview.png", "assets/social-preview.png"],
];

/** The pages, in _site/: every one gets the figures and the FAQ data below. */
const pages = ["index.html", "zh/index.html"];

/** README stills, scaled down for the page when ffmpeg is there. */
const stills: Array<{ file: string; width: number }> = [{ file: "install.png", width: 1400 }];

async function run(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) console.warn(`${cmd[0]} failed (${code}): ${await new Response(proc.stderr).text()}`.trim());
  return code === 0;
}

// size guard, before anything is removed: the page's mark is committed, so it must stay small
const MB = 1024 * 1024;
for (const file of existsSync(join(root, "site/assets")) ? readdirSync(join(root, "site/assets"), { recursive: true, encoding: "utf8" }) : []) {
  const stat = statSync(join(root, "site/assets", file));
  if (stat.isFile() && stat.size > 0.75 * MB) throw new Error(`site/assets/${file} is ${(stat.size / MB).toFixed(2)} MB, over its 0.75 MB cap`);
}

rmSync(out, { recursive: true, force: true });
for (const [from, to] of copies) {
  const target = join(out, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, from), target);
}
writeFileSync(join(out, ".nojekyll"), "");

// committed page assets and media, copied as they are
for (const dir of ["assets", "media"]) {
  const from = join(root, "site", dir);
  if (existsSync(from)) cpSync(from, join(out, dir), { recursive: true });
}

const hasFfmpeg = Bun.which("ffmpeg") !== null;
for (const still of stills) {
  const from = join(root, "docs/screenshots", still.file);
  const target = join(out, "assets", still.file);
  if (!hasFfmpeg || !(await run(["ffmpeg", "-v", "error", "-y", "-i", from, "-vf", `scale=${still.width}:-1`, target]))) copyFileSync(from, target);
}

// the pages' figures: the release they are built from, and the repository's stars as of the build
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const repo = await fetch("https://api.github.com/repos/hamzahraihan/orbit", { headers: { accept: "application/vnd.github+json" } }).catch(() => null);
const repoBody: unknown = repo?.ok ? await repo.json() : null;
const stars = repoBody && typeof repoBody === "object" && "stargazers_count" in repoBody && typeof repoBody.stargazers_count === "number" ? repoBody.stargazers_count : null;
if (stars === null) console.warn(`GitHub star count unavailable (${repo ? `HTTP ${repo.status}` : "no connection"}): the page shows a dash`);
// the people with a commit on the default branch, bots left out: at most ten pages, and a part of
// the list is not a count, so a page that cannot be read leaves a dash
let contributors: number | null = 0;
for (let pageNumber = 1; contributors !== null && pageNumber <= 10; pageNumber += 1) {
  const response = await fetch(`https://api.github.com/repos/hamzahraihan/orbit/contributors?per_page=100&page=${pageNumber}`, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const body: unknown = response?.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(body)) {
    console.warn(`GitHub contributor count unavailable (${response ? `HTTP ${response.status}` : "no connection"}): the page shows a dash`);
    contributors = null;
    break;
  }
  contributors += body.filter((entry) => entry && typeof entry === "object" && entry.type !== "Bot").length;
  if (body.length < 100) break;
  // a full tenth page: there may be more, so the sum is not the count
  if (pageNumber === 10) contributors = null;
}
// Where this repository stands by stars. A repository can ship several plugins, so the label
// counts the same repositories as the rank, not the index's separate pluginCount.
const index = await fetch("https://assets.herdr.dev/plugins/index.json", { signal: AbortSignal.timeout(10_000) }).catch(() => null);
const indexBody: unknown = index?.ok ? await index.json().catch(() => null) : null;
const repositoryCount = indexBody && typeof indexBody === "object" && "repositoryCount" in indexBody &&
  typeof indexBody.repositoryCount === "number" && Number.isSafeInteger(indexBody.repositoryCount) && indexBody.repositoryCount >= 0
  ? indexBody.repositoryCount : null;
const listed = indexBody && typeof indexBody === "object" && "plugins" in indexBody && Array.isArray(indexBody.plugins) ? indexBody.plugins : [];
const starsByRepo = new Map<string, number>();
for (const plugin of listed) {
  if (plugin && typeof plugin === "object" && typeof plugin.fullName === "string" && typeof plugin.stars === "number") starsByRepo.set(plugin.fullName, plugin.stars);
}
const listedStars = starsByRepo.get("hamzahraihan/orbit");
const rank = listedStars === undefined ? null : [...starsByRepo.values()].filter((count) => count > listedStars).length + 1;
if (rank === null) console.warn(`herdr plugin index unavailable (${index ? `HTTP ${index.status}` : "no connection"}) or the plugin is not in it: the page shows a dash`);

for (const name of pages) {
  let page = readFileSync(join(out, name), "utf8");
  page = page.replaceAll("{{version}}", version);
  page = page.replaceAll("{{stars}}", stars === null ? "—" : stars.toLocaleString("en-US"));
  page = page.replaceAll("{{contributors}}", contributors === null ? "—" : contributors.toLocaleString("en-US"));
  page = page.replaceAll("{{plugin_rank}}", rank === null ? "—" : `#${rank}`);
  page = page.replaceAll("{{plugin_repo_count}}", repositoryCount === null ? "—" : repositoryCount.toLocaleString("en-US"));

  // the FAQ as structured data, read from the rows the page shows
  // (a row's closing "… →" link is navigation, not part of the answer)
  const text = (html: string) => html.replace(/<a [^>]*>[^<]*→<\/a>/g, "").replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
  const questions = [...page.matchAll(/<div class="qa">\s*<dt>(.*?)<\/dt>\s*<dd>(.*?)<\/dd>\s*<\/div>/gs)].map((match) => {
    const question = match[1];
    const answer = match[2];
    if (question === undefined || answer === undefined) throw new Error(`site/${name} has a FAQ row without a question or answer`);
    return {
      "@type": "Question",
      name: text(question),
      acceptedAnswer: { "@type": "Answer", text: text(answer) },
    };
  });
  const rowCount = [...page.matchAll(/<div class="qa">/g)].length;
  if (questions.length === 0 || questions.length !== rowCount) throw new Error(`site/${name} has missing or unparseable FAQ rows (<div class="qa">)`);
  const faq = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions }).replaceAll("<", "\\u003c");
  page = page.replace("</head>", () => `  <script type="application/ld+json">${faq}</script>\n  </head>`);
  writeFileSync(join(out, name), page);
}
// A rebuild is not necessarily a content change; omit the optional lastmod rather than invent it.
writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://hamzahraihan.github.io/orbit/</loc></url>\n  <url><loc>https://hamzahraihan.github.io/orbit/zh/</loc></url>\n</urlset>\n`,
);

// the demo: the real client, relative paths, the transport in front of it
const demoApp = join(out, "demo", "app");
if (!(await run([process.execPath, "--bun", join(root, "node_modules/.bin/vite"), "build", "--base", "./", "--outDir", demoApp, "--emptyOutDir", "--logLevel", "warn"]))) throw new Error("vite build for the demo failed");

const bundle = await Bun.build({
  entrypoints: [join(root, "site/demo/transport.ts")],
  outdir: demoApp,
  naming: "demo-transport.js",
  target: "browser",
  minify: true,
  define: { __APP_VERSION__: JSON.stringify(version) },
});
if (!bundle.success) throw new Error(`demo transport bundle failed:\n${bundle.logs.map(String).join("\n")}`);
const appPage = join(demoApp, "index.html");
let html = readFileSync(appPage, "utf8");
// Vite leaves the PWA links root-absolute; on Pages the root is another site. The manifest goes:
// the demo is not an app to install (its scope and start_url name a root that is not it).
html = html.replace(/\s*<link rel="manifest"[^>]*>/, "");
html = html.replace(/(href|src)="\/(?!\/)/g, '$1="./');
if (!html.includes("</head>")) throw new Error("the built demo app has no head for its noindex directive");
html = html.replace("</head>", '  <meta name="robots" content="noindex" />\n  </head>');
if (!/<script type="module"/.test(html)) throw new Error("the built app has no module script to load the demo transport before");
html = html.replace(/<script type="module"/, '<script src="./demo-transport.js"></script>\n    <script type="module"');
writeFileSync(appPage, html);
// the brand mark is <img src="/icons/…"> in the client (src/App.tsx, AccessGate.tsx): root-absolute,
// which is right for the app at its own origin and wrong under demo/app/
for (const script of new Bun.Glob("assets/*.js").scanSync({ cwd: demoApp })) {
  const file = join(demoApp, script);
  writeFileSync(file, readFileSync(file, "utf8").replaceAll('"/icons/', '"./icons/'));
}
copyFileSync(join(root, "site/demo/index.html"), join(out, "demo", "index.html"));

const files = new Bun.Glob("**/*").scanSync({ cwd: out, dot: true });
let bytes = 0;
for (const file of files) bytes += Bun.file(join(out, file)).size;
console.log(`_site: ${(bytes / 1024 / 1024).toFixed(1)} MB${hasFfmpeg ? "" : " (no ffmpeg: full-size stills)"}`);
