### Fixed
- The pinned card's caption in the sidebar (**PINNED** above the pinned workspace and agent rows)
  drew its pin icon above the word on a second line; the pin and **PINNED** now sit on one line.
- Keyboard focus on an agent row drew no visible ring (its button is `display: contents`, so the
  ring had no box to draw on); the ring now lands on the row itself, as workspace rows draw theirs.
