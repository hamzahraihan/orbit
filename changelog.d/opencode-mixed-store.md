### Fixed
- An OpenCode pane that writes to the 1.x tables (`session`/`message`/`part`) of a store that also holds
  OpenCode 2's `session_v2` — what an OpenCode downgrade leaves behind — reads as a conversation again.
  Orbit read only the 2.x side, found no such session and fell back to the terminal, so the model's text
  never appeared; the reader now reads whichever table set the session's writes touched last.
