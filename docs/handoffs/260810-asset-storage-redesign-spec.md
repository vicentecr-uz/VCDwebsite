# Spec — asset storage redesign (#211)

**Done when:** every image lives in one directory (`media/`), content JSON holds one plain decoded filename per ref, the `draft:` prefix is gone from the codebase, the production build copies **only** the images the built site actually references, and the build **fails loudly** if any referenced image is missing.

**Worker:** Sonnet. Not Haiku — several failure modes here are silent no-ops.

**Branch:** `feat/211-derived-asset-publication` off latest `main` (which now includes #202, merge `15d9cc5`).

**Issue:** https://github.com/vcruzdesigns/VCDwebsite/issues/211

---

## Why this exists (read, don't skip)

Today publication state is encoded in **file location**: draft assets live in `src/content/drafts/media/` with a `draft:` prefix in JSON, published ones in `public/images/` with a bare filename. Publishing a project physically moves files and rewrites refs across every document. That transition is implemented in one direction only, which is why demotion doesn't exist, why re-publishing produced a `-2` duplicate, and why 108 orphaned images currently ship to production forever.

The fix is to stop storing publication and start **deriving** it.

---

## Architecture — collect from the build output, not from document status

The handoff sketch said "walk published + teaser documents and collect their refs." **Do not implement that.** It is subtly wrong and fails open. Implement this instead:

> After Astro emits `dist/`, scan the **emitted output** for `/images/…` references. Copy exactly those files from `media/` into `dist/images/`. Fail the build on any reference with no matching file.

Why this is strictly better:

- **Status logic disappears.** A draft project emits no page, so its images are never referenced, so they never ship. Same for teaser section content. `shouldIncludeProjectInBuild` (`src/lib/projects.ts:120`) already decided what renders — reuse that decision instead of re-deriving it.
- **It closes a leak the status-walk would open.** Teaser projects have **no route** in production (#192) but **do** render a gallery card. A naive "published + teaser → all refs" collector would copy a teaser's entire unreleased case-study imagery into `dist/`, publicly fetchable. Scanning output cannot make that mistake: only the card cover appears in emitted HTML.
- **Code-referenced images are handled for free.** `black-token.svg`, `placeholder.svg`, `reddit/avatar_default_*.png`, `press-logos/*` are referenced from `.astro` files, not JSON. A JSON walk misses them; an output scan does not.
- **It is self-verifying.** The thing that ships is the thing that was checked.

---

## Landmines

1. **URL-encoded refs are live in content today.** `src/content/about.json` holds `"/images/1Q1A6418%20(Custom).jpg"`; the file on disk is `1Q1A6418 (Custom).jpg`. Five content files contain `%20` refs (`about.json`, `settings/header.json`, `parentpal.json`, `conic-collection.json`, `the-rams.json`). **Every path comparison must `decodeURIComponent` both sides.** Get this wrong and Anto's own portrait 404s on the live site — it will look like the collector "worked" because the build succeeds.
2. **Not every ref is a local file.** `the-rams.json` contains a YouTube embed URL in a `src` field. Skip anything starting with `http://`, `https://`, or `//`.
3. **`public/images/` has subdirectories** — `press-logos/`, `reddit/`, `tapico-research-paper/`, `whatisbudgeting/`. Preserve that structure inside `media/`. Do not flatten. (#202 flattened *draft* media only.)
4. **Bun is not on `PATH`** — use `$HOME/.bun/bin/bun`.
5. **Do not start a dev server.** One already owns port 4321. You cannot verify in-browser; Anto does that after merge.
6. **This is a schema migration**, so content JSON and engine code commit **together** — the documented exception in `CLAUDE.md`. Use `bun run commit:engine` with explicit paths and say so in the message.
7. `astro.config.mjs:2060` excludes `**/public/images/**` from the watcher. Update to `**/media/**`.

---

## Work

### 1. Create the store and migrate files

- `media/` at repo root.
- Move every file from `public/images/**` → `media/**`, preserving subdirectories.
- Move every file from `src/content/drafts/media/*` → `media/`.
- Delete `public/images/` and `src/content/drafts/` entirely.
- **Move all 282 files, including the ~108 currently unreferenced.** Nothing is deleted — orphans simply stop shipping, because nothing points at them. Anto reviews deletions separately; that is not this change.
- On a filename collision between the two sources, keep both: suffix the incoming one (`name-2.jpg`) and rewrite the refs that pointed at it. Report any collisions in your summary.

### 2. Normalize every content ref to one form

Rewrite all JSON under `src/content/`:

| Before | After |
| --- | --- |
| `draft:hero.jpg` | `hero.jpg` |
| `/draft-media/hero.jpg` | `hero.jpg` |
| `/images/press-logos/yanko.png` | `press-logos/yanko.png` |
| `/images/1Q1A6418%20(Custom).jpg` | `1Q1A6418 (Custom).jpg` |
| `https://youtube.com/…` | unchanged |

**Decoded, relative to `media/`, no prefix, no leading slash.** Fields: `src`, `image`, `hoverImage`, `coverImage`, `avatarSrc`, `logoSrc`, `poster`, and `photo.src`. Walk recursively — do not assume depth.

Write a one-shot migration script at `scripts/migrate-asset-refs.mjs` (mirroring `scripts/migrate-crop-rects.mjs`) and commit it. It must be idempotent.

Also update the two hardcoded code defaults `/images/black-token.svg` → `black-token.svg` (`src/lib/projects.ts:213,221`, `src/components/DevGalleryPages.astro:472`).

### 3. Resolution — one function, one form

`src/lib/images.ts`: `projectImage(filename)` returns `/images/${encoded parts}` for every ref. Delete `draftProjectImageSrc` and `isDraftImageSrc` and every call site.

**Public URLs stay `/images/…`.** Only the on-disk source moves. Nothing about the rendered site changes.

`scripts/dev-assets.mjs`: `normalizeAssetSrc` collapses all legacy forms to a bare decoded filename (keep the legacy input branches — old JSON may still arrive from a stale client). `assetUrlFromSrc` always returns `/images/…`. `resolveAssetFilePath` always resolves into `media/`. Keep the `..` guards. Drop `DRAFT_PREFIX`.

### 4. Dev serving

`scripts/dev-api-plugins.mjs`: rename `draftMediaDevServer` → `mediaDevServer`, mount on `/images` instead of `/draft-media`, read from `media/`. Keep the `..` guard and the content-type map; add `image/svg+xml` and `image/avif` (currently missing — an SVG is served as `image/jpeg` today).

Uploads write to `media/`. `uniqueUploadFilename` keeps working, now against one directory — which is what makes site-wide uniqueness real rather than per-directory.

### 5. Delete promotion

- Delete `publishDraftMediaForProject` (`scripts/dev-api-plugins.mjs:432-528`) — the promotion walk, the cross-document rewrite, and the source `rm`.
- Delete its call site at `dev-api-plugins.mjs:766` and the `PUBLIC_STATUSES` set at line 17 if nothing else reads it (**check** — do not assume).
- Saving a project as Public must now touch **no files at all**. That is the point.
- Drop the "Published N image(s) to public/images." save-bar status (`src/components/DevTextEditor.astro:2632`) — there is nothing to report. Do not invent a replacement message.

### 6. Build-time collect (the new part)

Astro integration in `astro.config.mjs`, hook `astro:build:done`:

```
collectShippedAssets(distDir):
  refs = {}
  for file in dist/**/*.{html,css,js}:
    for match of /\/images\/[^"'`)\s>]+/g over contents:
      token = decodeURIComponent(match without "/images/")
      if token is empty or contains ".." : continue
      refs.add(token)

  missing = []
  for token in refs:
    source = media/<token>
    if not exists(source): missing.push(token); continue
    copy source -> dist/images/<token>   (mkdir -p)

  if missing.length:
    throw  // fail the build, listing every missing token

  log: "assets: copied N of M files in media/ (K unreferenced, not shipped)"
```

- **Throw on missing.** A silent skip turns a content mistake into a production 404 nobody notices. A failed build is the cheap failure.
- Scan `.css` and `.js` as well as `.html` — CSS `url()` and any inlined script reference must count.
- The regex must not swallow a trailing `"` or `)`. Test against `srcset`-style comma lists and `url(...)`.

### 7. Tests

Add `scripts/test-assets.mjs`, wired as `bun run test:assets`, in the style of `test:publish` (throwaway fixture dirs, no network, no dev server). Cover:

1. A ref with `%20` in JSON resolves to the space-named file on disk and is copied.
2. A **draft** project's section image is **not** copied.
3. A **teaser** project's card cover **is** copied and its section image is **not**.
4. An orphan in `media/` is not copied.
5. A ref with no file in `media/` **fails the build**.
6. A subdirectory ref (`press-logos/x.png`) lands at `dist/images/press-logos/x.png`.
7. An `http(s)` ref is ignored, not treated as a filename.

### 8. Publish surface

`scripts/dev-publish.mjs:17` — `CONTENT_PATHS` becomes `['src/content', 'media']`. Check `RENDERING_PATHS` in the same file: the new build integration is rendering code, so if it lands in its own script file, add that path.

Run `bun run test:publish` after touching this file. Non-negotiable — the off-branch path writes commits to `main` via plumbing.

---

## Out of scope

- Deleting the 108 orphans. They move to `media/` and stop shipping. Anto decides deletion separately.
- Any Asset Manager UI work — that is #204, parked.
- Demotion. There is nothing left to demote; do not add a code path for it.
- Video assets (`public/videos/`) — #203 territory, leave alone.
- General backend rewrite. Save bar, dev API and publish plumbing stay as they are.

---

## Verify

Do **not** open a browser. Do run:

```
$HOME/.bun/bin/bun run test:assets
$HOME/.bun/bin/bun run test:publish
$HOME/.bun/bin/bun run build
```

The build must succeed and `dist/images/` must contain ~174 files, not 282. State the actual numbers in your summary. Confirm `dist/images/` contains **no** file that only `test-card.json` (a draft) references.

Then stop and report. A green build is not proof the feature is right — Anto tests it.

## Pickup

Read this file, summarize it back, implement exactly. Do not replan the architecture; the output-scan approach is decided and the reasons are above.
