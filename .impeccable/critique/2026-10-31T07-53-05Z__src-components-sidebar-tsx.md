---
target: critique sidebar, especially when it gets minimized
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-10-31T07-53-05Z
slug: src-components-sidebar-tsx
---
Method: dual-agent (A: AssessmentA · B: AssessmentB)

### Design Health Score

| # | Heuristic | Score | Evidence & Code Location | Key Issue |
|---|-----------|:-----:|--------------------------|-----------|
| 1 | Visibility of System Status | 2 | `src/styles.css:1711–1722, 1784–1801`; `src/components/Sidebar.tsx:736–739` | Agent background tasks (`BackgroundBadge`) and plan steps (`PlanBadge`) are clipped (`clip-path: inset(50%)`). Inline operation errors (`.sidebar-inline-error`) and PC failure states are suppressed (`display: none`). |
| 2 | Match System / Real World | 2 | `src/components/Sidebar.tsx:356–362`; `src/styles.css:1803–1811` | Linked git worktrees lose their tree indents and branch connectors (`::before`/`::after` hidden, `padding-left: 0`), flattening hierarchical workspaces into an undifferentiated list. |
| 3 | User Control and Freedom | 2 | `src/styles.css:1786, 1847, 1868`; `src/components/Sidebar.tsx:673–681` | Fold toggles (`.workspace-toggle`, `.machine-toggle`) are stripped (`display: none`). Users cannot fold/unfold worktrees or PC groups while minimized in rail mode. |
| 4 | Consistency and Standards | 2 | `src/App.tsx:1558`; `src/styles.css:1742, 1761–1766` | Header command palette button (`.palette-button`) is hidden when collapsed, but search reappears inside the rail below `New workspace`. |
| 5 | Error Prevention | 3 | `src/components/Sidebar.tsx:414–423`; `src/components/MachineSidebar.tsx:126` | Destructive operations (closing workspaces, deleting worktrees, removing PCs) enforce modal confirmation guards. |
| 6 | Recognition Rather Than Recall | 1 | `src/components/Sidebar.tsx:356–362`; `src/components/MachineSidebar.tsx:100–106` | **Critical Failure.** Non-agent workspaces all share identical `<Terminal />` marks. Connected machines share identical unlabelled `<Monitor />` marks without hover titles. Users must rely on memory or slow OS tooltips ($1000\text{ ms}$ delay). |
| 7 | Flexibility and Efficiency | 2 | `src/styles.css:1786, 1868`; `src/components/Sidebar.tsx:682–702` | Row action menus (`.row-menu-toggle`, `⋯`) are set to `display: none` in rail mode, and `.workspace-select` has no keyboard shortcut to trigger context menus without a mouse right-click. |
| 8 | Aesthetic and Minimalist Design | 2 | `src/styles.css:1814–1821, 1852–1859`; `src/components/AgentSidebar.tsx:193–197` | Agents section toggle degrades into a solitary floating chevron (`.agent-section-caret`) with no category mark, label, or count pill. |
| 9 | Error Recovery | 2 | `src/styles.css:1730–1734, 1823–1826`; `src/components/Sidebar.tsx:747` | Rename errors and async roster connection failures fail silently in the rail because inline alerts are hidden (`display: none`). |
| 10 | Help and Documentation | 0 | `src/components/Sidebar.tsx:693`; `src/components/MachineSidebar.tsx:100–106` | Zero floating hints, contextual micro-copy, or discoverable cues. Machine monitor glyphs lack even native `title` tooltips. |
| **Total** | | **18/40** | | **Severe Usability Deficiencies** |

---

### Design Specificity Verdict

**LLM assessment:**
Orbit is architected as an operations cockpit for orchestrating AI coding agents across machines, git worktrees, and split terminals. When the sidebar is expanded, the design reflects this domain model: independent spaces and agents, git worktree trees with branch connectors, plan step indicators, and background task pills. However, upon collapsing to the $52\text{ px}$ rail (`.app.sidebar-collapsed`), the interface degenerates into a generic, undifferentiated column of monotone icons. Observability—the primary reason Orbit exists—is stripped away: running 4 sub-agents looks identical to an idle agent waiting for input, non-agent workspaces all collapse into identical `<Terminal />` icons, and worktree hierarchies are flattened into an unindented vertical list.

**Deterministic scan:**
The deterministic detector (`detect.mjs`) scanned 5 target files (`Sidebar.tsx`, `MachineSidebar.tsx`, `AgentSidebar.tsx`, `SidebarResizer.tsx`, `App.tsx`) with 0 automated rule violations (exit code 0). However, deep structural code analysis revealed 4 critical structural flaws that static lint rules do not capture:
1. `src/styles.css:1711–1735`: `clip-path: inset(50%)` preserves screen-reader accessibility for text, but accompanying `display: none` rules suppress all machine error actions, setup panels, and roster failure banners.
2. `src/styles.css:1751–1759`: `.app.sidebar-collapsed .sidebar-new` uses `font-size: 0` to hide label text instead of a consistent accessible hiding pattern.
3. `src/styles.css:1803–1812`: Worktree indents (`padding-left: 0`) and branch connectors (`display: none`) are stripped, destroying git topology.
4. `src/styles.css:1703–1708`: Extreme reliance on memory and unstyled $1000\text{ ms}$ native tooltips for recognition.

**Visual overlays:**
Live Vite development server is active on `http://localhost:5173`. Per `critique.md` instructions, browser presentation and overlay injection were skipped via fallback signal because headless browser automation (puppeteer / browser canvas) is not installed in the execution environment. Static structural evaluation was utilized.

---

### Overall Impression
Orbit's expanded sidebar is rich with terminal and agent intelligence, but minimizing it into a rail triggers an identity collapse. Rather than functioning as a high-density heads-up status rail, it reduces complex multi-workspace, multi-machine environments into an ambiguous string of identical monitor and terminal icons with abrupt layout reflows and disabled keyboard actions. The single biggest opportunity is transforming the rail from a dumb icon column into a smart glanceable status beacon with repo monograms, active plan badges, and instant floating context flyouts.

---

### What's Working
1. **Accessible Subpixel Text Clipping:**
   In `src/styles.css` (lines 1711–1722), text labels are visually hidden using `clip-path: inset(50%)`, `width: 1px`, `height: 1px`, and `position: absolute` rather than `display: none`. Screen readers (VoiceOver, NVDA) and automated end-to-end tests retain full access to workspace titles, branches, and status descriptions.
2. **Phase-Synchronized Agent Breathing Animation:**
   In `src/components/Sidebar.tsx` (`alignBreath`, lines 80–83) and `src/components/Sidebar.css` (`sidebar-breathe`, lines 526–528), running agent dots synchronize with the document clock's phase using a 6-step discrete opacity animation (`steps(6)`). Multiple concurrent agents breathe in lockstep without distracting strobe artifacts or GPU thrashing.
3. **Stable Shell Bookends:**
   The top New Workspace (`+`) and Search buttons, alongside the bottom Settings gear (`.sidebar-footer-settings`), remain anchored at the rail's extremities, preserving primary navigation muscle memory across collapse states.

---

### Priority Issues

#### [P0] Recognition Failure & Identical Marks for Workspaces and Machines
* **Why it matters:** Violates Nielsen Heuristic #6 (Recognition Rather Than Recall). In rail mode, non-agent workspaces all render identical `<Terminal />` marks (`Sidebar.tsx:360`), while connected machines render identical `<Monitor />` marks (`MachineSidebar.tsx:101`). Machine headers lack `title` attributes entirely. Workspaces rely on unstyled OS-native `title` tooltips with a $1000\text{ ms}$ delay. Users with multiple workspaces cannot identify active projects without hovering and waiting on each icon.
* **Fix:**
  1. For workspaces: Render a two-letter repository monogram/initial badge (e.g. `OR` for Orbit, `HD` for herdr) or custom project favicon inside the rail icon cell rather than a generic terminal glyph.
  2. For machines: Display distinct host vs remote SSH iconography or machine initials, and ensure machine headers expose descriptive `title` and `aria-label` attributes.
  3. Replace native OS `title` tooltips with an instant, theme-aware floating flyout popover on hover and keyboard focus.
* **Suggested command:** `/impeccable clarify`

#### [P1] Worktree Hierarchy Flattening & Broken Fold Controls in Rail
* **Why it matters:** Violates Heuristic #2 (Match System / Real World) and Heuristic #3 (User Control and Freedom). In `src/styles.css` (lines 1803–1811, 1786), worktree indents are removed (`padding-left: 0`), branch connector lines are hidden (`display: none`), fold toggles (`.workspace-toggle`) are stripped, and fold count pills (`.workspace-fold-count`, `+N`) are clipped. Linked worktrees appear as detached sibling workspaces, and previously folded checkouts become completely invisible and unreachable without expanding the entire sidebar.
* **Fix:**
  1. Maintain a visual hierarchy cue in the rail (e.g. a continuous vertical connector spine on the rail's left gutter or an indented dot indicator).
  2. Render the folded checkout count (`+N`) as a compact badge on the parent repository icon in the rail.
  3. Support expanding/collapsing worktree groups directly from the rail via click or flyout.
* **Suggested command:** `/impeccable layout`

#### [P2] Keyboard & Row Action Accessibility Lockout
* **Why it matters:** Violates Heuristic #7 (Flexibility and Efficiency of Use) and WCAG 2.1.1 (Keyboard Operability). In `src/styles.css` (lines 1786, 1868), action buttons (`.row-menu-toggle`, `⋯`) are set to `display: none`. In `Sidebar.tsx` (lines 682–702), `.workspace-select` supports `Enter`/`Space` to select and `Alt+Arrow` to reorder, but provides no keyboard binding to invoke the row menu. Keyboard-only users (particularly on macOS, which lacks a dedicated Context Menu key) cannot rename, pin, close, or create worktrees while minimized.
* **Fix:**
  1. Add a keyboard shortcut (`Mod+Enter` or `Shift+F10`) on focused workspace and agent rows to invoke `toggleMenu`.
  2. Retain `.row-menu-toggle` in the DOM on `:focus-within` rather than suppressing it with `display: none`.
* **Suggested command:** `/impeccable harden`

#### [P3] Abrupt Layout Snap on Collapse / Expand
* **Why it matters:** Toggling sidebar collapse (`⌘⇧B`) alters `--sidebar-shown-w` instantly from $264\text{ px}$ to $52\text{ px}$ (`src/styles.css:1697`). Neither `.sidebar`, `.header-side`, nor `.pane-column` has transition properties configured. The terminal canvas, chat stream, and header contextual crumbs snap $212\text{ px}$ across the screen in $0\text{ ms}$, causing visual disorientation and terminal buffer reflows.
* **Fix:**
  1. Apply a hardware-accelerated CSS transition to the sidebar container (`transition: width var(--dur-base) var(--ease-out)`).
  2. Respect `prefers-reduced-motion: reduce` by suppressing transition durations when requested.
  3. Cross-fade header icons smoothly during the collapse animation.
* **Suggested command:** `/impeccable animate`

#### [P3] Clipped Plan Steps, Background Tasks, and Silent Error States in Rail
* **Why it matters:** Violates Heuristic #1 (Visibility of System Status) and Heuristic #9 (Error Recovery). In `src/styles.css` (line 1712), `.agent-row-status` is clipped (`clip-path: inset(50%)`), hiding `PlanBadge` (step counts like `3/5`) and `BackgroundBadge` (running tool tasks). Furthermore, `.sidebar-inline-error` and `.error-state` are set to `display: none` (lines 1732, 1825), causing failed rename or connection attempts to fail silently in the rail.
* **Fix:**
  1. Render a mini-progress ring or compact fraction badge (`3/5`) in the status cell of active agent rows in the rail.
  2. Surface inline errors via floating toast badges or an error ring on the rail mark.
* **Suggested command:** `/impeccable distill`

---

### Persona Red Flags

* **Alex (Power User — Terminal & Agent Multiplexing):**
  Alex runs 8 workspaces across a local PC and remote Linux server with 3 autonomous agents. In rail mode, Alex is confronted with 2 identical monitor icons and 6 identical terminal icons. To find the `auth-service` worktree, Alex must hover sequentially over every icon, suffering a $1000\text{ ms}$ OS tooltip delay each time. When Alex attempts to close a finished workspace using keyboard navigation, the context menu button is unreachable (`display: none`). Alex abandons rail mode entirely.
* **Jordan (First-Timer — Junior Developer Exploring Orbit):**
  Jordan clicks the header toggle button (`PanelLeft`). The sidebar instantly snaps shut with no transition. In the middle of the rail, Jordan sees an isolated, unlabelled chevron caret (`.agent-section-caret`) floating on its own. Jordan clicks it, but nothing visibly happens because the Agents header text and count badge are clipped out. Jordan hovers over the top monitor icon expecting a label, but no tooltip appears. Jordan assumes the rail is broken.
* **Sam (Accessibility — Screen Reader & Keyboard Only):**
  Sam navigates Orbit using macOS VoiceOver. While `clip-path: inset(50%)` successfully preserves row names on `.workspace-select`, Sam discovers that all action buttons (`.row-menu-toggle`), worktree fold controls (`.workspace-toggle`), and machine management buttons are stripped from the accessibility tree via `display: none`. Sam cannot manage workspaces or inspect machine states without using mouse coordinates.

---

### Minor Observations
1. **Isolated Agent Section Caret:** In `src/styles.css` (lines 1852–1858), `.agent-section-toggle` centers `.agent-section-caret` and hides the `"Agents"` text and count badge, leaving a bare caret floating without an identifying glyph (such as a Bot or Sparkle mark).
2. **Pinned Group Boundary Loss:** In `src/styles.css` (lines 1814–1821), `.sidebar-pinned` removes borders (`border: 0`) and hides `.sidebar-pinned-label` (`display: none`), causing pinned workspaces to blend indistinguishably into regular workspaces.
3. **Silent Operation Failures:** In `src/styles.css` (lines 1824–1826), `.sidebar-inline-error` is hidden (`display: none`), suppressing error feedback during failed operations.
4. **Header Search Relocation Disconnect:** In `src/styles.css` (lines 1742, 1761–1766), the header palette button is hidden on collapse and replaced by `.sidebar-search` inside the rail, shifting search trigger placement between states.
5. **Touch Target Deficit in Compact Density:** In compact mode (`--control-h: 32px`), the rail row height drops below the $44\text{ px}$ touch target recommendation (`--touch-target: 44px`).

---

### Questions to Consider
1. *Why rely on delayed, unstyled native browser tooltips in a real-time developer operations console instead of an instant, rich floating hover flyout?*
2. *Why should six distinct code repositories share an identical `<Terminal />` icon instead of automatic two-letter project monograms or repository root initials?*
3. *Should linked git worktrees remain in the rail's vertical flow when folded, or should they be accessed through a flyout drawer anchored to their parent checkout?*
4. *Could the rail provide an active agent glanceable HUD—showing mini progress rings for plans and active background tool counts—without expanding the full sidebar?*
