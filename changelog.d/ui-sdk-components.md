### Changed
- Buttons, fields, switches, checkboxes, selects and steppers are drawn by ui-sdk parts wrapped in
  `src/lib/ui.tsx` instead of HeroUI; the skin lives in `src/ui.css` on Orbit's tokens and
  `@ui-sdk/core/web.css` loads inside `@layer ui-sdk`. ui-sdk owns anatomy, sizing, states and
  focus; Orbit keeps its chrome primitives (`icon-button`, `segmented`, `orbit-menu`, `modal`).
  The element defaults Tailwind's preflight supplied now live in `src/reset.css`, ordered below the
  ui-sdk layer by `src/layers.css`.

### Fixed
- The composer no longer shows a second, native file picker beside Attach: the element reset in
  `src/reset.css` restores `hidden` over an author `display`, as the preflight did.
- The Agents roster keeps the sidebar's indent, and its name, place and plugin token lines end in an
  ellipsis rather than a hard cut.
- Chat work rows stay on the prose edge instead of centring their caret and words, and change,
  directory, menu, settings-tab and agent-picker rows keep their leading edge.
- Steppers step again with their − and + buttons: only the text field is read-only, not the
  control that also disabled the buttons.

### Removed
- HeroUI and Tailwind are gone from the app: `src/lib/heroui/` and `src/tailwind-orbit.css` are
  deleted, `@heroui/react`, `@heroui/styles`, `@tailwindcss/vite` and `tailwindcss` are dropped,
  and the token bridge that pointed HeroUI's variables at Orbit's tokens is no longer needed.
