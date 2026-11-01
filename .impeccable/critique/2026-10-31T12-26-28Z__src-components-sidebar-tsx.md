---
target: sidebar
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
target_identity: "file:C:\\herdr-plugins-project\\orbit\\src\\components\\Sidebar.tsx"
target_fingerprint: "sha256:e6ada6a7166600c859667f4293f0d124c046bed213d54b6a650d552d6d305fdf"
target_path: "C:\\herdr-plugins-project\\orbit\\src\\components\\Sidebar.tsx"
timestamp: 2026-10-31T12-26-28Z
slug: src-components-sidebar-tsx
---
⚠️ DEGRADED: single-context (only a web-research sub-agent is exposed in this session; no design-review or browser sub-agent to isolate Assessment A from Assessment B, so they ran sequentially)

# Sidebar Critique — Orbit (src/components/Sidebar.tsx)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Agent rows drop their state badge onto a second line at the far left; the phone drawer shows no rows, so no state at all |
| 2 | Match System / Real World | 3 | herdr's vocabulary is right (workspace, branch, agent), but two folder glyphs and a brand mark precede every name |
| 3 | User Control and Freedom | 3 | Rich escapes (menu, rename, confirmations, reorder); moot on a phone where the drawer renders blank |
| 4 | Consistency and Standards | 2 | Workspace rows overflow their grid by one child, agent rows by another; selection tint contradicts the documented neutral fill |
| 5 | Error Prevention | 3 | Empty-name guard, close confirmations, dirty-worktree escalation; truncated names defeat "which one am I closing?" |
| 6 | Recognition Rather Than Recall | 1 | Every workspace name truncates to 6–8 characters with no ellipsis ("checko", "expor", "retry-") |
| 7 | Flexibility and Efficiency | 3 | Alt+↑/↓, drag, touch long-press reorder, pins, keyboard menu — strong and largely undiscoverable |
| 8 | Aesthetic and Minimalist | 2 | Three glyphs before each title, a phantom line under each row, a 28×20 box per state |
| 9 | Error Recovery | 3 | Inline role="alert" with detail; a typed rename survives failure |
| 10 | Help and Documentation | 2 | Tooltips carry the whole truth, but nothing teaches pins or reorder |
| **Total** | | **24/40** | **Acceptable (60%)** |

## Design Specificity Verdict

The row model is authored for this product: a leading brand mark, the title, a dim place line (branch under a top-level repo, workspace·folder on two lines), a trailing state, worktree children indented under a repository rail with a +N fold count, and pins in a labelled card. An unrelated dashboard could not adopt this unchanged. What fails is execution, not identity: the grid that carries that model overflows its own column count in both row types, and the leading cell is spent three times over.

Deterministic scan: `impeccable detect` on the four sidebar markup files returned zero findings. The browser overlay (`impeccableDetectAsync` on the rendered sidebar) returned two: **cramped-padding** on `li.sidebar-row.is-selected` and on `li.agent-item.is-selected` — "children flush against bg on top (no inset)" — which is the same wrapped-grid-row defect the geometry probe measured (57px and 49px rows).

## What's Working

- the herdr-faithful row semantics: branch under the name for a top-level repository, the worktree indent rail, the dim +N fold count, a custom workspace name taking the branch's place with the real branch kept in the tooltip.
- the state language: a quiet dot for ready, "?" for blocked, a breathing dot for working aligned to one document clock, a plan count, and the state word kept for screen readers.
- interaction completeness: pointer-anchored row menus with focus restore, Alt+↑/↓, a finger's long-press reorder with before/after drop marks, pins shared across browsers, and confirmations that escalate to "Delete anyway" for a dirty worktree.

## Priority Issues

**[P0] The phone drawer opens empty.** `.sidebar-shell` became `position: fixed; transform: translateX(-100%)` in the new mobile block, while `is-open` is written on `.sidebar`. The drawer panel slides in; the list inside it stays translated 252px off-screen, so the first thing a phone user opens shows a blank sheet.
Fix: drop the fixed/transform block from `.sidebar-shell` (styles.css already owns the drawer on `.sidebar`) or key it to `.sidebar.is-open .sidebar-shell`.

**[P0] Workspace rows overflow their grid, doubling every row.** `.sidebar-row` declares `20px 20px 1fr auto` (four columns) but renders five children; `.sidebar-row-actions` wraps to an implicit second row at column 1. Measured: 57px rows against a 40px contract, and the invisible ⋯ (opacity 0, still focusable) becomes an extra tab stop on every row.
Fix: five columns with the actions cell in the template, or take the actions out of flow and keep four.

**[P0] Agent rows put their state badge on its own line.** `.agent-item` is a three-column grid with four items — mark, copy, plan/task count, state. The state badge wraps to row 2 column 1, so every agent row reads "name … then a lone dot below it", grows to 49px, and the Agents list (six panes) fills most of the drawer.
Fix: one trailing cell holding count + state, or four columns.

**[P1] Every workspace name is truncated with no ellipsis.** Content column measures 83px in a 264px sidebar: 24px of double padding (`nav.sidebar-list` and `ul.sidebar-list` both pad 12px), 40px of two leading cells, 24px of gaps, 28px of state. The ellipsis sits on the flex parent while the clip happens on the inner span, so names are cut mid-word: "checkout-api" → "checko", "export-guard" → "expor".
Fix: one leading cell, a single padding owner, and `text-overflow` on the element that clips.

**[P1] Three glyphs stand in front of every title.** `rowMark()` draws the brand mark, then the fold button draws a favicon/folder, then `.workspace-toggle-fold` draws a second folder. The screenshots show two folder outlines plus a mark; DESIGN.md specifies one leading cell that is either the mark or the fold.

## Persona Red Flags

**Alex (power user)**: 57px rows mean fewer workspaces per screen than the documented 40px; the hidden ⋯ is a tab stop he cannot see; names too short to scan ("fix/flak") push him to the command palette, making the sidebar decorative.

**Sam (accessibility)**: three tab stops per workspace row, one of them invisible; workspace state conveyed by a 6px dot whose label is visually hidden; truncated names give the screen reader less than the tooltip holds.

**Casey (phone)**: opens the drawer and gets an empty sheet — no workspaces, no agents, no footer; when rows do paint, state dots sit orphaned under each title and 49px rows push the Agents list past the fold.

## Minor Observations

- rail mode: state badges, the plan chip and row toggles render outside the 48px rail and overlap the transcript; "New workspace" collapses to a floating pink block.
- `.sidebar-selected` was changed to `--accent-tint` while DESIGN.md documents hover and selection sharing one neutral fill.
- footer stacks two full-width buttons (Install app, a lone centered gear) that read as primary actions.
- `.sidebar-status` is a 28×20 rounded box around a 6px dot; eight of them in the column read as checkboxes.
- a worktree child's status badge sits at the row's far right while its mark is indented, so the state column is ragged between parent and children.

## Questions to Consider

- If one leading cell replaced three glyphs, would anything actually be lost?
- Should a 264px sidebar hold a branch line at all, or is the branch a tooltip/two-line-mode concern?
- A ready row drawing no state is the documented calm; why does the shipped row draw an empty box for it?
