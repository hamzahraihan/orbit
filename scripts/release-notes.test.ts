import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIGHLIGHT_LIMIT, HIGHLIGHTS_PER_GROUP, releaseNotes, releaseSummaries, SUMMARY_GROUPS, SUMMARY_LANGUAGES, SUMMARIES_FILE } from "./release-notes.ts";

const manifest = 'name = "herdr-web-ui"\nversion = "1.2.3"\n';
const changelog = '# Changelog\n\n## [Unreleased]\nFuture\n\n## [1.2.3] — today\n\n- Fixed input.\n\n## [1.2.2]\nOld\n\n[1.2.3]: https://example.com\n';
const told = { en: { fixed: ["Input."] }, ko: { fixed: ["입력."] }, ja: { fixed: ["入力。"] }, zh: { fixed: ["输入。"] }, tr: { fixed: ["Girdi."] } };
const summaries = JSON.stringify({ "1.2.3": told, "1.2.2": { en: { fixed: ["Old."] } } });
test("release notes belong only to the exact requested version", () => {
  expect(releaseNotes("1.2.3", "1.2.3", manifest, changelog, summaries)).toBe(
    "### Bug fixes\n\n- Input.\n\n<details><summary>Full changelog</summary>\n\n- Fixed input.\n\n</details>");
});
test("release notes are the English patch-note lists in order, then the changelog section folded", () => {
  const en = { fixed: [" Crash. ", "Hang."], new: ["Cards."], improved: ["Speed."] };
  const all = JSON.stringify({ "1.2.3": { ...told, en } });
  expect(releaseNotes("1.2.3", "1.2.3", manifest, changelog, all)).toBe([
    "### New features\n\n- Cards.",
    "### Improvements\n\n- Speed.",
    "### Bug fixes\n\n- Crash.\n- Hang.",
    "<details><summary>Full changelog</summary>\n\n- Fixed input.\n\n</details>",
  ].join("\n\n"));
  const empty = JSON.stringify({ "1.2.3": { ...told, en: { new: [], improved: ["Speed."] } } });
  expect(releaseNotes("1.2.3", "1.2.3", manifest, changelog, empty)).toStartWith("### Improvements\n\n- Speed.\n\n<details>");
});
test("a summary line stays one line of text: no break and no tag can hide the changelog fold", () => {
  const tagged = JSON.stringify({ "1.2.3": { ...told, en: { fixed: ["Copy <!-- markers."] } } });
  expect(releaseNotes("1.2.3", "1.2.3", manifest, changelog, tagged)).toStartWith("### Bug fixes\n\n- Copy &lt;!-- markers.\n\n<details>");
  for (const ja of ["入力。\n\n<!--", "入\r力。"]) {
    expect(() => releaseNotes("1.2.3", "1.2.3", manifest, changelog, JSON.stringify({ "1.2.3": { ...told, ja: { fixed: [ja] } } }))).toThrow("one line");
  }
});
test("invalid versions and mismatched metadata cannot be released", () => {
  for (const version of ["v1.2.3", "1.2.3-rc.1", "01.2.3", "1.2.3\n", "1.2.3; echo bad", ""]) {
    expect(() => releaseNotes(version, version, manifest, changelog, summaries)).toThrow();
  }
  expect(() => releaseNotes("1.2.3", "1.2.4", manifest, changelog, summaries)).toThrow("package.json");
  expect(() => releaseNotes("1.2.3", "1.2.3", 'version = "1.2.4"', changelog, summaries)).toThrow("herdr-plugin.toml");
});
test("missing, prefix-matched, duplicate and empty notes cannot be released", () => {
  for (const text of ["## [1.2.30]\nWrong", "## [1.2.3]extra\nWrong", "## [1.2.3]\n\n## [1.2.2]\nOld", "## [1.2.3]\nA\n## [1.2.3]\nB"]) {
    expect(() => releaseNotes("1.2.3", "1.2.3", manifest, text, summaries)).toThrow();
  }
});
test("a release that is not told in every language of the app cannot be released", () => {
  const { zh: _zh, ...three } = told;
  for (const text of ["", "{}", JSON.stringify({ "1.2.2": told }), JSON.stringify({ "1.2.3": three }), JSON.stringify({ "1.2.3": { ...told, ja: { fixed: ["  "] } } }), JSON.stringify({ "1.2.3": { ...told, ja: "入力。" } })]) {
    expect(() => releaseNotes("1.2.3", "1.2.3", manifest, changelog, text)).toThrow("release-summaries.json");
  }
  expect(() => releaseNotes("1.2.3", "1.2.3", manifest, changelog, JSON.stringify({ "1.2.3": three }))).toThrow("zh");
});

/** The release's patch notes as they are written, read back from the file beside the changelog. */
describe("a release told as patch notes", () => {
  const written = JSON.stringify({
    "0.4.0": {
      en: { new: ["  A new thing.  ", "", 7, "Another."], fixed: ["A fix."], removed: ["Not a list the app has."] },
      ko: { new: ["새 기능."], improved: [], fixed: "수정." },
      ja: {},
      fr: { new: ["Une chose."] },
    },
    "0.3.10": { en: { improved: ["Ten is better."] } },
    "0.3.9": "nine",
    "next": { en: { new: ["No version."] } },
    "0.3.8": { en: ["Not grouped."] },
    "0.3.7": { en: { new: "One line, not a list." } },
  });

  test("reads each release's lines, under the lists and in the languages the app has", () => {
    expect([...releaseSummaries(written)]).toEqual([
      ["0.4.0", { en: { new: ["A new thing.", "Another."], fixed: ["A fix."] }, ko: { new: ["새 기능."] } }],
      ["0.3.10", { en: { improved: ["Ten is better."] } }],
    ]);
  });

  test("has none in a file that is not an object of releases", () => {
    for (const text of ["", "not json", "[]", "null", "7", '"0.4.0"', '{"__proto__":{"en":{"new":["x"]}}}']) expect(releaseSummaries(text).size).toBe(0);
  });

  test("cuts a line that is no line, and a list that is no handful", () => {
    const told = releaseSummaries(JSON.stringify({ "0.4.0": { en: {
      new: ["a".repeat(HIGHLIGHT_LIMIT + 500)], fixed: Array.from({ length: HIGHLIGHTS_PER_GROUP + 5 }, (_, index) => `Fix ${index}.`),
    } } })).get("0.4.0")!.en!;
    expect(told.new![0]).toHaveLength(HIGHLIGHT_LIMIT + 1);
    expect(told.new![0]!.endsWith("…")).toBe(true);
    expect(told.fixed).toHaveLength(HIGHLIGHTS_PER_GROUP);
  });
});

describe("this repository's own summaries", () => {
  const root = join(import.meta.dir, "..");
  const text = readFileSync(join(root, SUMMARIES_FILE), "utf8");
  const summaries = releaseSummaries(text);
  const released = [...readFileSync(join(root, "CHANGELOG.md"), "utf8").matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1]!);
  /** the last release cut before summaries were written */
  const BEFORE = "0.3.52";
  /** patch notes are read at a glance: a line longer than this is a sentence from the changelog */
  const LINE = 90;
  /** the later of two versions, compared as numbers and not as text */
  const later = (a: string, b: string): boolean => {
    const [first, second] = [a, b].map((version) => version.split(".").map(Number));
    return first![0]! > second![0]! || (first![0] === second![0] && (first![1]! > second![1]! || (first![1] === second![1] && first![2]! > second![2]!)));
  };

  test("tells every release since in every language the app has", () => {
    const missing = released.filter((version) => later(version, BEFORE))
      .flatMap((version) => SUMMARY_LANGUAGES.filter((language) => !summaries.get(version)?.[language]).map((language) => `${version} ${language}`));
    expect(missing).toEqual([]);
  });

  test("holds nothing but short lines for releases the changelog names, the same lists in every language", () => {
    const raw = JSON.parse(text) as Record<string, Record<string, Record<string, string[]>>>;
    for (const [version, entry] of Object.entries(raw)) {
      expect(released).toContain(version);
      expect(Object.keys(entry).sort()).toEqual([...SUMMARY_LANGUAGES].sort());
      // what was read is what was written: nothing dropped, cut or trimmed
      expect(summaries.get(version) as unknown).toEqual(entry);
      const shape = (language: string) => SUMMARY_GROUPS.map((group) => entry[language]![group]?.length ?? 0);
      for (const language of SUMMARY_LANGUAGES) {
        expect([version, language, shape(language)]).toEqual([version, language, shape("en")]);
        for (const line of Object.values(entry[language]!).flat()) expect(line.length).toBeLessThanOrEqual(LINE);
      }
    }
  });
});
