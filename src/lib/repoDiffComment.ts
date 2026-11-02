import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";

/** Which version of the file a selected line belongs to (a context line belongs to both). */
export type DiffSide = "additions" | "deletions";

/** A stretch of a diff the user selected: file line numbers and the version they came from. */
export interface DiffLineSelection {
  start: number;
  end: number;
  side: DiffSide;
}

/** One selected row: git's sign for its version, and its text without a line break. */
export interface DiffCommentLine {
  sign: "+" | "-" | " ";
  text: string;
}

/** A row while the selection is read: its number, and the version it belongs to (`both` for context). */
interface DiffRow extends DiffCommentLine {
  line: number;
  side: DiffSide | "both";
}

/**
 * A selection the package's line-selection reports, read as whole lines: the ends in file order,
 * and the side the pointer went down on. Null when there is no selection or it names no line.
 */
export function diffLineSelection(range: SelectedLineRange | null): DiffLineSelection | null {
  if (range === null) return null;
  const start = Math.floor(Math.min(range.start, range.end));
  const end = Math.floor(Math.max(range.start, range.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1) return null;
  const side: DiffSide = (range.side ?? range.endSide ?? "additions") === "deletions" ? "deletions" : "additions";
  return { start, end, side };
}

/**
 * The rows a selection covers, in patch order. Context rows are numbered and taken once (they are
 * the same line in both versions); added and deleted rows carry git's sign. A selection that
 * starts on a deletion reads the deletions, one that starts on an addition reads the additions, so
 * the numbers always belong to the side that is read.
 */
/** A parsed row's text without the line break the parser kept at its end. */
function lineText(text: string | undefined): string | null {
  if (text === undefined) return null;
  return text.replace(/\r?\n$/, "");
}

export function selectedDiffLines(diff: FileDiffMetadata, selection: DiffLineSelection): DiffCommentLine[] {
  const rows: DiffRow[] = [];
  for (const hunk of diff.hunks) {
    let addition = hunk.additionStart;
    let deletion = hunk.deletionStart;
    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let index = 0; index < block.lines; index += 1) {
          const text = lineText(diff.additionLines[block.additionLineIndex + index]);
          if (text !== null) rows.push({ sign: " ", text, line: addition, side: "both" });
          addition += 1;
          deletion += 1;
        }
        continue;
      }
      for (let index = 0; index < block.deletions; index += 1) {
        const text = lineText(diff.deletionLines[block.deletionLineIndex + index]);
        if (text !== null) rows.push({ sign: "-", text, line: deletion, side: "deletions" });
        deletion += 1;
      }
      for (let index = 0; index < block.additions; index += 1) {
        const text = lineText(diff.additionLines[block.additionLineIndex + index]);
        if (text !== null) rows.push({ sign: "+", text, line: addition, side: "additions" });
        addition += 1;
      }
    }
  }
  return rows
    .filter((row) => (row.side === "both" || row.side === selection.side) && row.line >= selection.start && row.line <= selection.end)
    .map(({ sign, text }) => ({ sign, text }));
}

/** The heading a comment carries: the file and the lines it is about, `old` for the version before the change. */
export function commentHeading(path: string, selection: DiffLineSelection): string {
  const version = selection.side === "deletions" ? "old " : "";
  const lines = selection.start === selection.end ? `line ${selection.start}` : `lines ${selection.start}-${selection.end}`;
  return `${path} ${version}${lines}`;
}

/**
 * The block a comment adds to the chat draft: the file and lines, the selected rows in a diff
 * fence, then the user's words. Null when nothing was selected or the note is blank.
 */
export function formatDiffComment(path: string, selection: DiffLineSelection, lines: readonly DiffCommentLine[], note: string): string | null {
  const words = note.trim();
  if (lines.length === 0 || words === "") return null;
  const body = lines.map((line) => `${line.sign}${line.text}`).join("\n");
  let fence = "```";
  for (const run of body.match(/`{3,}/g) ?? []) if (run.length >= fence.length) fence = "`".repeat(run.length + 1);
  return `${commentHeading(path, selection)}:\n${fence}diff\n${body}\n${fence}\n${words}`;
}
