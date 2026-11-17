### Fixed
- The composer draws one dim `--fs-2xs` word (`RUN`, `INPUT` or `BACKGROUND`, the same word assistive
  tech reads) for a working, blocked or background-waiting agent, so a glance can tell those apart
  from rest instead of reading them off the ArrowUp/Square glyph alone. `READY` and `DONE` stay
  read, not drawn.
- Escape in the message box is Stop only while the box is empty, matching Stop's own rule (a draft
  puts Send in Stop's place); with a draft up Escape does nothing in the field.
- The mic on `voiceInput: "auto"` is drawn on phones on every voice path: where dictation can work
  it works as on a desktop, and where it cannot it is drawn disabled with its reason instead of
  leaving the phone with no hint that dictation exists.
- The scheduled prompt's cancel control and the Send later picker's moments, clock field and
  Schedule button reach the `--touch-target` hit area under a coarse pointer, as the rest of the
  composer's controls do.
- A warning notice over the composer (another app holds the pane, the output stream failed) and the
  terminal lens's warning banner draw in the `--notice` colour instead of the working-blue
  `--status-working`.
