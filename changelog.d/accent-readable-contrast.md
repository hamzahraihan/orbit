### Fixed
- The rose accent keeps its voice only as a fill. Anything drawn as type, a glyph or a focus ring
  now reads the readable accent, and `--accent-readable` mixes the accent 40% toward
  `--text-strong` (was 55% toward `--text`, which measured 3.2–4.7:1 and failed AA on eleven
  palette/surface pairs), so every theme clears 4.5:1 on every surface; solarized, tokyo-night-day
  and kanagawa-lotus pin the token to `--text-strong`, whose own worst surface only clears by a
  hair. Markdown links, the phone panel's links, marked-line numbers, directory and skill glyphs,
  the chosen pane frame, the armed key, the rename field, the current search hit, the drop-target
  outline, the drag insertion lines, the active pane-slot bar, the resizer handles and HeroUI's
  focus and chosen-field borders all read it. Buttons and glyphs filled with the accent now take
  `--primary-text` (the voice mic and mic-done, the send arrow, the Markdown task checkbox, the
  gate's submit, the comment send) instead of `--bg`. The legacy theme parity baseline is re-frozen
  in its own commit: the frozen resolved `--ring` color-mix moves (55% to 40%) and
  `--accent-readable` and `--group-edge` join the frozen set. A contrast test holds
  `--accent-readable` to 4.5:1 on every surface of every theme.
