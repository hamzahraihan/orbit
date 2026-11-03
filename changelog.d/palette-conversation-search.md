### Added
- The command palette (Mod+Shift+K) now searches the text of every chat on every connected PC,
  not just pane titles and actions: type a word or phrase and its **Messages** section shows the
  matching turns, newest first, with the words picked out and the pane they came from. Picking one
  opens that pane in its chat. The newest page of each chat answers as you type; once typing rests,
  the search walks back through older pages, up to twenty per chat, so a turn from days ago still
  turns up. A PC that cannot answer is skipped rather than failing the whole search.
- Mod+Shift+M opens the palette straight into conversation search, leaving the panes and
  actions out. The searches you picked a result from (or pressed Return on) are remembered in
  this browser and offered while the box is empty, newest first. A remembered search can be
  dropped with its × button (or Delete with the row picked), and Clear under the heading empties
  the whole list.

### Changed
- A conversation search that walks back through older pages now resolves each chat's transcript
  once and reuses that reader, the transcript stream it holds, and the turn starts it scanned, for
  the whole walk instead of resolving and scanning the same chat again for every page. Walking a
  long transcript back therefore costs less disk and CPU.
