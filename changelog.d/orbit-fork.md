### Removed
- The anonymous usage counts are removed: Orbit sends nothing to its maintainer.
- The app update checks are removed: Orbit is updated by reinstalling the herdr plugin, or by
  pulling this repository and rebuilding.
- The subscription usage meters are removed: Orbit reads no provider account.
- The Portal relay is removed: Orbit is reached directly, over Tailscale, a LAN address or an SSH
  tunnel.

### Changed
- The app is named Orbit everywhere it names itself: the page title and header, the sign-in
  screen, the installed app's name and icon label, Settings → About, the terminal's error prefix,
  and every message that says to restart it.
- The app icon, favicon, notification badge and site mark are a new Orbit ring with a satellite;
  the upstream ram artwork is no longer shipped.
- The installer one-liners, README, guide and site point at this repository instead of the upstream
  website, and the About dialog drops that site link; until the first release tag, the one-line
  installer installs `main`.
- The remote-PC runtime bundle is fetched from this repository instead of the upstream project's
  releases.
- The plugin id is `hamzahraihan.orbit` and the package is `orbit`.
