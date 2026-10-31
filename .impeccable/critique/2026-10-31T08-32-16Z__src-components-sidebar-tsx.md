---
target: src/components/Sidebar.tsx
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 1
timestamp: 2026-10-31T08-32-16Z
slug: src-components-sidebar-tsx
---
# Critique Report — Minimized Sidebar Rail (Orbit)

**Method:** dual-agent (A: CritiqueAssessmentA · B: CritiqueAssessmentB)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `.agent-row-status` clipped via `clip-path: inset(50%)` (src/styles.css:1711–1722); `.sidebar-inline-error` and `.error-state` are `display: none` (lines 1825, 1880). Running and idle agents identical at a glance; status only on hover via RailFlyout. |
| 2 | Match Between System and Real World | 2 | Worktree hierarchy flattened — indents reduced, branch connectors hidden; `Agents` section degrades to a bare floating caret (`.agent-section-caret`, lines 1908–1914) with no label. |
| 3 | User Control and Freedom | 2 | Row menu `⋯` (`display: none`, lines 1793–1795), machine controls (`display: none`, line 1903), Install app (`display: none`, line 1937) removed from rail; no keyboard path to row menu. |
| 4 | Consistency and Standards | 2 | `.palette-button` hidden (line 1742) but `.sidebar-search` reappears inside rail (lines 1760–1765); `<Monitor />` mark has no `title`/`aria-label` while workspace rows carry tooltips; mixed clip-path vs `display: none` hiding. |
| 5 | Error Prevention | 3 | Destructive ops confirm in expanded surface, but rail errors cannot be seen/prevented (`.sidebar-inline-error` `display: none`). |
| 6 | Recognition Rather Than Recall | 1 | **Critical failure:** all non-agent workspaces render identical `<Terminal />` (Sidebar.tsx:369) plus monogram sidecar; machines render identical unlabelled `<Monitor />` (MachineSidebar.tsx:111); no tooltip on glyphs; ~1000ms native tooltip delay. |
| 7 | Flexibility and Efficiency | 2 | Row menus hidden; no discoverable keyboard path to `⋯` menu without mouse; accelerators not advertised in rail. |
| 8 | Aesthetic and Minimalist Design | 2 | Agents section degrades to solitary floating chevron; monogram (20px SVG) beside Terminal glyph in 32px cell crowded/redundant; pinned-group label removed. |
| 9 | Error Recognition, Diagnosis, Recovery | 2 | Inline rename/connection errors suppressed (`display: none`, line 1880); status glyphs clipped; failed operations fail silently in rail. |
| 10 | Help and Documentation | 0 | Zero floating hints, contextual micro-copy, or discoverable cues; monitor glyphs lack native `title` tooltips. |

**Total: 18/40 — Severe usability deficiencies**

## Design Specificity Verdict

Grounded in Orbit/Quiet Slate, not category-interchangeable: the rail reuses Orbit tokens (`--side-row`, `--side-gutter`, `--bg-elevated`, `--border-strong`, `--status-*`), `StatusBadge`/`BackgroundBadge`/`PlanBadge`, `WorkspaceMonogram`, `RailFlyout` portals, and `clip-path: inset(50%)` accessible hiding used site-wide. The 50px rail width derives from `--control-h + --space-4`. However, execution degenerates into a generic icon column: identical `<Terminal />`/`<Monitor />` marks with monogram as a sidecar badge rather than the primary mark — that is the category-interchangeable part.

## Deterministic scan

The detector (`detect.mjs`) was run over the five changed markup targets (Sidebar.tsx, RailFlyout.tsx, WorkspaceMonogram.tsx, AgentSidebar.tsx, MachineSidebar.tsx); the two CSS targets were correctly skipped. Exit code 0, zero findings — clean pass. Browser visualization was attempted (fresh headless tab, console captured) but **no user-visible overlay is available**: the `file://` shell mounts only the app shell (`#root` + Vite entry); the React/Vite rail never mounts without a dev server, so `detect.js` injection produced nothing and `tab.console()` returned an empty console. Automation pipeline verified functional; zero false positives. This is the fallback signal.

## Overall Impression

The rail has one genuinely excellent piece — RailFlyout (instant, theme-aware hover/focus flyout) — wrapped in a surface that fails its core job: glanceable identification and state. The minimized sidebar forces users to probe every icon sequentially to learn which workspace is which or whether an agent is running, violating the Operate mode's scanability mandate.

## What's Working

1. **RailFlyout instant hover/focus flyout** — zero-delay portal, viewport-clamped, `role="tooltip"`, theme-aware border/shadow, carries title/subtitle/detail/statusBadge. Exactly the right pattern for a density-constrained rail.
2. **Stable shell bookends** — `+` New workspace, Search, and Settings gear stay anchored at rail extremities across collapse states, preserving muscle memory.
3. **Accessible subpixel text clipping** — rail-hidden text uses `clip-path: inset(50%)` / 1px boxes rather than `display: none`, so screen readers and tests retain full access to titles, branches, status descriptions.

## Priority Issues

**[P0] Recognition failure — identical Terminal/Monitor marks, no status at a glance**
**What:** non-agent workspaces share `<Terminal />` (Sidebar.tsx:369); machines share `<Monitor />` (MachineSidebar.tsx:111). WorkspaceMonogram is a 20px sidecar badge beside the glyph, not the primary identifier. Status dots/badges clipped (`.agent-row-status` in clip-path selector, line 1711).
**Why:** Violates Heuristic #6. A user with multiple workspaces/agents cannot distinguish `auth-service` from `orbit` without hovering each icon and waiting ~1000ms per native tooltip.
**Fix:** Make the monogram (or machine initials) the primary rail mark, colored/ringed by semantic status so running/blocked/done is visible without hover. RailFlyout remains the detail layer, not the only identification layer.
**Suggested command:** `/impeccable layout` (primary mark + status ring) or `/impeccable colorize` (status color on mark).

**[P0] Touch-target deficit in compact rail density**
**What:** rail rows are `--side-row = 32px` tall in a `--sidebar-rail-w = 50px` column, but `--touch-target = 44px` is the coarse-pointer floor. No invisible expander grows hit area.
**Why:** Violates PRODUCT.md §Accessibility (44px hit areas) and WCAG 2.5.5 on touch/hybrid desktops (769px+ with touch).
**Fix:** Grow `--side-row` in rail to meet 44px, or add an invisible `::before` expander reaching `--touch-target`.
**Suggested command:** `/impeccable adapt` (touch target sizing for rail rows).

**[P1] Worktree hierarchy cues stripped, fold state invisible**
**What:** worktree indents reduced (`padding-left: var(--space-2)`, lines 1826–1828); branch connectors `::after` hidden (lines 1841–1843); folded state only knowable via hover tooltip.
**Why:** Violates Heuristics #2 and #3. Linked worktrees appear as detached siblings; folded checkout unreachable without expanding sidebar.
**Fix:** continuous vertical connector spine (2px `--border-strong`) in rail left gutter for worktree groups; compact `+N` fold-count badge on parent rail mark; fold toggle opens flyout listing worktrees.
**Suggested command:** `/impeccable layout` (worktree spine + fold badge).

**[P2] Silent errors in rail — inline errors and machine failures suppressed**
**What:** `.sidebar-inline-error` `display: none` (lines 1880–1882); `.error-state` `display: none` (lines 1731–1733); restore-error badges clipped.
**Why:** Violates Heuristics #1 and #9. Failed renames, connection errors, restore errors fail silently in rail; no local cue an action failed.
**Fix:** surface rail errors via status ring (`--status-blocked`) on rail mark plus error tooltip/flyout on hover; never `display: none` an error where it's the only feedback.
**Suggested command:** `/impeccable harden` (error surface in rail).

**[P3] Abrupt layout snap on collapse/expand**
**What:** toggling collapse flips `--sidebar-shown-w` instantly (line 1697); no transition on sidebar/header/pane-column.
**Why:** visual disorientation; terminal buffer reflows; header crumbs snap in 0ms.
**Fix:** `transition: width var(--dur-base) var(--ease-out)` on sidebar container, suppressed under `prefers-reduced-motion: reduce`.
**Suggested command:** `/impeccable animate` (collapse transition) or `/impeccable quieter`.

## Persona Red Flags

**Alex (Power User — Terminal & Agent Multiplexing):** Runs 8 workspaces across local + remote PCs with 3 autonomous agents. In rail: 2 identical `<Monitor />` icons and 6 identical `<Terminal />` icons. To find `auth-service`, Alex hovers each icon with a 1000ms tooltip penalty each time. Closing a finished workspace via keyboard is impossible — `⋯` menu is `display: none`. Alex abandons rail mode entirely and works expanded, sacrificing screen real estate.

**Jordan (First-Timer — Junior Developer):** Clicks header toggle. Sidebar instantly snaps shut with no transition. In rail middle, Jordan sees an isolated unlabelled chevron (`.agent-section-caret`) floating alone — clicks it, nothing visibly happens (`"Agents"` text clipped, list `hidden={collapsed}`). Hovers top monitor icon expecting a label — no tooltip (`<Monitor />` has no `title`). Jordan assumes the rail is broken.

**Project-specific (herdr remote-PC audience):** Users managing local vs SSH machines need host vs remote at a glance. `<Monitor />` is identical for both; `machine-kind` ("Host"/"SSH") span is clipped (line 1711 selector), so the distinction exists only for screen readers, not sighted users.

## Minor Observations

1. **Monogram is redundant beside Terminal glyph** — `rowMark` renders both together (lines 368–371); two marks fight in a 32px cell. Monogram should be the mark, not an annotation.
2. **Pinned-group boundary lost** — `.sidebar-pinned` border removed, `.sidebar-pinned-label` hidden (lines 1863–1870). Pinned workspaces blend into regular ones.
3. **Header search relocation disconnect** — `.palette-button` hidden (line 1742), `.sidebar-search` appears inside rail (lines 1760–1765); trigger moves between states without affordance explaining the move.
4. **Machine mark lacks accessible label on glyph itself** — `<Monitor />` has `aria-hidden="true"` (line 111) and no `title`; identifying `title` lives on parent `machine-header`, so mark alone communicates nothing.
5. **Agent section caret floats without category glyph** — collapsed state shows only `ChevronRight` (lines 227–231); no Bot/Sparkle mark, no visual `"Agents"` label.

## Questions to Consider

1. Why is the monogram a sidecar badge next to the Terminal glyph instead of replacing it as the primary workspace identifier?
2. Should the rail surface a status ring on the mark itself so running/blocked agents are visible without hover? Currently all status info is hidden until RailFlyout appears — a rail's purpose is glanceability; forcing a hover to learn "agent is blocked" defeats it.
3. Should linked git worktrees remain flattened in the rail's vertical flow, or be accessed through a flyout drawer anchored to their parent checkout?
