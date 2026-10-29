# Unify gallery cards — one project-card engine (#193)

**Issue:** [#193](https://github.com/vcruzdesigns/VCDwebsite/issues/193)  
**Branch:** `feat/unify-gallery-cards` off latest `main` (after #167 / PR #191)  
**Worker:** Composer 2.5 Fast in a **worktree**. Confirm parent is `main` tip with #167 merged.  
**Out of scope:** [#192](https://github.com/vcruzdesigns/VCDwebsite/issues/192) URL demotion after Public→Teaser/Draft (log only — do not implement).

---

## Done when

1. Home / Work / Play galleries only render **project** cards (no play-link merge).
2. Design System is a project on Play, full chip rail, opens `/styles`, appears in Gallery Manager.
3. Teaser = visibility only: **no blur**, hover chip works, same cover/year/meta as Public; View mode card is **not a link**; Edit still full rail.
4. Status menu labels/order: **Public** → **Teaser** → **Draft** (internal value for Public stays `published`).
5. Opening/adjusting crop does **not** trip the browser leave dialog while crop UI is open (`is-dev-crop-open`).
6. Stoozing playground project JSON has `listings.play.dark: true` (black cover → on-dark ink).
7. `bun run build` exits 0.

---

## Root cause (settled — do not re-derive)

Play used a second card type (`src/content/play/*.json` + `getPlayGridItems`). Teaser added blur / hide-hover / teaser-label chrome. Product decision 2026-08-07: one engine; teaser is only visibility.

---

## First reads

- `src/lib/projects.ts` — `PlayLinkItem`, `getPlayGridItems`, `listingCardForGrid`, `ProjectListingCard`
- `src/pages/play.astro` — `isLink` branch
- `src/components/ProjectGridItem.astro` — `linkEditable`, status menu, `isTeaser` hover chip gate
- `src/components/ProjectGrid.astro` — `.project-grid__card--teaser` blur rules
- `src/components/DevProjectGridEditor.astro` — `hoverChip.hidden = isTeaser`, play-link caches
- `src/components/DevGalleryPages.astro` — teaser fill / hover hide
- `src/components/DevTextEditor.astro` — `beforeunload` (~3032)
- `src/content/play/design-system.json` — migrate away

---

## Change list

### A. Listing optional `href` (Design System → `/styles`)

1. On `ProjectListingCard` / grid listing types, allow optional `href?: string`.
2. `listingCardForGrid`:  
   - View teaser (`!dev && status === 'teaser'`): `href` stays `undefined` (unclickable).  
   - Else: `href = listing.href ?? \`/${project.slug}\``.  
3. Thread `href` through page mappers (`play.astro`, and home/work if they field-map — keep allowlist complete).  
4. `listingCardForGrid` allowlist / `listingCardForGrid` in `dev-api-plugins.mjs` — **previous.href fallback** so the field survives a second save (same trap as `hoverDark`).

### B. Teaser = visibility only

1. **CSS:** Remove blur filters on `.project-grid__card--teaser` (and the touch media duplicate). Keep non-link / `cursor: not-allowed` if that is how View teasers read; do not blur images.
2. **`listingCardForGrid`:** Pass through `hoverImage` / `hoverDark` for teasers (stop stripping). Prefer `listing.image` as cover (keep `teaser.coverImage` only as fallback if already wired — do not invent new teaser chrome).
3. **Stop forcing teaser-label as the Play subtitle.** Play uses `listing.meta` / year like Public. Do not require a separate teaser-label row for teasers on Play. Home/work may still have teaser-label markup historically — prefer year/meta only if removing teaser-label is a small delete; if tangled, leave the node but do not hide hover or blur.
4. **`DevProjectGridEditor.applyListingPreview`:** Do **not** hide hover chip for teasers; do not strip `--has-hover` solely because status is teaser.
5. **`DevGalleryPages` fill:** Same — do not `hoverBtn.hidden = isTeaser` for that reason; still convert card to non-`<a>` when teaser in View semantics as today for on-page cards.
6. Meta always-visible for teasers in View can stay (`opacity: 1` on teaser meta) — optional; if it fights hover-title behaviour, prefer matching Public cards.

### C. Status menu

In `ProjectGridItem.astro` (and any syncStatusChip / DevProjectGridEditor status option lists):

```
Public   → data-dev-status-option="published"
Teaser   → teaser
Draft    → draft
```

Order exactly that. Label **Public**, not Published. Keep internal `published` key.

### D. Kill play-links on galleries

1. Create `src/content/projects/design-system.json` from current play-link fields:
   - `status: "published"`, `stack: "modern"`
   - `listings.play`: order/title image/bg/`dark: true`/`href: "/styles"` / meta as today
   - Minimal stub `sections` (one sectionTitle + empty body) so the document is valid — card never needs the stub if href is `/styles`
2. Delete `src/content/play/design-system.json`.
3. `getPlayGridItems()` → become `getProjectGridListings('play')` (or alias). Remove play-link glob merge.
4. Simplify `play.astro` — delete `isLink` branch.
5. Remove play-link-only UI paths that would 404 or no-op: `playLinkId` / `linkEditable` in `ProjectGridItem`, play-link caches + event handlers in `DevProjectGridEditor`, `DevTextEditor` save kind `play-link` + `/api/play-link-settings` wiring **if** nothing else calls them. Prefer delete dead API + `playLinkSettingsDevWriter` from `astro.config.mjs` rather than leave orphans.
6. `DevGalleryReorder` / listing-order writer: keep `play-link` type handling only if needed for old pending payloads; otherwise remove. Reorder must still work for project slugs on Play.
7. Empty `src/content/play/` is fine (delete dir files; leave folder or remove glob safely).

**Content + engine in one commit is allowed** for this migration — say so in the commit message.

### E. Crop leave UX

In `DevTextEditor` `beforeunload`:

```js
if (document.documentElement.classList.contains('is-dev-crop-open')) return;
```

Do not remove pending crop staging — only suppress the dialog while the crop UI owns the session.

### F. Stoozing ink

If `src/content/projects/stoozing-playground.json` exists in the worktree, set `listings.play.dark: true`. If missing, create/skip per tree — main checkout may have a local uncommitted copy; in the worktree ensure the file exists with teaser + dark true + black-token cover + meta "Coming soon".

---

## Landmines

- Bun: `bun`
- **Do not start a dev server**
- `commit:engine` with **explicit paths** — for the content migration, either one `commit:engine` that includes project JSON **and** deleted play JSON (script may refuse content — if it refuses, use a single git commit that stages engine + the migration content paths together with a message that says schema/content migration, after staging explicitly). Prefer: try `commit:engine` for engine files; if content must ship in the same PR, `git add` the content paths and `git commit` once with both, noting the exception.
- `listingCardForGrid` in API is an allowlist — `href` needs `previous.*` fallback
- Page mappers must pass new fields
- Plain `<script>`, not `type="module"`
- Scoped CSS: card styles in `ProjectGrid` are already `is:global` after #167 — do not re-scope
- Off-limits: unrelated dirty content (Tapico/conic), `.agents/`, skills lockfiles

---

## Do NOT touch

- #192 routing/SEO omit for teaser/draft beyond what already exists
- #167 behaviour (template clone) except teaser/play-link call sites
- Renaming the `published` status key in JSON/API

---

## Verify (worker: build only)

```bash
bun run build
```

Exit 0. Grep: no `getPlayGridItems` play-link merge; no `.project-grid__card--teaser .project-grid__img { filter: blur`; status menu order Public/Teaser/Draft; `is-dev-crop-open` in beforeunload.

---

## Commit

Message shape:

```
feat(gallery): one project-card engine — teaser visibility, kill play-links (#193)

Design System is a project card (href /styles). Teaser drops blur/hide-hover.
Status UI: Public → Teaser → Draft. Suppress leave dialog while crop open.
```

Paths: list every engine file + content migration files.

---

## Pickup

Read this file. Confirm branch parent. Summarise in 6 lines. Implement A→F. Do not replan. Report auditable: parent SHA, href wiring, play-link removal proof (grep), build exit code, commit SHA.
