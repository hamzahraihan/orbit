### Fixed
- Terminal file links and chat paths now recognize Windows drive letters, backslashes, and compiler
  line/column patterns `(line,col)`.
- Files dropped into the terminal on Windows are quoted with double quotes for PowerShell and
  cmd.exe compatibility.
- Added Cascadia Code and Cascadia Mono to monospace font stacks.
- Added `-NoLogo` to Windows process table queries and improved fallback resolution for herdr
  socket paths when APPDATA is unset.
