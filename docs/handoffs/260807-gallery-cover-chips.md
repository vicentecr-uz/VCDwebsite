# Gallery cover chips: hover-only rail, hover-image swap, empty-cover drop

**Issues:** [#174](https://github.com/vcruzdesigns/VCDwebsite/issues/174) · [#175](https://github.com/vcruzdesigns/VCDwebsite/issues/175) · [#176](https://github.com/vcruzdesigns/VCDwebsite/issues/176) — all `enhancement` / `gallery pages` / milestone `v2`
**Branch:** `feat/gallery-cover-chips` off latest `main`
**Worker:** Composer 2.5 Fast in a worktree (Cursor default). On Claude Code, Sonnet. **Not Haiku** — the drop handler branches on live DOM state and the blob/commit lifecycle has three interacting maps.

Landing all three on one branch is deliberate: #176 says *"land these in an order where the second doesn't have to redo the first."* #175 and #176 both rewrite the same `drop` handler and the same cover markup. Do them together.

---

## Done when

In dev mode on `/`, `/work`, `/play`:

1. Chip rails are invisible until the card is hovered (or something on it has focus, or a menu/panel it owns is open) — matching how project-page section controls behave.
2. Every editable card has a hover-image chip, whether or not it already has a hover image. Toggling it swaps which image the cover shows; dropping an image while it is toggled on writes `listings.*.hoverImage`, not the primary cover.
3. A card whose cover is still the placeholder reads as droppable rather than broken, keeps its normal footprint, and accepts a dropped image through the existing handler.

Non-negotiable: none of this leaks to the live site with dev mode off.

---

## Worker landmines — read before touching anything

- **Bun is not on `PATH`.** Use `$HOME/.bun/bin/bun`.
- **Do not start a dev server.** Another session owns port 4321. You cannot verify in a browser; Anto does that after merge. A green `bun run build` proves compilation only — do not report it as verification.
- **Commit only via `bun run commit:engine "msg" <explicit paths>`.** Pass only the files you edited. The script refuses content paths outright; never stage `src/content/**` or `public/images/**`.
- **`ProjectGrid.astro` has two `<style>` blocks.** The scoped one (line ~286) and `is:global` (line ~588). Chip rails, drop chrome, and the crossfade overlay **must** stay in the global block — listing pages never import `project.css`, and Astro's scope attribute is absent on JS-created nodes. There is a comment saying so at line 588. Respect it.
- **`data-dev-mode-only`** on the chip rails is what `DevModeController` uses to set `hidden` when dev mode is off. Do not remove it; it is the live-site guard.
- `contentHmrGate` drops Vite `full-reload` in dev, so content JSON changes never reload the page. Do not write code that assumes a Save reloads anything.

---

## First reads

| File | Why |
| --- | --- |
| `src/components/ProjectGrid.astro:97-178` | the `cover` fragment — images, drop veil, meta |
| `src/components/ProjectGrid.astro:209-273` | both chip rails |
| `src/components/ProjectGrid.astro:594-629` | chip rail placement + the reveal rule (#174's one-line target) |
| `src/components/ProjectGrid.astro:666-741` | drop veil, drop wash, crossfade overlay |
| `src/components/DevProjectGridEditor.astro:288-343` | `applyListingPreview` — the DOM sync the issues call `syncCardFromSnapshot` |
| `src/components/DevProjectGridEditor.astro:653-724` | `uploadCoverImage`, `applyCoverFileToCard`, `promoteLiveCoverOnSave` |
| `src/components/DevProjectGridEditor.astro:786-863` | `playCoverCrossfade`, `coverFromPoint` |
| `src/components/DevProjectGridEditor.astro:1024-1085` | dragover / dragleave / **drop** |
| `src/components/DevSectionReorderEditor.astro:800-820` | the project-page hover-reveal rule #174 is matching |
| `src/lib/projects.ts:215-245` | `emptyModernProjectDocument` — seeds the placeholder cover |
| `scripts/dev-api-plugins.mjs:827-833` | `PLACEHOLDER_COVER` / `isPlaceholderCoverSrc` — reuse this constant, don't invent one |

---

## Part 1 — #174: chips reveal on hover only

### The change

`src/components/ProjectGrid.astro`, the global rule at ~623. Today:

```css
html.is-dev-mode .project-grid__chips,              /* always-on — remove */
html.is-dev-mode .project-grid__chips:focus-within,
html.is-dev-mode .project-grid__item:hover .project-grid__chips,
html.is-dev-mode .project-grid__item:focus-within .project-grid__chips {
  opacity: 1;
  pointer-events: auto;
}
```

Drop the first selector. **Keep `:focus-within`** — both the rail's own and the item's. That is the keyboard route to the chips at all.

### Then close the three ways it breaks

Removing the always-on case creates states where the rail vanishes out from under an interaction it started. All three are pure CSS; do not reach for JS.

**a. Open status menu.** `[data-dev-status-menu]` lives inside `.project-grid__chips--start` and opens on click. On macOS a `<button>` click does not reliably focus it, so `:focus-within` cannot be trusted to hold the rail while the pointer travels off the card to the menu. The menu's `hidden` attribute is the honest signal:

```css
html.is-dev-mode .project-grid__item:has([data-dev-status-menu]:not([hidden])) .project-grid__chips
```

**b. Crop tuner open.** The crop chip (`data-dev-edit-trigger="image"`) opens the image panel; `DevProjectGridEditor` puts `is-dev-crop-open` on `<html>` and the crop stage marks its cover `.dev-crop-stage-host` (there is already a rule keying off that at line ~807). Hold the rail on that card:

```css
html.is-dev-crop-open .project-grid__item:has(.dev-crop-stage-host) .project-grid__chips
```

**c. Span mode.** `enterSpanMode` adds `.is-span-mode` to the `<li>` and latches the chip `aria-pressed="true"`. Hold the rail while `.project-grid__item.is-span-mode`.

Fold a, b, c into the same rule as the hover/focus pair. Add a short comment saying *why* each is there — a future reader will otherwise read them as redundant with `:hover`.

### Leave alone

- The **drag handle** (`DevGalleryReorder.astro`, proximity + slow-hover reveal). Explicitly out of scope.
- The existing suppression at line ~708 that hides chips during drop / crossfade. It uses `!important` and still wins. Verify by reading, do not remove.
- The wider *"one interaction at a time"* idea (fade the other chips while crop or span is active). Named as related in #174; **not in this branch.**

---

## Part 2 — #175: hover-image swap chip

### 2a. The hover `<img>` must always exist for editable cards

`ProjectGrid.astro:130` renders it only `{item.hoverImage && (…)}`. That is the real blocker: with no element in the DOM, `applyListingPreview` has nothing to write a newly added hover image into, so the card would not update until reload.

Render it whenever `editable`, with `hidden={!item.hoverImage}`:

```jsx
{(item.hoverImage || editable) && (
  <img … class="project-grid__img project-grid__img--hover w-full h-full object-cover"
       src={item.hoverImage ? projectImage(item.hoverImage) : undefined}
       hidden={!item.hoverImage} aria-hidden="true" loading="lazy" />
)}
```

- Keep `.project-grid__cover--has-hover` driven by **actual** `item.hoverImage`, exactly as now. That class gates the public hover crossfade; a card with an empty hover slot must not advertise one to a visitor.
- A `hidden` img is `display: none`, so the `.is-dev-hover-forced` opacity rules are inert on it — no CSS change needed for that.
- `applyListingPreview` (~316-324) already sets `hoverImg.src` / `hoverImg.hidden` from `listing.hoverImage`. Once the element exists, adding a first hover image flows through unchanged. Confirm this by reading rather than adding a parallel path.

### 2b. Render the chip unconditionally

`ProjectGrid.astro:239` — drop the `{item.hoverImage && …}` gate. Keep `aria-pressed`. Make the accessible name state-dependent, updated in the click handler alongside `aria-pressed`:

- pressed `false` → "Showing cover image — switch to hover image"
- pressed `true` → "Showing hover image — switch to cover image"

Set `title` to match.

### 2c. Empty hover slot must read as droppable, not broken

With forced-hover on and no hover image, the base fades to `opacity: 0` (rule at ~351) and you get an empty box showing the listing `bg`. That is the correct *mechanism* but a bad *state*.

Add an empty state on the cover when `.is-dev-hover-forced` and the hover img is `hidden`:

- Reuse the existing chrome — `.project-grid__drop-veil` + `.project-grid__drop-label` (~666-687) already give a centred, dual-drop-shadow label that stays legible on any cover, plus the page-white wash pattern at ~697.
- Label: **"Drop hover image"**.
- Selector along the lines of `.project-grid__cover.is-dev-hover-forced:has(> .project-grid__stack > .project-grid__img--hover[hidden])`. Verify the child chain against the real markup before committing — the crop case nests differently (`.project-crop-clip`), and the hover img is a direct child of `.project-grid__stack` in both.
- Because this only ever applies under `.is-dev-hover-forced`, which only `DevProjectGridEditor` ever sets, there is no live-site path. Do not add a redundant `html.is-dev-mode` prefix unless the selector genuinely needs it — but **do** confirm `disableAllCardEditing` (~220) strips `.is-dev-hover-forced` on dev-mode exit. It does today; keep it that way.

### 2d. Scope check on `.is-dev-hover-forced`

Requirement is **image only, titles unchanged**. Read the CSS at 346-354: it swaps the two image opacities and nothing else. Titles are governed separately (`html.is-dev-mode .project-grid__meta { opacity: 1 }`). So this already satisfies the requirement — record that in the PR body rather than "scoping" something that needs no scoping.

### 2e. Drops must respect which image is showing

This is the substantive part. Today `drop` (~1046) reads `cover.dataset.devCoverDrop` and calls `applyCoverFileToCard(slug, file, blobUrl)`, which always writes `entry.draft.listing.image`.

Thread a **slot** — `'image' | 'hoverImage'` — derived once at drop time from `cover.classList.contains('is-dev-hover-forced')`, through:

1. **`playCoverCrossfade(cover, file)`** — its `finish()` (~806) hard-codes `.project-grid__img--base`. Take the slot and target `.project-grid__img--hover` instead when hovering. When the hover img is `hidden`, unhide it before assigning `src`, or the crossfade lands on a `display: none` element and the overlay lifts onto nothing.
2. **`applyCoverFileToCard(slug, file, blobUrl, slot)`** — write `entry.draft.listing.hoverImage = url` for the hover slot. `uploadCoverImage` is slot-agnostic; leave it alone.
3. **Blob bookkeeping.** `liveCoverBlobs` (~279) is keyed by slug and is read by `applyListingPreview` to override `displayImage` for the **base** img only. Add a parallel `liveHoverBlobs` map with its own `revokeLiveHover`, and have `applyListingPreview` prefer it for `hoverImg.src` the same way. Do **not** overload the existing map — the two previews have different lifetimes and one map keyed by slug cannot hold both.
4. **Commit.** `promoteLiveCoverOnSave` (~696) runs the overlay-under-blob choreography so the base never flashes. The hover image is not visible at rest, so it needs none of that: on `vcd:dev-pending-committed`, for each slug with a hover blob, set `hoverImg.src = entry.draft.listing.hoverImage`, `await waitImageReady`, then revoke. Keep it a separate small function; do not generalise `promoteLiveCoverOnSave` into a two-mode helper.
5. **Revert.** `vcd:dev-pending-reverted` (~1175) revokes and clears `liveCoverBlobs`. Clear `liveHoverBlobs` in the same handler or a hover drop survives a revert as a dangling blob.

`buildListingPayload` (~247) already emits `hoverImage` when non-empty and non-teaser — no change needed there. Read it and confirm.

### Accepted trade-off

There is still **no way to remove** a cover or hover image, only replace it. Anto has explicitly said that is fine. Do not build a delete affordance.

---

## Part 3 — #176: drop onto a placeholder cover

### Correct the issue's premise first

#176 guesses the blocker is a zero-height cover. **It is not.** Two things it did not know:

- `emptyModernProjectDocument` (`src/lib/projects.ts:215-245`) seeds `image: '/images/black-token.svg'`. A new card is never coverless — it carries a placeholder token.
- `.project-grid__cover` has `aspect-ratio: 4 / 3` (`ProjectGrid.astro:316`) and the images are absolutely positioned inside `.project-grid__stack { inset: 0 }`. The box holds its footprint with or without a usable image, so `elementFromPoint` in `coverFromPoint` has a real target and `data-dev-cover-drop` is already present.

So requirement 1 of the issue ("empty cover keeps the card's normal footprint") is **already satisfied**. Verify by reading, state it in the PR body, and do not add aspect-ratio code.

The actual gap is requirement 2: a placeholder cover looks like a card with a weird black token on it, not like a slot waiting for an image.

### The change

1. **Detect the placeholder server-side, in the component.** `scripts/dev-api-plugins.mjs:827` already exports the constant and the test:

   ```js
   const PLACEHOLDER_COVER = '/images/black-token.svg';
   function isPlaceholderCoverSrc(src) { … value.includes('black-token') … }
   ```

   Do **not** duplicate this string into `ProjectGrid.astro`. Move it to a shared module both sides import — `src/lib/images.ts` is the natural home, next to `projectImage` / `isDraftImageSrc` — and have `dev-api-plugins.mjs` import from there. If a `.mjs` script importing from `src/lib/images.ts` turns out not to work under the Vite plugin context, put the constant in a tiny `.mjs`-friendly module instead and import it both ways. **Do not settle for two copies of the string.**

   Careful: `/images/black-token.svg` is also the legitimate cover of the `design-system` play link (`src/content/play/design-system.json`). Gate the empty state on `editable` (which requires `item.slug`) so play-link cards are never treated as empty.

2. **Mark the cover.** `data-dev-cover-empty={editable && isPlaceholder ? 'true' : undefined}`.

3. **Empty state.** Same treatment as 2c — reuse `.project-grid__drop-veil` / `.project-grid__drop-label` with the page-white wash, label **"Drop cover image"**, shown whenever `html.is-dev-mode` and `[data-dev-cover-empty='true']`. It must yield to the transient states: when `data-dev-drop-active` or `data-dev-crossfade-active` is on the same cover, the drop-active chrome wins. Read the existing rules at 689-717 and slot the new one so specificity lands the right way round — do not reach for `!important`.

4. **The drop handler needs no change.** It takes the slug from `cover.dataset.devCoverDrop` and calls `applyCoverFileToCard`. Confirm that by reading; if you find yourself editing it for #176, you have gone wrong.

### Say this in the PR body, don't code around it

A newly created project's card **does not appear on the grid until the dev session restarts.** Two independent reasons: Astro caches `getStaticPaths()` for `/[slug]`, and `contentHmrGate` deliberately drops `full-reload` for `src/content/**`. `/api/project-create` then navigates to `/{slug}`, which 404s until restart — documented in `CLAUDE.md`. #176 asks that this be *stated in the flow rather than left looking broken*. Stating it in the PR body and the issue is the deliverable here. **Do not** try to fix the restart requirement on this branch.

### Live-site leak check

`data-dev-cover-empty` is emitted only when `editable`, which is `isDev && Boolean(item.slug)` — `import.meta.env.DEV`, so it is compiled out of production entirely. Confirm the empty-state CSS is inside a `html.is-dev-mode` guard anyway, so a `draft` project can never show a drop affordance to a visitor. Verify both, and say so.

---

## Cleanup / lifecycle checklist

Walk these explicitly before opening the PR:

- [ ] `liveHoverBlobs` revoked on: revert, commit, dev-mode exit, and replacement drop (mirror every place `liveCoverBlobs` is touched — grep for it, there are five).
- [ ] `disableAllCardEditing` still clears `.is-dev-hover-forced` and resets every `[data-dev-project-hover]` to `aria-pressed="false"`, including cards whose hover slot is empty.
- [ ] The unconditional hover `<img>` does not ship to production for non-editable cards (`editable` is dev-gated — confirm in the built output, not by eye).
- [ ] No `!important` added. The existing two in the chips-suppression rule stay.

---

## Verify — hand this to Anto, do not run it yourself

Numbered script for the PR body. Dev mode on (`Alt+D`), on `/work` unless stated.

1. **Chips hide.** Move the pointer off every card → no chip rails visible anywhere. Hover one card → only that card's two rails appear. *Not valid as a pass:* rails already hidden because dev mode is off.
2. **Menu holds.** Hover a card, click the visibility chip, move the pointer off the card toward the menu → menu and rail both stay. Click away → both close.
3. **Crop holds.** Click the crop chip, then move the pointer off the card → the rail stays while the tuner is open. Escape → tuner closes, rail hides.
4. **Span holds.** Click the span chip, move off the card → frame, edge handle, and rail all stay. Escape → all clear.
5. **Keyboard.** Tab into a card's chips with the pointer parked in a corner → rail appears and stays while focus is inside it.
6. **Hover chip exists everywhere.** Every editable card has the images chip, including ones that have never had a hover image.
7. **First hover image.** On a card with no hover image: toggle the chip on → cover shows a "Drop hover image" empty state, titles unchanged. Drop an image → it crossfades into the hover slot. Toggle off → the original cover is still there, untouched. Save → reload → hovering that card on the live grid now crossfades to the new image.
8. **Hover drop does not clobber the cover.** Repeat 7 on a card that *already* has both images, and confirm the primary cover is byte-identical afterwards (check `listings.work.image` in the JSON).
9. **New card empty state.** `+ New page` → create → (restart the dev session; expected) → the new card shows "Drop cover image" rather than the black token. Drop an image → it lands. Save → reload → cover persists.
10. **Live site.** Dev mode off, reload → no chips, no drop labels, no empty states on any card, including `draft` ones.

---

## Out of scope

- The drag handle's reveal behaviour (#174 says so explicitly).
- "One interaction at a time" chip fading (#174, related).
- Per-image light/dark chip contrast (#172).
- Removing a cover or hover image (#175, accepted trade-off).
- Making a newly created project's card appear without a restart (#176 — document it, don't fix it).
- Play-link cards on `/play` — separate branch, see `docs/handoffs/260807-play-card-parity.md`.

---

## Pickup

Read this file and the *First reads* table. Summarise the plan back in five or six lines, confirm your worktree's parent commit is the tip of `main`, then implement exactly as written — Part 1, then Part 2, then Part 3. Do not replan. Where this document contradicts the GitHub issue, **this document is right** and the issue is working from an older reading of the code; note the correction in the PR body so the issue can be updated.
