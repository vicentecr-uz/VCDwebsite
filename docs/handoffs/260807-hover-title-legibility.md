# Card titles over hover covers: measure at drop time, store one flag

**Issue:** [#182](https://github.com/vcruzdesigns/VCDwebsite/issues/182) — `bug` / `gallery pages` / milestone **v1 — Launch**
**Branch:** `fix/hover-title-legibility` off latest `main`
**Executor:** Sonnet in a worktree. **Not Haiku** — the field has to survive a round trip through five files, and the failure mode is silent.

---

## Done when

Dropping a hover image onto a card in dev mode measures whether the title area of that image is light or dark, stores the answer in the project JSON, and the card's title and year switch to the readable colour while the card is hovered on the **live site** — with no canvas, no JS, and no measurement work in the visitor's browser.

---

## Why this shape

`ProjectGrid.astro` picks title colour from `listings.*.dark`, one boolean describing the **base** cover. There is no flag for `hoverImage`, so a dark base with a light hover image gives a white title on a white image for as long as you hover.

#172 proposes a runtime sampler. **It is deferred to v2** — it costs every visitor a canvas decode per cover and it opens the dark-mode question. This issue does the same measurement at **authoring** time instead, so the runtime cost is one boolean in a JSON file.

This is *not* the "authored flag" #172 rejected. A human is not judging; the machine reads pixels. The only difference from #172 is when it runs.

---

## Executor landmines

- **Bun is not on `PATH`.** Use `$HOME/.bun/bin/bun`.
- **Do not start a dev server.** Another session owns port 4321. You cannot verify in a browser — that is expected. A green `bun run build` proves compilation only; do not report it as verification.
- **Commit via `$HOME/.bun/bin/bun run commit:engine "msg" <explicit paths>`.** Never stage `src/content/**` or `public/images/**`.
- **Do not migrate existing content.** No script that back-fills `hoverDark` into existing JSON. Absent means "fall back to `dark`".
- **`listingCardForGrid` is an allowlist.** See below — this is the main trap.
- Vite mounts dev middleware at server start, so your `dev-api-plugins.mjs` change needs a session restart before it does anything. Say so in the test script.

---

## The main trap: the field is silently dropped unless five places agree

`listingCardForGrid` (`scripts/dev-api-plugins.mjs:25`) does **not** merge the incoming listing — it rebuilds it from a fixed set of keys:

```js
const base = { order, image, bg, dark, full };
if (hoverImage) base.hoverImage = hoverImage;
if (variants && …) base.variants = …;
```

Anything not named is discarded. So a `hoverDark` that is written by the drop handler but not carried here will vanish the next time anything saves project settings — and nothing errors. Note how `hoverImage` and `variants` both take `previous.*` as a fallback; `hoverDark` needs the same treatment, or a settings-panel save (which does not send it) wipes it.

Update all of these in one go, then trace one value end to end before moving on:

| # | File | What |
| --- | --- | --- |
| 1 | `src/components/DevProjectGridEditor.astro` — `buildListingPayload` (~247) | emit `hoverDark` |
| 2 | `scripts/dev-api-plugins.mjs` — `listingCardForGrid` (25) | carry it, with `previous.hoverDark` fallback |
| 3 | `scripts/dev-api-plugins.mjs` — `/api/project-settings` GET (~656) | return it in the `listing` payload |
| 4 | `src/components/DevProjectGridEditor.astro` — `ensureLoaded` (~397) | read it into the snapshot, or a later save clears it |
| 5 | `src/lib/projects.ts` — `ProjectGridListing` type (41) + `toGridListing` (~163) | declare and pass through |
| 6 | `src/components/ProjectGrid.astro` — `ProjectGridItem` type (24) | declare |

`scripts/dev-api-plugins.mjs` → `coverForGalleryPage` (~834) also returns a listing summary. Check whether the Gallery Manager needs it; if not, say so rather than adding it speculatively.

---

## Part 1 — measure at drop

In `DevProjectGridEditor.astro`, on the `hoverImage` slot path (`applyCoverFileToCard`, ~687, and the `drop` handler ~1115 that derives `slot`).

Put the measurement in its own module — **`src/scripts/coverLuminance.ts`** — not inline in the editor. #172 will want exactly this function at runtime later, and a helper it can lift is the difference between this being a stepping stone and being throwaway.

```
measureRegionLuma(source, region) -> number   // 0..1 mean relative luminance
  draw source into an offscreen canvas, small (64px on the long edge is plenty)
  read the pixels covered by `region` (a normalised {x, y, w, h} in 0..1)
  convert sRGB -> linear, weight 0.2126 R / 0.7152 G / 0.0722 B, average
```

Then `hoverDark = measureRegionLuma(...) < THRESHOLD` — i.e. a dark backdrop means the card needs light text, matching what `dark: true` already means everywhere else. **Confirm that polarity against `titleColor` before wiring it**; getting it inverted produces a plausible-looking result that is wrong on every card.

Notes:

- The dropped file is a local blob, so the canvas is **not** tainted. No CORS work needed.
- **Sample the title's region, not the whole image.** That is what makes this nearly as good as #172 for this case. Derive the region from the real geometry: `.project-grid__meta`'s bounding box relative to the cover's bounding box, normalised. Do not hard-code "bottom-left 60%" — the meta box is padded by `var(--space-unit)` and the card's aspect ratio changes across breakpoints.
- **`object-fit: cover` crops the image.** The normalised region is in *cover* space; convert to *image* space through the same fit the browser is doing, or you will sample the wrong part of a portrait image dropped into a 4:3 frame.
- **Real crops.** If the listing has `variants`, the visible area is a sub-rect expressed as `--project-content-cx / -cy / -w`. Handle it if it falls out cleanly. **If it does not, sample the `object-fit: cover` region and say so in the PR** — an approximation that is documented is fine here; a wrong answer presented as exact is not.
- Threshold and region are judgement calls. Pick a defensible default (0.5 on linear luminance is a reasonable start), name the constant, and flag in the PR that it wants one look in the browser.
- If measurement throws for any reason, **fall back to the base `dark` value**. Never leave `hoverDark` undefined-but-intended or the title unstyled.

---

## Part 2 — render from it

`ProjectGrid.astro` currently hard-codes both colours inline:

```js
const titleColor = (dark) => (dark ? '#f7f7f7' : '#6d6d6d');
const subtitleColor = (dark) => (dark ? 'rgba(247,247,247,0.5)' : 'rgba(109,109,109,0.5)');
```

Inline `style="color: …"` cannot respond to `:hover`, so move to custom properties on the meta container and let CSS choose:

- Emit `--title-ink` / `--subtitle-ink` from `item.dark`, and `--title-ink-hover` / `--subtitle-ink-hover` from `item.hoverDark ?? item.dark`.
- `.project-grid__title { color: var(--title-ink); }`
- Swap on `.project-grid__card:hover` **only when the card actually has a hover image** — reuse `.project-grid__cover--has-hover`, which already gates the image crossfade. A card with no hover image must never swap.
- Swap on `.is-dev-hover-forced` too, so the dev preview matches what a visitor sees.
- **Transition the colour on the same 0.2s as the image crossfade** (`ProjectGrid.astro` ~355). A title that snaps while the image fades is worse than not doing this at all.
- **Touch breakpoint:** at `max-width: 768px` the hover image swap is disabled (`opacity` forced back, ~540). The ink swap must be disabled there too, or titles change colour for an image that never appears.

`applyListingPreview` (`DevProjectGridEditor.astro` ~325) currently writes `titleNode.style.color` directly. It must set the custom properties instead, or dev preview and the live render disagree.

---

## Part 3 — keep it overridable

The settings panel has a "Light text on card" checkbox (`data-ps-dark`) for the base cover. Add the hover equivalent next to it, pre-filled from the measurement.

The measurement is a **good default, not an authority.** Anto has tuned existing `dark` values by eye and they must not be overwritten.

**Do not** run the measurement on base-cover drops in this branch. Same code path would work, but it would start silently changing hand-tuned values. #182 lists it as a "worth deciding" — leave it, and note in the PR that the helper is ready for it.

---

## Cleanup / lifecycle

- [ ] `hoverDark` survives: drop → Save → reload → open settings → change something unrelated → Save → reload. This is the allowlist trap; test it explicitly.
- [ ] Removing/replacing a hover image re-measures rather than keeping a stale flag.
- [ ] A card with no hover image has no `--*-ink-hover` behaviour at all.
- [ ] Teaser cards: `hoverImage` is stripped for teasers (`buildListingPayload`), so `hoverDark` must not be written or read for them.
- [ ] No canvas, no `measureRegionLuma` call, and no new script in the production bundle. Verify with a `dist/` grep, not by eye.

---

## Verify — hand this to Anto

0. **Restart the dev session** — `bun run dev:session:stop && bun run dev:session`. The API change is inert otherwise.

1. Find (or make) a card with a **dark** base cover and drop a **light** hover image on it. Save, reload, dev mode **off**.
2. Hover that card → title and year switch to dark text as the image crossfades, in step with it, not after.
3. Unhover → they switch back.
4. Reverse case: light base, dark hover image → title goes light on hover.
5. Card with **no** hover image → title colour never changes on hover.
6. **The allowlist test.** Open project settings on the card from step 1, toggle something unrelated (card background), Save, reload. Hover still works. *Not valid as a pass:* checking straight after the drop — the field is only at risk on the **second** save.
7. Open settings → the hover text checkbox reflects what was measured. Flip it manually, Save, reload → your choice wins over the measurement.
8. Mobile width (< 768px) → no colour change, since there is no image swap.
9. Existing cards you have not touched behave exactly as before.

---

## Out of scope

- Runtime luminance sampling (#172, v2).
- Measuring base covers / back-filling existing `dark` values.
- Dev chip and drag-handle contrast over hover images (#172).
- Dark mode.
- Any migration script.

---

## Pickup

Read this file, then `ProjectGrid.astro:63-64, 161-192`, `DevProjectGridEditor.astro:247-260, 397-439, 687-700`, `dev-api-plugins.mjs:25-54`, `projects.ts:41-58, 152-181`. Summarise back in five or six lines, confirm your parent commit is the tip of `main`, then build Part 1's helper first and **trace one measured value all the way to disk and back before writing any render code** — the allowlist will eat it otherwise. Do not replan.
