### Fixed
- The composer's Attach and Send later pills and the mic button now answer taps anywhere on a
  44px-high area, the documented touch minimum for controls; the visible pill is still the
  compact height. The dictation pill's Cancel and Done buttons reach the same floor.
- On a card 420px wide or narrower that also holds the mic or the plan chip, Send later keeps
  only its clock glyph, so a 320px phone draws all its actions without an overlap; its picker
  opens full width above the card, as the completion menu does, instead of running off the
  edge of the card.
- A pane whose conversation names a model but keeps no context ring keeps its agent mark when
  the model label steps out on a 320px phone, instead of leaving the row with no mark and no
  name.
- The context ring and Compact context press controls reach the 24px pointer-target floor.
