### Changed
- A sidebar row's hover card now opens at the row's right edge, level with the row, on desktop
  and in the collapsed rail alike, instead of covering the row it describes.
- A fine-pointer desktop shows a row's ⋯ menu button on hover, on focus, or on the selected row,
  instead of hiding it entirely; it was reachable only by right-click before.
- The collapsed rail's selected row uses the chosen-row tint with an inset accent ring instead of
  a filled accent square, keeping rose for the live edge.

### Fixed
- The phone drawer toggle draws a dot when an agent is blocked and names how many agents need
  input in its label, so a closed drawer no longer silences a waiting agent.
- Sidebar icon buttons that were 18px now offer at least 24px hit areas on fine pointers and 44px
  on coarse pointers (WCAG 2.5.8).
- Sidebar rows no longer carry a native tooltip that duplicated or contradicted the hover card;
  the card says the whole detail (pane id, full branch, every path, tokens), and a row points at
  it with aria-describedby while it is open. The card opens on a short hover dwell, so sweeping
  the mouse down the list no longer strobes cards.
