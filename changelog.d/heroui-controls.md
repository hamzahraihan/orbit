### Changed
- Buttons, text fields, switches, segmented controls and steppers now use HeroUI's own
  components, so they match the reference look: a rounded pill button, a 40x20 switch track with
  a wide thumb, attached segments and a compact stepper, drawn in Orbit's palette.
- Dialog and popover surfaces follow HeroUI's geometry: 24px overlay radius and 36px menu rows.

### Fixed
- The Settings switch draws its knob inside its track again: the thumb was a sibling of the track, so it
  landed beside it and collapsed to nothing, leaving a bare pill. The off track also takes the border's
  strong step, so a switch that is off no longer vanishes into the card.
- A chosen segment in Settings reads again: `--bg-hover` and `--bg-input` are solid steps instead
  of translucent veils, which had made the pressed option vanish into its track.
- Function names in code previews use the readable rose (`--accent-text`) and clear 4.5:1 on both
  the panel and a chat code block.
- The HeroUI token bridge declared `--accent: var(--accent)` and `--border: var(--border)`,
  self-references that resolve to nothing, so borders and accents silently dropped out of the
  app. The bridge now only maps HeroUI's own names onto Orbit's tokens.