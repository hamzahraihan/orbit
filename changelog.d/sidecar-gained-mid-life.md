### Fixed
- A server whose PC gains Node or node-pty now uses terminal attach without a restart: a
  missing PTY sidecar is looked for again instead of being ruled out for the process's life.
