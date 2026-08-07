# Play cards: per-kind dev affordances

**Issue:** [#171](https://github.com/vcruzdesigns/VCDwebsite/issues/171) — `enhancement` / `gallery pages` / milestone `v2`
**Branch:** `feat/play-card-parity` off latest `main`
**Executor:** Sonnet in a worktree. **Not Haiku** — this adds a second document kind to the dev-editing pipeline; the failure mode is a silent no-op, not a crash.

**Sequencing:** land *after* `feat/gallery-cover-chips` (#174/#175/#176) merges, and rebase onto it. Both branches edit `ProjectGrid.astro`'s chip rails and `DevProjectGridEditor.astro`'s handlers. Running them in parallel guarantees a conflict in the exact hunks that matter.

---

## Done when

On `/play`, in dev mode:

- Cards backed by a project (`src/content/projects/*.json` with a `listings.play`) have the **same** rail as Home and Work: visibility chip, span chip, crop chip, hover chip, and click-to-edit title and meta.
- Cards backed by a play link (`src/content/play/*.json`) have the rail they *can* have — click-to-edit title and meta, and cover crop — with no visibility chip and no span chip, and nothing on the card implies those exist.
- Neither kind leaks any of it to the live site.

---

## The root question, already answered

#171 asks whether play entries are genuinely a different thing or projects in a different grid. They are genuinely different, and **Anto's decision is: degrade per card, no content migration.**

The evidence, so you do not re-derive it:

- `getPlayGridItems` (`src/lib/projects.ts:203`) concatenates `getProjectGridListings('play')` with a glob over `src/content/play/*.json`, sorted by a shared `order`.
- `PlayLinkItem` (`src/lib/projects.ts:60`) is flat: `id, order, title, meta, image, bg, dark, href`. No `status`, no `listings`, no `teaser`, no `variants`.
- `src/pages/play.astro` maps the two shapes into `ProjectGridItem`, giving links a `playLinkId` and projects a `slug`.
- `ProjectGrid.astro:86` — `const editable = isDev && Boolean(item.slug)`. **That single line is why the whole rail is absent for links**, and (because it also gates nothing else on `variant`) it is *not* why project-backed play cards are missing chips. Read carefully: project-backed play cards already get both rails today. What they are actually missing is only the span chip, gated separately at line 251 by `variant !== 'play'`.

So the work splits cleanly in two, and the first half is much smaller than the issue implies.

---

## Executor landmines

- **Bun is not on `PATH`.** Use `$HOME/.bun/bin/bun`.
- **Do not start a dev server.** Port 4321 is owned by another session. You cannot verify in a browser. A green build proves compilation only.
- **Commit via `bun run commit:engine "msg" <explicit paths>`.** Never stage `src/content/**` — including the play JSON. If a schema field needs to exist in `src/content/play/*.json` for your code to run, **do not add it**: write the reader to tolerate its absence, and note in the PR that Anto adds it through the editor.
- **`resolveEditableDocument` is a live allowlist, not a router.** Anything it does not return a path for is silently unreachable by every text/crop/upload route — the handler just does nothing. That is the silent-no-op failure mode. Test your key mapping first, before wiring any UI.
- `contentHmrGate` means writes never reload the page. Every change must be reflected into the DOM by your own code.

---

## First reads

| File | Why |
| --- | --- |
| `src/lib/projects.ts:60-70, 203-221` | `PlayLinkItem`, `getPlayGridItems` |
| `src/pages/play.astro` | the two-shape map into `ProjectGridItem` |
| `src/components/ProjectGrid.astro:73-95` | `editable`, `editAttrs`, `imageDevEditAttrs` |
| `src/components/ProjectGrid.astro:180-273` | the `<li>`, `data-dev-play-link`, both chip rails |
| `src/components/DevProjectGridEditor.astro:139-228` | `gridItemForSlug`, `enableCardEditing`, `enableAllCardEditing` |
| `src/components/DevProjectGridEditor.astro:397-439` | `ensureLoaded` — the project-shaped cache |
| `src/components/DevProjectGridEditor.astro:998-1021` | the `input` handler that stages inline text |
| `scripts/dev-api-plugins.mjs:111-131` | `STATIC_EDITABLE_DOCUMENTS`, `resolveEditableDocument` |
| `scripts/dev-api-plugins.mjs:1010-1090` | the listing-order writer — **already** handles `type: 'play-link'` and writes `src/content/play/{id}.json`. This is your precedent. |
| `src/components/DevGalleryReorder.astro:17-19, 51-58` | the `ListingOrderEntry` union — the established shape for "project or play-link" |

---

## Part 1 — project-backed play cards (small)

Everything except span already works on `/play` today. Confirm that by reading `ProjectGrid.astro:209-273` before changing anything — if you find another gate, that is a real finding, report it.

**Enable span on `/play`.** Three gates, all deliberate-looking, all now wrong:

1. `ProjectGrid.astro:251` — `{variant !== 'play' && ( … span chip … )}`. Remove the condition.
2. `DevProjectGridEditor.astro:534` — `setSpanFull` returns early `if (grid === 'play')`. Remove.
3. `DevProjectGridEditor.astro:309` — `applyListingPreview` toggles `project-grid__item--full` with `&& grid !== 'play'`. Remove.

Why this is safe: `.project-grid__item--full { grid-column: span 2 }` (line 300) is variant-agnostic, `.project-grid--play` is a two-column grid like the others, and `buildListingPayload` (line 247) puts `full` in the shared `base` object before the play/`meta` vs work/`year` split — so it already persists correctly for play. Verify each of those four claims by reading; if one is false, stop and report rather than working around it.

**Check the responsive rules.** `ProjectGrid.astro:554-573` has `.project-grid--work .project-grid__item--full` overrides at `max-width: 667px` but no `--play` equivalent, and `.project-grid--play .project-grid__cover` is in that same block for aspect ratio only. A full-width play card at narrow widths may need the same `grid-column: span 1` treatment work gets. Add it if the pattern is genuinely parallel; say so in the PR either way.

---

## Part 2 — play-link cards (the real work)

### 2a. Make play documents addressable — server side, first

`resolveEditableDocument` (`scripts/dev-api-plugins.mjs:119`) builds a map of `documentKey → relative file` from `STATIC_EDITABLE_DOCUMENTS` plus a `readdirSync` of `src/content/projects`. Play files are absent, so `/api/content-text`, `/api/content-batch`, `/api/upload`, and the crop routes are all dead ends for them.

Add a namespaced key so a play link can never collide with a project slug:

- Key form: **`play:{id}`** → `src/content/play/{id}.json`, built by a `readdirSync` of `src/content/play` mirroring the existing projects loop, with the same `try`/`catch` for a missing directory.
- Namespacing matters: `design-system` could plausibly become a project slug later, and an unnamespaced collision would route edits to the wrong file with no error.

**Do this first and verify it in isolation** — a `curl` against `/api/content-text` with `document: "play:design-system"` (dev server is Anto's to run, so either ask him for this one check or assert it via `bun run test:publish`-style throwaway if a harness exists). Do not build UI on top of an unverified mapping.

Also check every other caller of `resolveEditableDocument` (there are six; grep it) for an assumption that the key is a project slug — e.g. code that then reads `data.listings` or `data.status`. A play document has neither. Each caller must tolerate the flat shape or refuse the key explicitly. **Refusing loudly is better than writing a `listings` object into a play file.**

### 2b. Inline title / meta editing

`enableAllCardEditing` (`DevProjectGridEditor.astro:209`) selects `[data-dev-project-slug]`. Play-link `<li>`s carry `data-dev-play-link` instead (`ProjectGrid.astro:184`). Widen the selector to both.

Then the staging path. `ensureLoaded` (~397) fetches `/api/project-settings` and builds a project-shaped snapshot (`status`, `listings[grid]`, `teaser`) — none of which exists for a play link. **Do not** stretch that cache to cover both. Add a small parallel path:

- A second cache keyed by play-link id holding `{ title, meta }` read from the DOM plus whatever a `GET` gives you.
- Pending id `play-link:{id}`, kind `play-link`, payload `{ id, title, meta }`, with a `revert` that restores the DOM text — mirroring `syncPendingFor`'s contract exactly (`vcd:dev-pending-upsert` / `vcd:dev-pending-remove`), so the save bar treats it like any other pending edit.
- Server side: the writer patches only `title` and `meta` in `src/content/play/{id}.json`. It must **not** rewrite the whole document — `order`, `image`, `bg`, `dark`, `href` are set elsewhere and by hand.

The `input` handler at ~998 resolves `item.closest('[data-dev-project-slug]')`; branch it on which attribute the `<li>` carries and route to the right cache. Keep the two paths visibly separate in the code — a single polymorphic function here is how the project and play shapes will get confused later.

**Placeholders.** `data-placeholder` is already `'Meta'` for play (`ProjectGrid.astro:160`) and `ensureSubtitleHost` (~174) picks `'Meta'` from `gridForItem`. Confirm both work for a link card — `gridForItem` walks up to `[data-dev-project-grid]`, which is on the `<ul>`, so it should. Read it, don't assume.

### 2c. Cover crop

`editAttrs` comes from `imageDevEditAttrs` (`ProjectGrid.astro:87`) with `documentKey: item.slug!` and `path: ['listings', variant]`. For a play link that becomes `documentKey: 'play:{id}'` and `path: []` — the image fields sit at the document root.

Two things to establish **before** wiring the chip, in this order:

1. Does the crop write path accept a root-level `path`? Read the handler and the `variants` write. If `path: []` is not supported, adding support is in scope; faking a wrapper object is not.
2. `PlayLinkItem` has no `variants` field, so `hasCropVariants(item.variants)` is false and the cover renders uncropped. That is the correct starting state — a crop is only created once you make one. Confirm `normalizeImageVariants(undefined, …)` seeds sanely (it is already called unconditionally at line 85 for the `seedVariants` path).

**If either turns out to need a schema change to `src/content/play/*.json`, that is fine** — the *reader* must tolerate the field's absence, and the *writer* adds it on first crop. What you must not do is hand-edit the play JSON to add it, or stage those files.

**If (1) proves genuinely structural** — the crop pipeline is welded to `listings[grid]` in a way that cannot take a root path without a rewrite — then **stop, ship Parts 1 and 2b, and report it.** Shipping title/meta editing without crop is a good outcome; a half-built crop path that silently no-ops is not. Anto would rather have the smaller thing and a clear note.

### 2d. What play-link cards must NOT get

- **No visibility chip.** There is no `status` field, and published/draft/teaser has no meaning for a link. Do not synthesise one.
- **No span chip.** `full` is not in `PlayLinkItem` and play links are decorative entries, not features.
- **No hover chip.** No `hoverImage` in the schema. Out of scope for this branch.
- **No "+ New page" behaviour change.** That creates projects; play links are added by hand.

The rail must simply be *shorter*, not disabled-looking. Do not render greyed-out chips.

### 2e. Do not break reorder

`DevGalleryReorder.astro` already reorders both kinds via `captureOrder`, which reads `data-dev-project-slug` **or** `data-dev-play-link` (lines 51-58). Any change to the `<li>` attributes must keep both intact. Reorder on `/play` works today; a regression there is the most likely collateral damage from this branch. Call it out in the test script.

---

## Cleanup / lifecycle checklist

- [ ] `disableAllCardEditing` strips `contenteditable` from play-link cards too (it selects `[data-dev-project-slug]` today — widen it in the same place you widen `enableAllCardEditing`).
- [ ] The play-link pending entry is removed when the text returns to its saved value, same as `syncPendingFor` does.
- [ ] `vcd:dev-pending-reverted` restores play-link card text.
- [ ] `vcd:dev-pending-committed` updates the play-link cache's saved snapshot.
- [ ] Nothing added to `ProjectGrid.astro` renders for a play-link card when `isDev` is false.

---

## Verify — hand this to Anto

Dev mode on, on `/play`.

1. **Project-backed card, full rail.** A `/play` card that is a real project shows visibility, span, crop, and hover chips. Click the span chip → frame and edge handle appear; drag → it goes full-width; Escape → exits. Save → reload → still full-width.
2. **Play-link card, short rail.** Design System and Stoozing Playground show a crop chip and nothing else. No visibility chip, no span chip, no greyed-out placeholders.
3. **Play-link title.** Click "Design System" → caret appears. Type. Save bar shows a pending change. Save → reload → new title persists. Check `src/content/play/design-system.json` still has its original `order`, `image`, `bg`, `dark`, `href`.
4. **Play-link meta.** Same on "Coming Soon" under Stoozing Playground. Clearing it entirely should leave a clickable placeholder reading "Meta", not a collapsed 0×0 target.
5. **Play-link crop** (only if Part 2c shipped). Click the crop chip → tuner opens on that card's cover. Adjust → preview updates live. Save → reload → crop persists.
6. **Reorder still works.** Drag a play-link card past a project card and back. Save → reload → order holds. *Not valid as a pass:* the handle appearing — actually complete a drop.
7. **Live site.** Dev mode off, reload `/play` → no chips, no carets, no outlines on any card. Design System still links to `/styles`; Stoozing Playground is still inert.

---

## Out of scope

- Migrating play links into `src/content/projects/` (explicitly rejected).
- Hover images for play links.
- A "+ New play link" creation flow.
- Anything on Home or Work beyond what falls out of the shared component.
- The chip-reveal behaviour itself (#174) — that lands on `feat/gallery-cover-chips`; this branch rebases onto it and inherits it.

---

## Pickup

Read this file and the *First reads* table. Confirm your worktree branches from the merged `feat/gallery-cover-chips`, not bare `main`. Summarise the plan back in five or six lines, then implement Part 1, then 2a (**verified in isolation before anything else**), then 2b, then 2c. Do not replan. If 2c hits the structural wall described above, ship without it and say so plainly.
