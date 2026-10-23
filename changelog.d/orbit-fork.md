### Removed
- The anonymous usage counts are removed: Orbit sends nothing to its maintainer.
- The app update checks are removed: Orbit is updated by reinstalling the herdr plugin, or by
  pulling this repository and rebuilding.
- The subscription usage meters are removed: Orbit reads no provider account.
- The Portal relay is removed: Orbit is reached directly, over Tailscale, a LAN address or an SSH
  tunnel.

### Changed
- The remote-PC runtime bundle is fetched from this repository instead of the upstream project's
  releases.
- The plugin id is `hamzahraihan.orbit` and the package is `orbit`.
