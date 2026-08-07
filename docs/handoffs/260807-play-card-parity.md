# Play cards: per-kind dev affordances

**Issue:** [#171](https://github.com/vcruzdesigns/VCDwebsite/issues/171) — `enhancement` / `gallery pages` / milestone `v2`
**Branch:** `feat/play-card-parity` off latest `main` (confirm parent is current `main`; as of handoff rewrite that was `44c6437`)
**Worker:** Composer 2.5 Fast in a worktree (Cursor default). On Claude Code, Sonnet. **Not Haiku** — this adds a second document kind to the dev-editing pipeline; the failure mode is a silent no-op, not a crash.

**Updated:** 2026-08-07 against `main` @ `44c6437` (after PRs #180 / #186). All line anchors below were re-located by symbol name. Do **not** trust older line numbers from prior drafts of this file.

---

## Done when

On `/play`, in dev mode:

- Cards backed by a project (`src/content/projects/*.json` with a `listings.play`) have the **same** rail as Home and Work: visibility chip, span chip, crop chip, hover chip, card-settings `⋮` chip, and click-to-edit title and meta.
- Cards backed by a play link (`src/content/play/*.json`) have the rail they *can* have — click-to-edit title and meta, and cover crop — with no visibility / span / hover / settings chips, and nothing on the card implies those exist.
- Neither kind leaks any of it to the live site.

---

## The root question, already answered

#171 asks whether play entries are genuinely a different thing or projects in a different grid. They are genuinely different, and **Anto's decision is: degrade per card, no content migration.**

The evidence, so you do not re-derive it:

- `getPlayGridItems` (`src/lib/projects.ts`, symbol) concatenates `getProjectGridListings('play')` with a glob over `src/content/play/*.json`, sorted by a shared `order`.
- `PlayLinkItem` (`src/lib/projects.ts`) is flat: `id, order, title, meta, image, bg, dark, href`. No `status`, no `listings`, no `teaser`, no `variants`, no `hoverImage` / `hoverDark`, no `full`.
- `src/pages/play.astro` maps the two shapes into `ProjectGridItem`, giving links a `playLinkId` and projects a `slug`.
- `ProjectGrid.astro` — `const editable = isDev && Boolean(item.slug)`. **That single line is why the whole rail is absent for links**, and (because it also gates nothing else on `variant`) it is *not* why project-backed play cards are missing chips. Read carefully: project-backed play cards already get visibility / hover / crop / settings rails today. What they are actually missing is only the **span chip**, gated separately by `variant !== 'play'`.

So the work splits cleanly in two, and the first half is much smaller than the issue implies.

---

## Post-#180/#186 facts (do not regress)

These landed after the first draft of this spec. Preserve them:

- Title ink is CSS custom properties on `.project-grid__meta` (`--title-ink`, `--subtitle-ink`, `--title-ink-hover`, `--subtitle-ink-hover`, `--title-ink-on-page`, `--subtitle-ink-on-page`) — **not** inline `style="color"`.
- Chip palettes are tokens `--chip-{ink,fill,ring,press}-on-{light,dark}`; selected via `data-dev-dark` / `data-dev-hover-dark`.
- Third chip rail: `.project-grid__chips--end-bottom` (card-settings `⋮`). Project-backed play cards already get it via `editable`; play-link cards must **not**.
- `listings.*.hoverDark` must survive every save path (`listingCardForGrid` is an allowlist — see traps).
- Hover `<img>` renders for every `editable` card, `hidden` when empty.

---

## Worker landmines

- **Bun is not on `PATH`.** Use `$HOME/.bun/bin/bun`.
- **Do not start a dev server.** Port 4321 is owned by another session. You cannot verify in a browser. A green build proves compilation only — say so explicitly; do not report it as verification.
- **Commit via `$HOME/.bun/bin/bun run commit:engine "msg" <explicit paths>`.** Never stage `src/content/**` — including the play JSON. If a schema field needs to exist in `src/content/play/*.json` for your code to run, **do not add it**: write the reader to tolerate its absence, and note in the PR that Anto adds it through the editor.
- **`resolveEditableDocument` is a live allowlist, not a router.** Anything it does not return a path for is silently unreachable by every text/crop/upload route — the handler just does nothing. That is the silent-no-op failure mode. Test your key mapping first, before wiring any UI.
- **`listingCardForGrid` (`scripts/dev-api-plugins.mjs`) is an allowlist, not a merge.** New fields need a `previous.*` fallback or they vanish on the *second* save. Do not touch it unless a Part 1 field is missing — `full` / `hoverDark` / `hoverImage` / `variants` are already handled.
- **A new field has to be threaded through six places** if you add one: client payload → server allowlist → server GET → client `ensureLoaded` → `src/lib/projects.ts` → **page mappers** (`index.astro` / `work.astro` / `play.astro`). Part 1 already has a live example of this bug (see below).
- **Astro `<script type="module">` is NOT bundled.** Relative imports 404 against the page URL. Use a plain `<script>`.
- **Astro scoped styles do not reach JS-created nodes.** Prefer `:global` / `is:global` for anything the client creates.
- **Never let a fallback be silent** in new dev-tooling paths — `console.warn` when you fall back.
- **Do not `git pull`** — branch sync may be running on the main checkout; your worktree is isolated.
- Name off-limits: do not edit content JSON; do not start work on #167 / Gallery Manager in this branch.

---

## First reads (by symbol — re-grep, do not trust old line numbers)

| File | Symbols / what to find |
| --- | --- |
| `src/lib/projects.ts` | `PlayLinkItem`, `getPlayGridItems`, `listingCardForGrid` (the TS one — includes `full`) |
| `src/pages/play.astro` | the two-shape map into `ProjectGridItem` — **project branch currently omits `full`** |
| `src/pages/index.astro`, `src/pages/work.astro` | correct mappers (pass `full`) — copy that pattern |
| `src/components/ProjectGrid.astro` | `editable`, `editAttrs` / `imageDevEditAttrs`, `variant !== 'play'` span chip, three chip rails, drop veils, `data-dev-play-link`, title-ink `metaStyle`, narrow `@media (max-width: 667px)` full-span rules |
| `src/components/DevProjectGridEditor.astro` | `enableCardEditing`, `enableAllCardEditing`, `disableAllCardEditing`, `ensureLoaded`, `syncPendingFor`, `buildListingPayload`, `applyListingPreview` (`grid !== 'play'` full toggle), `setSpanFull` (`grid === 'play'` early return), `input` handler (`closest('[data-dev-project-slug]')`), cover-drop → `applyCoverFileToCard` |
| `src/components/DevTextEditor.astro` | `PendingMediaChange` kind union, `vcd:dev-pending-upsert` allowlist, `performSave` kind filters + `/api/project-settings` loop |
| `scripts/dev-api-plugins.mjs` | `STATIC_EDITABLE_DOCUMENTS`, `resolveEditableDocument`, `resolveDevFieldTarget` (rejects empty `fieldPath`), listing-order writer already handles `type: 'play-link'` |
| `astro.config.mjs` | `resolvePathTarget`, `applyCropChange`, batch/crop path length checks (`!fieldPath.length`) |
| `src/components/DevGalleryReorder.astro` | `ListingOrderEntry` union, `captureOrder` (slug **or** play-link) |
| `src/lib/projectImageFrame.ts` | `imageDevEditAttrs` |

---

## Part 1 — project-backed play cards (small)

Everything except span already works on `/play` today for cards with a `slug`. Confirm by reading the three chip rails gated on `editable` before changing anything — if you find another gate, that is a real finding, report it.

### 1a. Enable span on `/play` — three gates, all now wrong

1. `ProjectGrid.astro` — `{variant !== 'play' && ( … span chip … )}`. Remove the condition (keep the chip).
2. `DevProjectGridEditor.astro` — `setSpanFull` returns early `if (grid === 'play')`. Remove that early return.
3. `DevProjectGridEditor.astro` — `applyListingPreview` toggles `project-grid__item--full` with `&& grid !== 'play'`. Remove the `grid !== 'play'` conjunct.

Why this is safe: `.project-grid__item--full { grid-column: span 2 }` is variant-agnostic, `.project-grid--play` is a two-column grid like the others, and `buildListingPayload` puts `full` in the shared `base` object before the play/`meta` vs work/`year` split — so it already persists correctly for play listings. Verify each of those claims by reading; if one is false, stop and report rather than working around it.

### 1b. Page mapper — `full` is missing on `/play` (settled finding)

`src/pages/play.astro` project branch does **not** pass `full: item.full`. Home and Work do. Without this, span saves to JSON then vanishes from the DOM after reload — the exact "works before reload, reverts after" class of bug from the handoff traps.

**Add `full: item.full` to the project branch of the play mapper.** Do not add `full` to the play-link branch.

### 1c. Responsive rules

At `@media (max-width: 667px)`, `.project-grid--work .project-grid__item--full` gets `grid-column: span 1`. There is no `--play` equivalent. Add `.project-grid--play .project-grid__item--full { grid-column: span 1; }` in that same block (parallel to work). Say so in the PR.

---

## Part 2 — play-link cards (the real work)

### 2a. Make play documents addressable — server side, first

`resolveEditableDocument` builds a map of `documentKey → relative file` from `STATIC_EDITABLE_DOCUMENTS` plus a `readdirSync` of `src/content/projects`. Play files are absent, so `/api/content-text`, `/api/content-batch`, `/api/upload`, and the crop routes are all dead ends for them.

Add a namespaced key so a play link can never collide with a project slug:

- Key form: **`play:{id}`** → `src/content/play/{id}.json`, built by a `readdirSync` of `src/content/play` mirroring the existing projects loop, with the same `try`/`catch` for a missing directory.
- Reject path traversal in `id` (`..`, `/`) the same way the listing-order writer already does for play-links.
- Namespacing matters: `design-system` could plausibly become a project slug later, and an unnamespaced collision would route edits to the wrong file with no error.

**Do this first.** Grep every caller of `resolveEditableDocument` (six+) for an assumption that the key is a project slug — e.g. code that then reads `data.listings` or `data.status`. A play document has neither. Each caller must tolerate the flat shape or refuse the key explicitly. **Refusing loudly is better than writing a `listings` object into a play file.**

Callers that are project-shaped (`/api/project-settings`, gallery membership seeding, draft-media publish-for-project, etc.) must **refuse** `play:*` keys with a clear error — do not let them mutate play JSON through the project writer.

### 2b. Inline title / meta editing

Split "editable" in `ProjectGrid.astro`:

- `projectEditable = isDev && Boolean(item.slug)` — existing full rail (all three chip groups, drop wiring, hover img host, settings).
- `linkEditable = isDev && Boolean(item.playLinkId)` — short rail only (crop chip + text hosts). Title/subtitle already render with `data-dev-project-title` / `data-dev-project-subtitle`; `(item.subtitle \|\| isDev)` already keeps the meta host present in dev.

Do **not** set `data-dev-cover-drop` / hover-empty veil / status / span / hover / settings from `linkEditable`. Cover **crop** attrs yes (Part 2c). Cover **file drop** for play-links is optional and entangled with `applyCoverFileToCard(slug, …)` / `ensureLoaded` — **skip drop for play-links in this branch** unless it falls out cleanly; crop-on-existing-image is enough.

`enableCardEditing` / `enableAllCardEditing` / `disableAllCardEditing` today require `dataset.devProjectSlug`. Widen to also select `[data-dev-play-link]` and enable title + subtitle only (no teaser label — play links have none).

Then the staging path. `ensureLoaded` fetches `/api/project-settings` and builds a project-shaped snapshot — none of which exists for a play link. **Do not** stretch that cache to cover both. Add a small parallel path:

- A second cache keyed by play-link id holding `{ title, meta }` read from the DOM (and optionally a tiny GET if you add one; DOM-only is fine for v1).
- Pending id `play-link:{id}`, kind `play-link`, payload `{ id, title, meta }`, with a `revert` that restores the DOM text — mirroring `syncPendingFor`'s contract exactly (`vcd:dev-pending-upsert` / `vcd:dev-pending-remove`), so the save bar treats it like any other pending edit.
- **`DevTextEditor.astro` must learn the new kind:** extend the `PendingMediaChange` kind union, the `vcd:dev-pending-upsert` allowlist, and `performSave` (filter + POST). Without this, upserts are silently ignored and Save never writes — the silent-no-op failure mode.
- Server side: add a small writer (e.g. `/api/play-link-settings`) that patches **only** `title` and `meta` in `src/content/play/{id}.json`. It must **not** rewrite the whole document — `order`, `image`, `bg`, `dark`, `href` are set elsewhere and by hand. Resolve the file via `resolveEditableDocument('play:' + id)` (or the same path join the listing-order writer uses). Refuse bad ids.

The `input` handler resolves `item.closest('[data-dev-project-slug]')`; branch it on which attribute the `<li>` carries and route to the right cache. Keep the two paths visibly separate in the code — a single polymorphic function here is how the project and play shapes will get confused later.

Also wire `vcd:dev-pending-committed` / `vcd:dev-pending-reverted` so the play-link cache's saved snapshot updates / restores, same as projects.

**Placeholders.** `data-placeholder` is already `'Meta'` for play, and `ensureSubtitleHost` picks `'Meta'` from `gridForItem`. Confirm both work for a link card — `gridForItem` walks up to `[data-dev-project-grid]`, which is on the `<ul>`, so it should. Read it, don't assume.

### 2c. Cover crop

For a play link: `documentKey: 'play:{id}'` and a path that means **document root** (image / variants live at the top level of the play JSON).

**Settled from reading current code:** `resolveDevFieldTarget`, crop/batch handlers in `astro.config.mjs`, and `applyCropChange` all reject `!fieldPath.length`. Empty `path: []` does **not** work today.

**In scope:** teach the crop/write path that an empty path (or an explicit documented sentinel — prefer empty path) means "the document root" (`resolvePathTarget` already returns `data` if the loop never runs — only the length guards block it). Touch every guard that rejects empty paths for crop/src writes; do **not** loosen text/spacing path rules unless they share the helper and still make sense.

Then in `ProjectGrid.astro` for `linkEditable`:

- `imageDevEditAttrs(true, { documentKey: 'play:' + id, path: [], cropId: 'play-link', variants: seedVariants, gridDefaultAspect: … })`
- `dev-image-edit-target` class
- crop chip only (end rail), no other chips

`PlayLinkItem` has no `variants` field today — `hasCropVariants` is false and the cover renders uncropped. That is the correct starting state. Confirm `normalizeImageVariants(undefined, …)` seeds sanely (already called for `seedVariants` on every card).

Reader (`getPlayGridItems` / `play.astro` mapper) must pass `variants` / `srcWidth` / `srcHeight` through when present; tolerate absence. Writer adds `variants` on first crop via the crop pipeline. **Do not** hand-edit play JSON or stage those files.

Also: `PlayLinkItem` type in `projects.ts` may gain optional `variants?`, `srcWidth?`, `srcHeight?` — optional only.

**If teaching empty-path-as-root proves genuinely structural** (e.g. breaks unrelated crop targets), **stop, ship Parts 1 and 2b, and report it.** Shipping title/meta editing without crop is a good outcome; a half-built crop path that silently no-ops is not.

**Out of this branch for play-links:** cover file-drop (`data-dev-cover-drop` / `applyCoverFileToCard`), hover image, hoverDark measurement.

### 2d. What play-link cards must NOT get

- **No visibility chip.** No `status` field.
- **No span chip.** `full` is not in `PlayLinkItem`.
- **No hover chip / hover veil / hoverDark.** No `hoverImage` in the schema.
- **No card-settings `⋮` chip.**
- **No "+ New page" behaviour change.** That creates projects; play links are added by hand.

The rail must simply be *shorter*, not disabled-looking. Do not render greyed-out chips.

### 2e. Do not break reorder

`DevGalleryReorder.astro` already reorders both kinds via `captureOrder`, which reads `data-dev-project-slug` **or** `data-dev-play-link`. Any change to the `<li>` attributes must keep both intact. Reorder on `/play` works today; a regression there is the most likely collateral damage from this branch. Call it out in the test script.

---

## Cleanup / lifecycle checklist

- [ ] `disableAllCardEditing` strips `contenteditable` from play-link cards too.
- [ ] The play-link pending entry is removed when the text returns to its saved value, same as `syncPendingFor` does.
- [ ] `vcd:dev-pending-reverted` restores play-link card text.
- [ ] `vcd:dev-pending-committed` updates the play-link cache's saved snapshot.
- [ ] Nothing added for a play-link card renders when `isDev` is false / `linkEditable` is false.
- [ ] Project-backed play cards still get the third (`⋮`) rail; play-links do not.
- [ ] `hoverDark` still round-trips on project listing saves (do not regress `listingCardForGrid` / `buildListingPayload` / page mappers).

---

## Verify — hand this to Anto (worker: put this in your report; do not run a browser)

**Step 0:** After merge / checkout of this branch, restart the dev session (`bun run dev:session:stop` then `bun run dev:session`) — middleware + stale transforms. Hard reload is not enough if `scripts/*.mjs` or the git ref moved.

Dev mode on, on `/play`:

1. **Project-backed card, full rail.** A `/play` card that is a real project shows visibility, span, crop, hover, and settings (`⋮`) chips. Click the span chip → frame and edge handle appear; drag → it goes full-width; Escape → exits. Save → reload → still full-width. *(Catches the `play.astro` `full` mapper bug.)*
2. **Play-link card, short rail.** Design System and Stoozing Playground show a crop chip (if 2c shipped) and nothing else — no visibility, span, hover, or settings chips, no greyed-out placeholders.
3. **Play-link title.** Click "Design System" → caret appears. Type. Save bar shows a pending change. Save → reload → new title persists. Check `src/content/play/design-system.json` still has its original `order`, `image`, `bg`, `dark`, `href`.
4. **Play-link meta.** Same on meta under Stoozing Playground (or Design System). Clearing it entirely should leave a clickable placeholder reading "Meta", not a collapsed 0×0 target.
5. **Play-link crop** (only if Part 2c shipped). Click the crop chip → tuner opens on that card's cover. Adjust → preview updates live. Save → reload → crop persists (`variants` appears in the play JSON).
6. **Reorder still works.** Drag a play-link card past a project card and back. Save → reload → order holds. *Not valid as a pass:* the handle appearing — actually complete a drop.
7. **Live site.** Dev mode off, reload `/play` → no chips, no carets, no outlines on any card. Design System still links to `/styles`; Stoozing Playground is still inert.

---

## Out of scope

- Migrating play links into `src/content/projects/` (explicitly rejected).
- Hover images / hoverDark for play links.
- Cover file-drop onto play-link cards (unless trivial).
- A "+ New play link" creation flow.
- Gallery Manager card parity (#167) — separate branch after this merges.
- Anything on Home or Work beyond what falls out of the shared component / the `full` mapper fix on play.

---

## Report shape (auditable)

Do not report "done" / "matches spec". For each claim below, say what you read or ran and what you found:

1. Parent commit of your branch (must be current `main`).
2. Part 1 gates removed (list the three sites + the `play.astro` `full` line).
3. `resolveEditableDocument('play:design-system')` resolves (how you verified — unit-style import or reading the map builder).
4. Which `resolveEditableDocument` callers refuse `play:*` vs accept it.
5. Whether Part 2c shipped empty-path-as-root, or stopped — and why.
6. Exact paths passed to `commit:engine`.
7. `bun run build` exit code (compilation only).

---

## Pickup

Read this file. Confirm your worktree branches from current `main`, not an older feature branch. Summarise the plan back in five or six lines, then implement Part 1, then 2a (**before any play-link UI**), then 2b (including DevTextEditor kind wiring), then 2c. Do not replan. If 2c hits the structural wall, ship without it and say so plainly.
