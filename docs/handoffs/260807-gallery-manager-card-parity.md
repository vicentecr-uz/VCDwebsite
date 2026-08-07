# Gallery Manager: cards added mid-session must be real cards

**Issue:** [#167](https://github.com/vcruzdesigns/VCDwebsite/issues/167) — `bug` / `gallery pages` / milestone `v2`
**Branch:** `fix/gallery-manager-card-parity` off latest `main`
**Worker:** Composer 2.5 Fast in a worktree (Cursor default). On Claude Code, Sonnet. **Not Haiku** — the central decision here is *how not to duplicate markup*, and the naive fix is the thing that caused the bug.

**Sequencing:** land **last**, after `feat/gallery-cover-chips` (#174/#175/#176) and `feat/play-card-parity` (#171). This branch's whole job is to mirror `ProjectGrid.astro`'s dev markup; doing it before those land guarantees you mirror a version that no longer exists.

---

## Done when

Turning a project **on** in the Gallery Manager adds a card that is indistinguishable from a server-rendered one: cover drop and crop wiring, both chip rails, drop veil, placeholders, and a meta field even when the year is empty — with no reload, and with `variants` available so crop works immediately.

And: the mechanism that made it drift is gone, so the next person to add a chip to `ProjectGrid.astro` gets it here for free.

---

## The bug

`buildGridCard()` (`src/components/DevGalleryPages.astro:353`) hand-builds a card in imperative JS. It is a stripped-down copy of `ProjectGrid.astro`'s markup and has not tracked it since. Pre-existing — unchanged from before the #160–#166 batch; surfaced while testing #165.

Missing versus `ProjectGrid.astro:97-273`:

| Missing | Where the real one lives |
| --- | --- |
| `dev-image-edit-target` class, `data-dev-cover-drop`, `data-dev-listing-cover`, the `imageDevEditAttrs(...)` bundle | `ProjectGrid.astro:87-110` |
| `.project-grid__chips--start` — status button + menu | `ProjectGrid.astro:209-236` |
| `.project-grid__chips--end` — hover, span, crop | `ProjectGrid.astro:237-273` |
| `.project-grid__drop-veil` + label | `ProjectGrid.astro:140-144` |
| `data-placeholder` on title / subtitle / teaser-label | `ProjectGrid.astro:151, 160, 170` |
| the subtitle element when the year is empty | `ProjectGrid.astro:155` renders it on `item.subtitle \|\| isDev`; `buildGridCard:412` only `if (page.subtitle)` — so a project with no year has no year field to click into at all |

Workaround today: Save, reload, and the card comes back server-rendered with everything wired.

---

## The design call — read this before writing any code

#167 ends with a warning, and it is the load-bearing part of this task:

> The straightforward fix duplicates a large block of `ProjectGrid.astro`'s dev markup into imperative JS, which is exactly how the two drifted apart in the first place.

**Do not fix this by extending `buildGridCard()`.** That closes the bug for a week and reopens it permanently.

Three options were considered. The verdict:

- ❌ **Fill in the gaps imperatively.** Fastest, and reproduces the exact failure. Rejected.
- ❌ **Ask the server for rendered markup.** Cleanest in principle, but Astro components cannot be rendered ad-hoc from a Vite middleware without a real SSR entry point. Disproportionate.
- ✅ **Clone a `<template>` that lives in `ProjectGrid.astro`.** One source of truth, in the same file as the real card, in the same syntax, reviewed in the same diff.

### How the template approach goes

1. In `ProjectGrid.astro`, when `isDev`, render **one** `<template data-dev-grid-card-template>` at the end of the `<ul>` (next to the existing `--new` `<li>` at line 277), containing a single `<li>` built from the *same* JSX the real cards use — extract the card body into a local function or component so the template and the loop cannot diverge. Seed it with neutral values: empty title, empty subtitle, placeholder cover, `status: 'draft'`.
2. `buildGridCard(page)` becomes: clone the template's content, then **fill** it — set `dataset.devProjectSlug`, the two image `src`s, the title and subtitle text, the inline colours, the status chip icon and `aria-selected`, the `--full` class, the teaser branch.
3. Everything structural — chips, menu, veil, `data-placeholder`, the `imageDevEditAttrs` bundle — comes along in the clone and is never re-typed.

Constraints on the template:

- The `imageDevEditAttrs` bundle carries per-item values (`documentKey`, `cropId`, serialised `variants`). Those are the *fill* step, not the clone. Read `src/lib/projectImageFrame.ts` and set exactly the attributes it emits — do not guess attribute names, and do not reimplement the serialisation. If the bundle is awkward to set from JS, export a small helper from that module that both the Astro side and the client side call.
- A `<template>`'s contents are inert: no images load, no scripts run. That is why this is cheap. Confirm it does not appear in the layout (it will not) and that it is inside the `isDev` branch so it never ships to production.
- If `getPlayGridItems` / the play work has introduced a second card shape by the time you get here, the template must cover the **project** shape only. Gallery Manager manages projects.

**If the template approach hits something genuinely structural**, stop and report before falling back to hand-building. A worse-but-shipped imperative copy is not an acceptable silent fallback here — that is the bug.

---

## Server change: `/api/gallery-membership` must return `variants`

`coverForGalleryPage()` (`scripts/dev-api-plugins.mjs:834-860`) returns `onGallery, hasCover, image, coverUrl, bg, dark, full, subtitle, hoverImage, order` — **no `variants`**, which the crop wiring needs to seed a frame.

Add it. Notes:

- Take it from the same listing object the rest of the fields come from (`listings[grid] ?? first listing found ?? {}`).
- `PLACEHOLDER_IMAGE_VARIANTS` already exists at `dev-api-plugins.mjs:105` — use it as the fallback rather than inventing a shape or returning `undefined` and making the client guess.
- The GET payload shape is consumed by `DevGalleryPages.astro`'s `GalleryPage` type. Update the type, and check for anywhere else that destructures the response.
- Also worth returning `status` if it is not already there — the status chip needs it and `buildGridCard` currently reads `page.status`. Verify what the endpoint actually sends before adding a duplicate.

---

## Worker landmines

- **Bun is not on `PATH`.** Use `$HOME/.bun/bin/bun`.
- **Do not start a dev server.** Port 4321 is owned. You cannot verify in a browser; Anto does that after merge. A green build proves compilation only — do not report it as verification.
- **Commit via `bun run commit:engine "msg" <explicit paths>`.** Never stage `src/content/**` or `public/images/**`.
- **Vite only mounts dev middleware at server start.** Your `dev-api-plugins.mjs` change does nothing until the session restarts — Anto must run `bun run dev:session:stop` then `bun run dev:session` before testing. Put that as step 0 of the test script.
- **`contentHmrGate` drops `full-reload`.** The card must be correct at creation; nothing will reload to rescue it.
- **Two cards must not both claim a slug.** `syncGridCards` (~486) tracks `createdItems` and `detachedItems` separately, and re-toggling a project off then on must not leave a stale node. Read that function fully before changing what `buildGridCard` returns.

---

## First reads

| File | Why |
| --- | --- |
| `src/components/DevGalleryPages.astro:353-440` | `buildGridCard` as it stands |
| `src/components/DevGalleryPages.astro:470-503` | `syncGridCards` — insert / detach / re-insert lifecycle |
| `src/components/ProjectGrid.astro:73-284` | everything the template must carry |
| `src/lib/projectImageFrame.ts` | `imageDevEditAttrs`, `hasCropVariants`, `imageSourceDims` |
| `src/lib/responsiveImage.ts` | `normalizeImageVariants`, `responsiveImageStyle` |
| `scripts/dev-api-plugins.mjs:105-109, 827-860` | `PLACEHOLDER_IMAGE_VARIANTS`, `coverForGalleryPage` |
| `src/components/DevProjectGridEditor.astro:209-228` | `enableAllCardEditing` — what has to run on a new card |

---

## Wiring the new card up

Cloning gets the markup; the card still has to join the running dev layer. Check each of these and add whatever is missing:

- [ ] `enableAllCardEditing()` (or `enableCardEditing(item)`) runs on the new node, so title / subtitle / teaser-label become `contenteditable` and card links are disarmed.
- [ ] The crop chip's `data-dev-edit-trigger="image"` is picked up. `DevModeController` binds `click` on `document` in capture and looks up panels by key, so a new node needs no re-binding — **verify by reading**, and say so rather than adding a redundant re-init.
- [ ] Drop wiring likewise: `dragover` / `drop` are delegated on `document` and resolve via `coverFromPoint` → `closest('[data-dev-cover-drop]')`. Nothing to re-bind if the attribute is present.
- [ ] `DevGalleryReorder`'s `captureOrder` sees the new `<li>` (it queries live each time — confirm) and its baseline is recaptured, or toggling a project on will read as a pending reorder.
- [ ] The status chip's icon matches `page.status` — `syncStatusChip` in `DevProjectGridEditor.astro:345` already does exactly this. Call it; do not re-inline the icon lookup.
- [ ] `ensureSubtitleHost` is not needed if the template always carries the subtitle span. Prefer the template carrying it — that is the fix for the empty-year case.

---

## Verify — hand this to Anto

0. **Restart the dev session first** — `bun run dev:session:stop && bun run dev:session`. The API change is not live otherwise, and the failure looks like a 404 returning HTML.

Then, dev mode on, on `/work`:

1. Open the Gallery Manager, turn **on** a project that is currently off. The card appears immediately.
2. Hover it → both chip rails appear, same as its neighbours. *Not valid as a pass:* chips visible because you reloaded.
3. Click the visibility chip → menu opens, current status is marked selected, changing it stages a pending edit.
4. Click the crop chip → the tuner opens on that card's cover and shows a usable frame (this is the `variants` fix).
5. Click the span chip → frame and edge handle appear; drag changes the span.
6. Drag an image onto the cover → drop veil reads "Replace cover image", the crossfade plays, the new cover lands.
7. **Pick a project with no year.** Its card must still show a clickable "Year" placeholder. Type into it → stages. This is the case `buildGridCard` silently omitted.
8. Title and year on the new card are click-to-edit and show placeholders when emptied.
9. Toggle the same project **off** then **on** again → exactly one card, fully wired, no ghost.
10. Save → reload → the server-rendered card is identical to what you were just editing.
11. **Drift check.** Confirm there is now exactly one place in the repo that spells out the card's dev markup. `grep -rn "project-grid__chips" src/` should show `ProjectGrid.astro` and CSS only — no second construction site.

---

## Out of scope

- Any change to what the Gallery Manager *does* (membership toggling, ordering).
- The chip reveal behaviour (#174) and the hover-swap chip (#175) — inherited from `feat/gallery-cover-chips`.
- Play-link cards (#171) — the Gallery Manager manages projects.
- Server-side rendering of arbitrary Astro components for dev APIs.

---

## Pickup

Read this file and the *First reads* table. Confirm your worktree branches from a `main` that already contains `feat/gallery-cover-chips` and `feat/play-card-parity`. Summarise the plan back in five or six lines — including which of the three approaches you are taking and why — then implement: server `variants` first, then the template, then the fill, then the wiring checklist. Do not replan. If the template approach fails structurally, **stop and report**; do not fall back to hand-building the markup.
