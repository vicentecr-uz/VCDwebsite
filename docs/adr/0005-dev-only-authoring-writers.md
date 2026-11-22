# 0005. Dev-only authoring writers

Status: Accepted (2026-11-22, recorded from code comments)

## Context

In-page Edit writes content JSON from the browser. The live site is static and must expose no write surface.

## Decision

**Writers exist only under `astro dev`.** Each writer is a Vite plugin with `apply: 'serve'`: it is never part of the production build, emits nothing to `dist/`, and the live site has no such route. The client posts a document key, a JSON path and the change; the writer validates and persists it, and committing the file publishes it. Authoring components are stripped before Astro discovers their scripts and styles (`authoringComponents` in `scripts/production-boundary.mjs`; new writers are added there), a stray `debugRecord` call compiles to a no-op, and `check-production-output` fails on any emitted authoring endpoint.

**Content-shape rules the writers enforce.**

- Carousel settings write block-level fields only; desktop values sit on top-level fields and tablet/mobile overrides in `breakpoints`. Item order is stored as a desktop `visible` list so items stay put and crop paths remain stable. The block-wide width cap is written only when a change carries it, so ordinary saves do not stamp a redundant all-100 object.
- Section insert is allowlisted (construction needs a known shape); delete is default-on for any section at a valid index.
- Media removal works by capability, not type: a multi-item block (`items[]`) drops the matching item and refuses to drop the last; a single-`src` block drops the whole section. New media shapes inherit this.
- Listing saves merge: a one-grid save must not wipe Home/Play siblings, and a settings save must not resurrect a card hidden in the same save (cards are added only through gallery membership, which saves first). Play links share Play's sort key, so project appends go above them.
- A hover cover is a second image slot; removing its asset clears the slot rather than defaulting it, since empty is valid.
- `styles` starts from a generated catalog, so an authored empty outline is marked `outlineConfigured`.
- Storage holds bare asset tokens; responses resolve them to ready-to-use URLs for live preview, and writers normalise incoming URLs back to tokens rather than trusting the client.

**Editor model.**

- The project outline is a flat list of markers: a `group` (Intro, Research, …) and a `section` inside one. A section owns the page from its start anchor to the next section or group marker, so several page blocks can share one marker. New markers are inserted at their block's page position, never pushed to the end, which left new titles last in the sidebar and let re-added markers inherit the wrong group.
- Captions, caption reveals and other per-breakpoint values cascade down when written: desktop writes tablet and mobile, tablet writes mobile, mobile writes only itself.
- The first block on a page defaults to flush spacing; an explicit `section` there means 8em at the page top.
- Video page height caps are content (`src/content/settings/video-page.json`), saved from the video panel so the Save bar publishes them; `videoPageMaxHeight.ts` supplies defaults until that file exists.
- Image-frame fills are opaque RGB; an alpha of `00` is the canonical "no fill".
- Unregistered text controls keep native undo; authored page text uses the page history stack.
- Placeholder labels are measured with a non-editable probe, because focusing a contenteditable node inflates `scrollWidth` and made the label jump smaller.

**Public output.** A public project page always ships at its URL; one navigation does not reach is kept but not traversed, so it never publishes what it links to, and it is marked `noindex`.

## Where

`astro.config.mjs` → `imageCropDevWriter`, `applyCarouselChange`, `contentSectionDevWriter`, `contentNavDevWriter`; `scripts/dev-api-plugins.mjs` → listing and gallery-membership writers; `scripts/dev-assets.mjs` → `removeMediaItemFromDocument`, `stripAssetRefsFromDocument`; `scripts/production-boundary.mjs`; `scripts/public-site-output.mjs`; `scripts/dev-publish.mjs` → `publishDevWriter`; `src/lib/projectOutline.ts` → `insertOutlineEntriesAtPagePosition`; `src/lib/imageCaptions.ts`; `src/lib/projectStack.ts` → `resolveStackSpacingForIndex`; `src/lib/imageBackground.mjs`; `src/lib/devHistory.ts`; `src/lib/placeholderLabel.ts`
