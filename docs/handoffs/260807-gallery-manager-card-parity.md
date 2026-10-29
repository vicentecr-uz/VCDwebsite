# Gallery Manager: cards added mid-session must be real cards

**Issue:** [#167](https://github.com/vcruzdesigns/VCDwebsite/issues/167) — `bug` / `gallery pages` / milestone `v2`
**Branch:** `fix/gallery-manager-card-parity` off latest `main` (confirm parent; after #171 merge that tip includes play-card parity)
**Worker:** Composer 2.5 Fast in a worktree (Cursor default). **Not Haiku** — the central decision is *how not to duplicate markup*; the naive fix is the bug.

**Sequencing:** land **after** `feat/play-card-parity` (#171) — merged. This branch mirrors `ProjectGrid.astro`'s current project-card markup.

**Updated:** 2026-08-07 against `main` after PR #190. Line anchors in older drafts are stale — re-locate by symbol.

---

## Done when

Turning a project **on** in the Gallery Manager adds a card indistinguishable from a server-rendered one: cover drop + crop wiring, all three chip rails (status / hover+span+crop / settings `⋮`), drop veils, placeholders, subtitle host even when year/meta is empty, title ink via CSS vars, hover `<img>` host, `variants` seeded so crop works — with no reload.

And: the drift mechanism is gone — next chip added to `ProjectGrid.astro` lands in the template for free.

---

## The bug (still true)

`buildGridCard()` in `DevGalleryPages.astro` hand-builds a stripped card. It has drifted further since #180/#186/#171. Current gaps include (re-grep; do not trust this as exhaustive):

- No `dev-image-edit-target` / `imageDevEditAttrs` / `data-dev-cover-drop` / `data-dev-listing-cover`
- No chip rails (start / end / end-bottom) — still has a legacy `project-grid__settings` button
- No drop veils; hover img only if `hoverImage` already set
- Inline `style.color` on title/subtitle instead of `--title-ink` / `--subtitle-ink` / hover vars on `.project-grid__meta`
- Subtitle only if `page.subtitle` (empty year → no field)
- Status text badge instead of visibility chip + menu
- `full` still gated with `activeGrid !== 'play'` (wrong after #171)

Workaround today: Save, reload.

---

## Design call — settled

**Do not extend `buildGridCard()` imperatively.** Clone a `<template>` from `ProjectGrid.astro`.

1. When `isDev`, render **one** `<template data-dev-grid-card-template>` inside the `<ul>` (beside `--new`), containing a single project-shaped `<li>` from the **same** markup as the loop — extract a local Astro fragment/function so template and loop cannot diverge. Seed: empty title, empty subtitle, placeholder cover, `status: 'draft'`, `projectEditable` paths.
2. `buildGridCard(page)` → clone template content, then **fill**: slug, imgs, title/subtitle text, CSS ink vars (not inline color), status chip, `--full`, teaser branch (home/work only for teaser-label — play uses Meta only per #171), `data-dev-*` attrs, `imageDevEditAttrs` values.
3. Structural chrome comes from the clone only.

**Template = project cards only.** Gallery Manager does not create play-links.

**Fill helpers:** use `imageDevEditAttrs` from `src/lib/projectImageFrame.ts` — export a small JS-callable helper if needed so Astro and client set the same attributes. Do not re-serialise by guess.

**Scoped styles:** Card markup is in `ProjectGridItem.astro`. Parent `ProjectGrid` styles that target those classes **must** be `is:global` (or `.project-grid :global(…)`). Scoped parent CSS pins `data-astro-cid` from `ProjectGrid` — the child never carries it, so aspect-ratio / meta padding / `position:relative` / chip button chrome all vanish (caught in review). JS clones also lack any cid — same requirement.

If the template approach hits something structural, **stop and report** — do not fall back to hand-building.

---

## Server: `/api/gallery-membership` must return crop seeds

`coverForGalleryPage()` (`scripts/dev-api-plugins.mjs`) — add:

- `variants` (from listing; fallback `PLACEHOLDER_IMAGE_VARIANTS`)
- `hoverDark` when present (boolean)
- `srcWidth` / `srcHeight` when present

`status` is already on the GET page object. Update `GalleryPage` typedef in `DevGalleryPages.astro`.

---

## Worker landmines

- Bun: `bun`
- Do **not** start a dev server (4321 owned). Cannot browser-verify.
- `bun run commit:engine "msg" <explicit paths>` — never stage `src/content/**` / `public/images/**`
- Vite mounts middleware at server start — Anto's test script step 0 is session restart
- `contentHmrGate` drops full-reload — card must be correct at creation
- `listingCardForGrid` is an allowlist — don't regress `hoverDark` / `variants`
- Plain `<script>`, not `type="module"`, in Astro page scripts
- Never silent fallbacks in new fill paths — `console.warn`
- Do not `git pull`. Off-limits: unrelated content JSON.

---

## First reads (by symbol)

| File | Symbols |
| --- | --- |
| `DevGalleryPages.astro` | `GalleryPage`, `buildGridCard`, `applyMembershipPreview` / `syncGridCards`, `createdItems` / `detachedItems` |
| `ProjectGrid.astro` | project card loop, `projectEditable`, three chip rails, `metaStyle`, drop veils, `--new` li |
| `projectImageFrame.ts` | `imageDevEditAttrs` |
| `responsiveImage.ts` | `normalizeImageVariants`, `responsiveImageStyle` |
| `dev-api-plugins.mjs` | `coverForGalleryPage`, `PLACEHOLDER_IMAGE_VARIANTS`, gallery-membership GET |
| `DevProjectGridEditor.astro` | `enableCardEditing` / `enableAllCardEditing`, `syncStatusChip` |

---

## Wiring checklist (after clone + fill)

- [ ] `enableCardEditing(item)` on the new node
- [ ] Crop chip `data-dev-edit-trigger="image"` — document-delegated (verify by reading; no redundant re-bind)
- [ ] Drop — document-delegated via `data-dev-cover-drop`
- [ ] Reorder `captureOrder` sees the new `<li>`; baseline not spuriously dirty if avoidable
- [ ] Status chip via `syncStatusChip` — do not re-inline icons
- [ ] Subtitle host always present (template carries it) — empty year shows Year/Meta placeholder
- [ ] Title ink = CSS vars on `.project-grid__meta`
- [ ] Third rail `⋮` present; toggles settings closed when re-clicked (already in editor)
- [ ] `data-dev-status='draft'` so view-mode draft fade CSS applies
- [ ] Play: span chip present; no teaser-label element
- [ ] `grep -rn "project-grid__chips" src/` — construction only in `ProjectGrid.astro` (+ CSS), not a second builder in `DevGalleryPages`

---

## Verify — hand to Anto

0. Restart: `bun run dev:session:stop && bun run dev:session`. Checkout `fix/gallery-manager-card-parity` on the main checkout (manager releases worktree first).

Dev mode, `/work` (also spot-check `/play`):

1. Gallery Manager → turn **on** a project that is off → card appears immediately.
2. Hover → all three chip rails like neighbours. *Not valid:* chips only after reload.
3. Visibility chip → menu, status selected, change stages.
4. Crop chip → tuner with usable frame (`variants`).
5. Span chip → frame/handle; drag changes span (including on `/play`).
6. Drop image on cover → veil + crossfade.
7. Project with **no year** → clickable Year placeholder.
8. Title/year click-to-edit.
9. Toggle off then on → exactly one card, fully wired.
10. Save → reload → identical to what you edited.
11. Drift check: `grep -rn "project-grid__chips" src/` — no second construction site in `DevGalleryPages`.

---

## Out of scope

- Gallery Manager membership/order behaviour changes
- Play-link creation
- Imperative fill-in of the old `buildGridCard` markup

---

## Report (auditable)

1. Parent commit of branch  
2. How template shares markup with the loop (fragment/function name)  
3. Fields returned by `coverForGalleryPage` after change  
4. Confirm `buildGridCard` no longer constructs chip HTML by hand  
5. `commit:engine` paths  
6. `bun run build` exit (compilation only)

---

## Pickup

Confirm branch from current `main` (with #171). Summarise in 5–6 lines including template approach. Implement: server `variants` (+ hoverDark/dims) → template → fill → wiring checklist. Do not replan. If template fails structurally, stop and report.
