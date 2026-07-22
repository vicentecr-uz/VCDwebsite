# VCDwebsite — Claude Instructions

> This file is the single source of truth for project context. All memory is kept here, in the repo.

## Project
Astro + Bun + Tailwind CSS v4 + GSAP portfolio site for Vicente Cruz (industrial designer, London). Rebuilding vcruzdesigns.com as an independent site.

Vicente Cruz is a UAL: CSM graduate, currently Junior Industrial Designer at Kingfisher. He references the live Webflow site frequently for design decisions and has a strong design eye — precise aesthetic calls on font weight, letter spacing, spacing systems, and transitions.

## Key conventions
- Spacing unit: `1em` consistently across header, grid, footer, gaps — use inline `style=` not Tailwind arbitrary values for guaranteed rendering
- Font: Hanken Grotesk (Google Fonts, weights 300–900)
- Background: `#ffffff`
- Bun path: `$HOME/.bun/bin/bun` (not on PATH)
- Dev server: port 4321
- **Dev session:** `bun run dev:session` starts Astro dev server (port 4321); `dev:session:stop` / `dev:session:status`. One Cursor chat owns the session — reuse servers, don't duplicate. See `.cursor/rules/dev-session.mdc`.
- **Local CMS:** Open `http://localhost:4321/admin` in any browser — in dev, `admin.astro` loads **Decap CMS** (not Sveltia) with `local_backend: true`, talking to the `decap-server` proxy on port 8081 that `dev:session` starts. "Publish" writes directly to the local content files on disk (no git commit, no push); Astro HMR picks them up instantly. Changes only go live after you manually commit and push to `main`. (Decap is used locally instead of Sveltia because Sveltia's local workflow needs the Chromium-only File System Access API; Decap's HTTP proxy works in any browser, e.g. Zen/Firefox.)
- **Deployment:** Cloudflare Pages auto-deploys on every push to `main` — live at `wip.vcruzdesigns.com` within ~30s. No manual deploy step needed. Production CMS at `wip.vcruzdesigns.com/admin` loads **Sveltia CMS** (the prod build, via `import.meta.env.DEV` in `admin.astro`) with GitHub PKCE auth via Cloudflare Worker.
- Page transitions: GSAP fades `#transition-overlay` (starts opaque; fades out once viewport-visible images + fonts are ready, min 0.5s hold / max 4s wait; fades in on navigation). CSS 5s safety-net reveal if JS fails.
- Max page width: fluid gutter via `#site-wrapper { padding-inline: max(1em, calc((100% - 60em) / 2)) }` — gutter holds at 1em until viewport exceeds 62em, then grows to keep content at 60em max

## Dev authoring (local only)

Two ways to edit content on disk in dev — both write the same JSON under `src/content/`, but behave differently:

| | **In-page editor** | **Decap CMS** (`/admin`) |
|--|---------------------|--------------------------|
| Where | On the live page (dev mode toggle) | Separate admin UI |
| Best for | Visual tweaks — inline text, crops, spacing, grid order | Structural/bulk edits |
| UI update on save | **No page flash** — DOM already shows your edits | May trigger Astro/Vite HMR reload |

### In-page editor flow

1. **Turn on dev mode** — `DevModeController` adds `is-dev-mode` to `<html>`; edit controls appear.
2. **Edit in the browser DOM** — text fields become `contenteditable`; image/grid/caption tuners preview changes live. Components carry `data-dev-*` attributes mapping DOM nodes to JSON paths (e.g. `sections[12].paragraphs` in `tapico.json`).
3. **Dirty / pending state** — `DevTextEditor.astro` tracks unsaved text, spacing, and media edits. Image tuners queue changes via `vcd:dev-pending-upsert` until Save.
4. **Save** — POST to dev-only API routes in `astro.config.mjs` (`/api/content-text`, `/api/content-spacing`, `/api/content-batch`, `/api/content-section`, etc.). Handlers call `writeDevDocument()` in `scripts/dev-api-plugins.mjs`, which patches the JSON file on disk.
5. **No flash on Save** — `suppressContentHmr()` + `contentHmrGate` (`scripts/content-hmr-gate.mjs`) block Vite full-reloads and module invalidation for ~2.5s after API writes. The page already looks correct; Save only persists to disk. `vcd:dev-pending-committed` syncs client “saved” state in tuners. **Do not assume Save triggers HMR** for in-page edits.
6. **Reload without Save** — unsaved DOM edits are lost (warning shown if dirty).

### Lifecycle

- **Unsaved** = DOM only (what you see while editing)
- **Saved** = JSON on disk (survives reload)
- **Committed/pushed to `main`** = production deploy

No auto-save, no git commit on Save.

### Key files (agents: read these for editor bugs)

- `src/components/DevTextEditor.astro` — text/spacing save bar, section insert/delete, pending media batch
- `src/components/DevModeController.astro` — dev mode toggle
- `src/components/project/ProjectImage*Tuner.astro` — crop, grid, caption pending edits
- `scripts/dev-api-plugins.mjs` — `readDevDocument` / `writeDevDocument`, `suppressContentHmr` on every write
- `scripts/content-hmr-gate.mjs` — suppresses full-reload WS + `handleHotUpdate` for `src/content/**` during API writes

### Text save caveat

Body-text fields read `<p>` children first; if the browser puts typed text outside `<p>` (e.g. after clearing a field), `readParagraphsValue` also checks other block children and inline content in the field — **only at Save time**, without rewriting the DOM while typing.

## Scope
What belongs in this repo: work that is **the site itself** — IA, global layout, deploy, nav, and integration of other work (routes, embeds, links, how a tool sits inside vcruzdesigns.com). What does **not** belong here: tasks inside another repo's product (calculator logic, chart bugs, Stoozing HTML layout, AutoSpeedTest features) — those stay in that project's own notes. Gray line: if the issue is the site shell (iframe sizing, Astro page grid, site chrome breaking mobile), it's here; if it's Stoozing's own layout/CSS in `stoozing-playground.html`, it's Stoozing Playground.

Open tasks are tracked in [GitHub Issues](https://github.com/vcruzdesigns/VCDwebsite/issues).

**When opening a GitHub issue:** always assign a relevant label and milestone. If it's unclear which label or milestone applies, ask Anto before filing.

**When committing and pushing:** only stage and commit changes made within the current chat session. Do not bundle in unrelated unstaged changes from other sessions — leave those untouched for Anto to handle separately.

## Implementation notes

### Signed-off components
Use **only** components and patterns listed on `/styles` (Component library). When copying content from old project pages or Webflow, do not reach for legacy case-study markup in `src/components/project/legacy/`.

**Tapico** (`/tapico`) — case-study components (build each as a reusable primitive for future projects):
- `ProjectLayout`, `ProjectImage`, `ProjectImageGrid`, `ProjectBodyText`, `ProjectSectionTitle`
- `ProjectPressQuoteTicker`, `ProjectRedditCommentCarousel`

**Home / Work / Play** — `ProjectGrid` (`src/components/ProjectGrid.astro`):
- Cover-card listing grid; project cards from `listings` on each `src/content/projects/{slug}.json`
- Play also includes non-project links from `src/content/play/*.json`
- `variant`: `home` | `work` | `play` (breakpoint and featured-row presets)
- Dev mode: grid management via `DevProjectGrid` (+ New page, ⋯ settings) — see project `status` field

**Project pages** — dynamic route `src/pages/[slug].astro` for `stack: "modern"` projects:
- Content in `src/content/projects/{slug}.json` (`sections[]`, `outline`, `listings`, `status`)
- `status`: `published` | `draft` | `teaser` — controls public visibility and build output
- Draft images: `draft:{slug}/file.jpg` in JSON → `src/content/drafts/media/` (dev); auto-promoted to `public/images/` when project settings are saved as `published` or `teaser`
- Dev mode: drag-and-drop images (`DevImageDrop`), text/spacing editors, crop/grid tuners

**Legacy (do not copy):** `src/components/project/legacy/` holds Webflow-migration components (`LegacyProjectGrid`, `LegacyProjectProse`, etc.) used only by old routes. `LegacyProjectGrid` is case-study media clusters — not the same as site `ProjectGrid` listings.

Ask before introducing anything not on `/styles`.

### About page
Three-state responsive layout with GSAP Flip animations on breakpoint transitions:
- **Wide (≥50em):** photo 3/4 (17em col) left, Contact+About+Experience stacked in right col
- **Medium (40–50em):** photo 1:1 (17em) + Contact top row; About+Experience span full width below
- **Narrow (<40em):** single column, photo 1:1 full-width → Contact → About → Experience
- Photo `object-position: 50% 35%` in square crop for headroom; `50% 50%` in portrait
- GSAP Flip animates element repositioning; photo height wipe + object-position animated separately
- Bio `max-width: 38em`; noscript CSS media query fallback for all states
