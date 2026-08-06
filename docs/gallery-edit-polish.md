# Gallery Edit polish

**Keep this file open** — plain markdown (Cursor’s Plan UI does not load agent-written `.plan.md` files).

**Base:** `main` (gallery WYSIWYG landed in merge `5bcac50` / PR #151).  
**North star:** `docs/product-vision.md` — hands-on Edit on the real page.

## Tracker

- [ ] **Cover drop hover** — dashed inset fade-in, dim cover, centred “Replace cover image”
- [ ] **Cover drop iris** — soft-edge circular mask expands from drop point
- [ ] **Span chip** — on-card toggle for how many grid cells the cover spans (full vs half)
- [ ] **Rearrange parity** — Alt+D×2 looks and works like section drag-handle reorder

## Done when

On Home / Work / Play in Edit:

1. **Rearrange mode** (2nd Alt+D) feels like project-page section drag — same chrome language, same grab/lift/drop smoothness — not a dashed-outline “other mode.”
2. **Span chip** on each card toggles grid cell span (today’s `listing.full`) without opening settings.
3. **Cover replace** shows a clear drop target while hovering a file, then reveals the new image with a soft circular iris from the drop point — not an instant swap.

## 1. Cover drop — hover feedback

- [ ] While dragging a file over a cover: **dashed inset** outline fades in (not a hard pop).
- [ ] Cover image **opacity eases down** slightly.
- [ ] Centred label: **Replace cover image** (respect `prefers-reduced-motion` — still show state, skip fancy fades if needed).
- [ ] Clear on dragleave / drop / Esc; don’t leave `data-dev-drop-active` stuck.
- [ ] Replace today’s sharp `outline: 2px dashed` on `[data-dev-drop-active]` with the softer treatment.

**First reads:** `DevProjectGridEditor.astro` (dragover / drop / `applyCoverFileToCard`), `ProjectGrid.astro` (`.project-grid__cover[data-dev-drop-active]`).

## 2. Cover drop — iris reveal

- [ ] On drop, don’t hard-swap the `<img>` src.
- [ ] New image appears under a **soft-edge circular gradient mask** that expands from the **drop coordinates** (clientX/Y → cover-local), like the inverse of a Looney Tunes iris wipe.
- [ ] When the mask covers the card, commit the src / pending cover replace and tear down the overlay.
- [ ] Reduced motion: short crossfade or instant swap — still stage the same pending payload.
- [ ] Failure path (upload error): abort animation, restore previous cover, alert as today.

**Pseudo-code**

```
on drop(file, clientX, clientY):
  local = cover-relative(clientX, clientY)
  blobUrl = URL.createObjectURL(file)
  overlayImg.src = blobUrl
  overlay.style.setProperty('--iris-x', local.x)
  overlay.style.setProperty('--iris-y', local.y)
  overlay.style.setProperty('--iris-r', '0%')
  await animate --iris-r → large enough to cover diagonal (+ soft feather)
  applyCoverFileToCard(...) // existing upload + pending
  remove overlay; revoke blobUrl
```

Mask: CSS `mask-image: radial-gradient(circle at var(--iris-x) var(--iris-y), #000 var(--iris-r), transparent calc(var(--iris-r) + feather))` on a stacked new image.

## 3. Span / grid-cell chip

- [ ] New chip on the card (with status / hover / settings rails) to toggle **half vs full** span (`project-grid__item--full` / `listing.full`).
- [ ] Hide or no-op on Play (settings already hide `data-ps-full` there).
- [ ] Live DOM update on toggle; stage via existing project-settings / listing pending path.
- [ ] Icon language TBD with Anto (columns / expand — Lucide, 14px).
- [ ] Prefer chip as source of truth; drop the settings-panel “Full-width card” checkbox if redundant.

**First reads:** `ProjectGrid.astro` (chip rails), `DevProjectGridEditor.astro` (`listing.full`), `scripts/dev-api-plugins.mjs`.

## 4. Gallery rearrange ↔ section drag parity

- [ ] **Entry / exit** — Alt+D twice still enters; Esc exits. Mode should feel inside Edit, not a separate product surface.
- [ ] **Affordances** — visible drag handle (or whole-card grab) matching `.dev-section-drag-handle` chrome: ghost → fill hover → shadow press — not dashed grid outline + opacity-dim.
- [ ] **Motion** — lift / drop / insertion as smooth as `DevSectionReorderEditor`.
- [ ] **Chips** — hide while rearranging (already hidden); restore on exit.
- [ ] **Pending / Save** — keep `listing-order` save-bar staging.

**First reads:** `DevListingGridEditor.astro`, `DevSectionReorderEditor.astro`, `DevModeController.astro`.

**Landmines:** listing pages don’t import `project.css`; card `<a>` stays disarmed mid-drag; `full` stays consistent with listing-order payloads.

## Out of scope

- Cover crop chip / listing-cover crop pipeline
- Alt+P gallery membership panel
- Online / hosted Edit parity
- Reopening Decap/Sveltia

## Suggested build order

1. Cover drop hover  
2. Cover drop iris  
3. Span chip  
4. Rearrange parity  

Say if you want rearrange first.

## Verify

- **Drop hover** — dashed inset + dim + label while file hovers; clears cleanly
- **Iris** — expands from drop point; pending cover still reaches save bar
- **Span chip** — toggle full/half live; Save persists; Play has no misleading control
- **Rearrange** — grab/lift/drop reads like section reorder; Esc restores Edit chips

## Pickup notes

- Branch off latest `main`
- Engine only: `bun run commit:engine "…" <paths>` — never stage `src/content/**` / `public/images/**`
- Prefer editing `ProjectGrid.astro` + `DevProjectGridEditor.astro` + `DevListingGridEditor.astro`
- After each slice: hard-reload listing → Alt+D → exercise that slice
