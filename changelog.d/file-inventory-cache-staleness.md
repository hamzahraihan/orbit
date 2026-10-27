### Fixed
- The file picker and `@file` completion no longer serve stale results for up to 5 seconds after
  agent writes: the inventory cache TTL is shortened to 1 second, re-probes on cache miss,
  refreshes when opening a file mention, and invalidates on pane directory changes and message
  submissions.
