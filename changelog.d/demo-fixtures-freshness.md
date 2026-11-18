### Fixed
- The browser demo's fixtures are now checked against the app that reads them. The client in
  `_site/demo/` has always been rebuilt on every site build, but `site/demo/fixtures/*.json` were
  captured by hand from a staged herdr and nothing ever rebuilt them, so the demo drifted a long way
  from the real app without saying so: its `panes.json` named worktree panes its own `machines.json`
  did not hold, and four of the seven panes in the demo's sidebar were synthesized from a stale
  capture. `bun run demo:check` fails on a fixture that no longer fits the protocol the app reads, on
  a roster the two files disagree about, on an agent or command row missing the field the app reads,
  and on a fixture that names the PC it was captured on. It runs in the unit suite as a
  `conventions.test.ts` case, so a stale fixture is caught by the change that staled it rather than at
  the next deploy.
### Maintenance
- Recapturing the demo fixtures is `bun run demo:fixtures`, documented with the recapture rule in
  `docs/development.md`. It needs POSIX: the staged session lives under `/tmp/herdr-demo` and herdr's
  `worktree.create` refuses a relative path on Windows.