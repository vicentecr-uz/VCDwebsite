# 0006. Asset pipeline

Status: Accepted (2026-11-22, recorded from code comments)

## Context

`media/` holds every image, including drafts and unreleased case studies. Only what the public site references may ship.

## Decision

**Publication is derived from build output, not document status.** `collect-shipped-assets.mjs` runs after `astro build` and copies only files referenced from `dist/`. A draft emits no page, so its images are never referenced; a teaser has no `/slug` route in production but its gallery card renders, so only its cover ships. Files referenced from `.astro` rather than JSON (placeholders, press logos, Reddit avatars) are covered for free. A "walk published and teaser documents" collector was rejected because it can make the mistake this cannot. A reference with no file in `media/` fails the build, because a silent skip would become an unnoticed production 404.

**The reference pattern** (`REF_PATTERN`) allows `(` and `)` in filenames (they occur, and `encodeURIComponent` leaves them alone); real references are quote-delimited, so quotes, backticks, whitespace and angle brackets terminate a token, and `srcset` still splits on its spaces. It stops at `&` because Astro escapes a quote inside an attribute as `&#34;`, and at `$` because `projectImage()` ships as client source containing a literal `` `/images/${…}` ``. A leading `(?<![A-Za-z0-9])` keeps third-party URLs that merely contain `/images/` from being read as local refs.

**Uploads.** A name collision whose bytes match reuses the existing file instead of allocating `-2`; drop-undo-drop is ordinary authoring and once accumulated 121 MB of duplicates (`uniqueUploadFilename`). Draft media is site-wide; unreferenced files surface as Unassigned in the asset manager.

**Derivatives.** Previews resize with `fit: inside` on the long edge, matching Immich's `size`, because width-only oversizes portraits. Video posters decode only the first frame with the bundled FFmpeg so builds do not depend on a host executable.

**Crop model.** Crops are stored as `{ aspect, cx, cy, w }` anchored to the source image (centre point in natural 0–1 units, fraction of source width spanned), not as the legacy `{ x, y, zoom }` that meant different slices at different frame sizes. The conversion is closed-form (`w = min(1, A_f / A_src) / zoom`, `h = w · A_src / A_f`, `cx = 0.5 − (x/100)·w`, `cy = 0.5 − (y/100)·h`). Values are rounded to 6 dp: 4 dp shifts a 500 px frame by about 0.1 px. Natural dimensions honour EXIF orientations 5–8 (sharp reports stored dimensions; browsers rotate), which phone photos hit constantly. `srcWidth`/`srcHeight` are stamped on image nodes so frames can be sized server-side; with them, `aspect: "original"` resolves to a literal ratio in the first paint instead of waiting for the bitmap. Content never positioned defaults to the largest `w` that still covers the frame (the old cover-fit behaviour). Width is authored: an inherited unlocked `w` survives a frame change rather than being clamped into a new local cover-fit value.

**Demo catalog.** In dev, `/preview/image-framing` reads the last production build's publication boundary; rebuild to refresh it.

## Where

`scripts/collect-shipped-assets.mjs` → `REF_PATTERN`; `scripts/dev-api-plugins.mjs` → `uniqueUploadFilename`; `scripts/image-derivatives.mjs` → `generatePosterBuffer`; `scripts/migrate-crop-rects.mjs`; `src/lib/responsiveImage.ts` → `coverWidthFraction`, `normalizeImageVariants`, `responsiveImageStyle`; `src/pages/preview/image-framing.astro`
