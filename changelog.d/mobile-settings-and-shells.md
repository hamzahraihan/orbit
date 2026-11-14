### Added
- A phone's tab strip now names its workspace and pane above the tabs (the PC too when more than
  one is connected).
- A shell pane's Chat view says where its commands run, and its composer is a command line
  (**Run a command…**) instead of an agent greeting.
- A connected PC with no agents offers **New workspace** in its empty Agents section, and a
  phone's header More menu carries **Settings** as a second door to the workspace drawer's own.

### Changed
- Settings → Appearance groups its theme, layout and language controls under captions; the dark
  and light theme picks put their swatch and search on one line, and their select on the next.
- The Chat/Terminal lens keeps its words at 320px and draws the chosen one as a rose plate; the tab
  strip's `+` is now a terminal glyph with a small plus, distinct from the workspace `FolderPlus`.
- The header's More menu drops **Search panes and actions** at desktop widths where the palette
  button stands beside it. Below 481px, where that button is hidden, the item remains.
- The first-run welcome traps focus on **Got it**, closes with Escape, and steps aside while
  Settings or New workspace is open; a Settings/create deep link no longer opens it first.

### Fixed
- On light themes, group borders, focus rings, Markdown and file links, a selected chip's word and
  the chosen lens's glyph clear 3:1 or 4.5:1 against their surfaces. The rose accent stays a fill.
- A shell's Chat view no longer says "Message Shell…" or asks a phone keyboard to autocorrect and
  capitalize the command it types.
