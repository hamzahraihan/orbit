import { describe, expect, it } from "bun:test";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

import { commentHeading, diffLineSelection, formatDiffComment, selectedDiffLines } from "./repoDiffComment.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 line one
-line two
+line two changed
+line three new
 line four
 line five
`;

const diff: FileDiffMetadata = parsePatchFiles(PATCH, "repo-diff-comment", true)[0]!.files[0]!;

const selection = (start: number, end: number, side: "additions" | "deletions" = "additions") =>
  ({ start, end, side }) as const;

describe("diff line selection", () => {
  it("reads the ends in file order and keeps the side it started on", () => {
    expect(diffLineSelection({ start: 5, end: 3, side: "additions" })).toEqual({ start: 3, end: 5, side: "additions" });
    expect(diffLineSelection({ start: 4, end: 6, side: "deletions", endSide: "deletions" })).toEqual({ start: 4, end: 6, side: "deletions" });
    expect(diffLineSelection({ start: 0, end: 3 })).toBeNull();
    expect(diffLineSelection(null)).toBeNull();
  });

  it("takes the rows of the side selected, in patch order", () => {
    expect(selectedDiffLines(diff, selection(2, 3))).toEqual([
      { sign: "+", text: "line two changed" },
      { sign: "+", text: "line three new" },
    ]);
    expect(selectedDiffLines(diff, selection(2, 2, "deletions"))).toEqual([{ sign: "-", text: "line two" }]);
    // a context line is numbered the same in both versions and taken once
    expect(selectedDiffLines(diff, selection(1, 1))).toEqual([{ sign: " ", text: "line one" }]);
    expect(selectedDiffLines(diff, selection(1, 5))).toHaveLength(5);
    expect(selectedDiffLines(diff, selection(9, 12))).toEqual([]);
  });
});

describe("diff comments", () => {
  it("heads the comment with the file and its lines, marking the version before the change", () => {
    expect(commentHeading("src/a.ts", selection(2, 3))).toBe("src/a.ts lines 2-3");
    expect(commentHeading("src/a.ts", selection(2, 2))).toBe("src/a.ts line 2");
    expect(commentHeading("src/a.ts", selection(2, 4, "deletions"))).toBe("src/a.ts old lines 2-4");
  });

  it("fences the selected rows and puts the note under them", () => {
    const block = formatDiffComment("src/a.ts", selection(2, 3), selectedDiffLines(diff, selection(2, 3)), "  Why rename this?\n")!;
    expect(block).toBe("src/a.ts lines 2-3:\n```diff\n+line two changed\n+line three new\n```\nWhy rename this?");
  });

  it("widens the fence past a run in the code, and refuses an empty selection or note", () => {
    const block = formatDiffComment("a.md", selection(1, 1), [{ sign: "+", text: "```js" }], "fence")!;
    expect(block).toContain("````diff\n+```js\n````");
    expect(formatDiffComment("a.md", selection(1, 1), [{ sign: "+", text: "x" }], "   ")).toBeNull();
    expect(formatDiffComment("a.md", selection(1, 1), [], "x")).toBeNull();
  });
});
