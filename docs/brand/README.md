# Project artwork

`icon-source.svg` is the Orbit mark: an ink ring with an amber satellite on a light square.
`icon-source.png` is its 1280 px export and the input to the generators below; keep the two in
step when the mark changes.

Run `bun scripts/generate-brand.ts` to regenerate the app icons, favicon, Apple touch icon,
notification badge and social preview. This optional asset task requires FFmpeg with the
`drawtext` filter and a TrueType font (DejaVu Sans on Linux, Arial on Windows, or `BRAND_FONT`);
neither is needed to run the app. Maskable icons include extra padding for rounded and circular
masks.

`bun scripts/film/site-assets.ts` derives the site's mask marks from the same PNG. After either
script runs, follow the error in `src/conventions.test.ts`: every icon URL gets a new `?v=`
query, `public/sw.js` a new `CACHE_NAME`, and the pair an entry in `ICON_VERSIONS`.

The [social preview](../../public/social-preview.png) is 1280 × 640 PNG,
under 1 MB. The website uses `public/social-preview.png` for its Open Graph image.
The retained banner `docs/media/banner.png` and alternate preview `site/assets/og.png` are a
simple Orbit card for now; `bun scripts/readme-media/banner.ts banner og` rebuilds the richer
hero from `_film/footage/stills` once that capture exists. GitHub's repository preview is a
separate setting: open [repository settings](https://github.com/hamzahraihan/orbit/settings),
then **Social preview → Edit → Upload an image** and select that file.
See [GitHub's instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).
