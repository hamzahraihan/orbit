import { readFileSync } from "node:fs";
import { FRAGMENTS_DIR, fragmentFiles } from "./changelog-fold.ts";

/** Where a release tells itself as patch notes, a few short lines per language, beside CHANGELOG.md. */
export const SUMMARIES_FILE = "release-summaries.json";

/** The languages a release's summary is written in: the app's own (src/lib/i18n.ts). */
export const SUMMARY_LANGUAGES = ["en", "ko", "ja", "zh"] as const;
export type SummaryLanguage = typeof SUMMARY_LANGUAGES[number];
/** The lists a summary is told in, in the order they are read. */
export const SUMMARY_GROUPS = ["new", "improved", "fixed"] as const;
export type SummaryGroup = typeof SUMMARY_GROUPS[number];
/** A release as patch notes: short lines of plain text under what is new, improved and fixed. A list with no line is absent. */
export type ReleaseHighlights = Partial<Record<SummaryGroup, string[]>>;
/** A release's highlights per language; a language the release did not write is absent. */
export type ReleaseSummary = Partial<Record<SummaryLanguage, ReleaseHighlights>>;
/** A highlight is one line, and a list a handful of them: what is longer is cut where it is read. */
export const HIGHLIGHT_LIMIT = 160;
export const HIGHLIGHTS_PER_GROUP = 8;

/**
 * A summary as it was written or sent (release-summaries.json from a Git remote, the server over
 * HTTP): the lines that are text, under the lists and languages the
 * app has, each cut to a line and each list to a handful. Nothing when no line is left.
 */
export function readSummary(value: unknown): ReleaseSummary | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const summary: ReleaseSummary = {};
  for (const language of SUMMARY_LANGUAGES) {
    const written: unknown = (value as Record<string, unknown>)[language];
    if (typeof written !== "object" || written === null) continue;
    const highlights: ReleaseHighlights = {};
    for (const group of SUMMARY_GROUPS) {
      const lines: unknown = (written as Record<string, unknown>)[group];
      if (!Array.isArray(lines)) continue;
      const kept = lines.filter((line): line is string => typeof line === "string" && line.trim() !== "")
        .slice(0, HIGHLIGHTS_PER_GROUP)
        .map((line) => line.trim())
        .map((line) => line.length > HIGHLIGHT_LIMIT ? `${line.slice(0, HIGHLIGHT_LIMIT).trimEnd()}…` : line);
      if (kept.length > 0) highlights[group] = kept;
    }
    if (Object.keys(highlights).length > 0) summary[language] = highlights;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function triple(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * release-summaries.json as a release wrote it:
 * `{ "0.3.53": { "en": { "new": ["…"], "improved": ["…"], "fixed": ["…"] }, "ko": { … }, … } }`.
 * It is text from a Git remote, like the changelog: what is not a version with lines in a
 * language the app has is left out, and a file that is not JSON holds no summary.
 */
export function releaseSummaries(text: string): Map<string, ReleaseSummary> {
  const found = new Map<string, ReleaseSummary>();
  let written: unknown;
  try { written = JSON.parse(text); } catch { return found; }
  if (typeof written !== "object" || written === null || Array.isArray(written)) return found;
  for (const [version, entry] of Object.entries(written)) {
    const summary = triple(version) ? readSummary(entry) : undefined;
    if (summary) found.set(version, summary);
  }
  return found;
}

/** The GitHub release's headings for the patch-note lists, in SUMMARY_GROUPS order. */
const GROUP_HEADINGS: Record<SummaryGroup, string> = { new: "New features", improved: "Improvements", fixed: "Bug fixes" };

/**
 * Fail before publishing a tag: all three version sources and nonempty notes must agree, and the
 * release must be told as patch notes in every language of the app (release-summaries.json),
 * which is what an install shows of it.
 * The GitHub release reads as an install shows it: the English patch-note lists (a list with no
 * line left out), then the whole CHANGELOG section folded under them.
 * `fragments` are the files left in changelog.d/: a fragment merged after the release PR folded
 * them would ship without a line in these notes, so the release refuses until it is placed.
 */
export function releaseNotes(version: string, packageVersion: string, manifest: string, changelog: string, summaries: string, fragments: string[] = []): string {
  if (version !== version.trim() || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Expected version X.Y.Z without v");
  if (fragments.length > 0) {
    throw new Error(`${FRAGMENTS_DIR}/ still holds ${fragments.join(", ")}, which this release's notes would leave out. In a PR, move their entries `
      + `under "## [${version}]" in CHANGELOG.md (bun scripts/changelog-fold.ts only makes a new version), add each PR link, and delete the files`);
  }
  if (packageVersion !== version) throw new Error("package.json version does not match");
  if (!manifest.split(/\r?\n/).some((line) => line === `version = "${version}"`)) throw new Error("herdr-plugin.toml version does not match");
  const sections = changelog.split(/^## /m).slice(1);
  const matching = sections.filter((section) => section.startsWith(`[${version}]`) && /^(?:\s|$)/.test(section.slice(version.length + 2)));
  if (matching.length !== 1) throw new Error("CHANGELOG.md must contain exactly one heading for this version");
  const notes = matching[0]!.split("\n").slice(1).filter((line) => !/^\[[^\]]+\]: /.test(line)).join("\n").trim();
  if (!notes) throw new Error("Release notes are empty");
  const summary = releaseSummaries(summaries).get(version);
  const untold = SUMMARY_LANGUAGES.filter((language) => !summary?.[language]);
  if (untold.length > 0) throw new Error(`${SUMMARIES_FILE} must tell this version in: ${untold.join(", ")}`);
  const lines = SUMMARY_LANGUAGES.flatMap((language) => SUMMARY_GROUPS.flatMap((group) => summary![language]![group] ?? []));
  if (lines.some((line) => /[\r\n]/.test(line))) throw new Error(`${SUMMARIES_FILE} lines must each be one line`);
  const english = summary!.en!;
  const lists = SUMMARY_GROUPS.flatMap((group) => {
    const written = english[group];
    // plain text, as the app shows it: no `<` may open a tag or a comment that hides the fold
    return written ? [`### ${GROUP_HEADINGS[group]}\n\n${written.map((line) => `- ${line.replaceAll("<", "&lt;")}`).join("\n")}`] : [];
  });
  // the blank lines inside <details> are what make GitHub render the markdown there
  return [...lists, `<details><summary>Full changelog</summary>\n\n${notes}\n\n</details>`].join("\n\n");
}

if (import.meta.main) {
  console.log(releaseNotes(process.argv[2] ?? "", JSON.parse(readFileSync("package.json", "utf8")).version,
    readFileSync("herdr-plugin.toml", "utf8"), readFileSync("CHANGELOG.md", "utf8"), readFileSync(SUMMARIES_FILE, "utf8"), fragmentFiles(FRAGMENTS_DIR)));
}
