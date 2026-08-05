# VCDwebsite — Claude Instructions

> This file is the single source of truth for project context. All memory is kept here, in the repo.

## Project
Astro + Bun + Tailwind CSS v4 + GSAP portfolio site for Vicente Cruz (industrial designer, London). Rebuilding vcruzdesigns.com as an independent site.

Vicente Cruz is a UAL: CSM graduate, currently Junior Industrial Designer at Kingfisher. He references the live Webflow site frequently for design decisions and has a strong design eye — precise aesthetic calls on font weight, letter spacing, spacing systems, and transitions.

## Key conventions
- **Git branches:** New features and fixes start on a **new branch off latest `main`** (`git switch -c feat/…`). **Do not implement on `main`** unless Anto explicitly says to. Branch before the first edit — do not wait to be told. After a PR merges, switch back to `main` and **delete the feature branch** (remote + local) so old branches do not pile up — see `.cursor/rules/git-workflow.mdc` and Atlas `standards.md` → *Git — Delete merged feature branches* / *Git — VCDwebsite feature branches*.
- Spacing unit: `var(--space-unit)` consistently across header, grid, footer, gaps — `1rem` at every breakpoint, stepping down to `0.75rem` below `40em` (phones). Defined in `global.css`; use it rather than a literal `1em`. Use inline `style=` not Tailwind arbitrary values for guaranteed rendering
- Mobile breakpoint: `40em` (640px) — where `--space-unit` tightens and the header (wordmark, menu links, logo) steps down via `--header-wordmark-size` / `--header-menu-link-size` / `--header-logo-size`
- Font: Hanken Grotesk (Google Fonts, weights 300–900)
- Background: `--color-bg` (`#ffffff`). Every surface meant to read as "the page" — page background, header background (`.site-header__bg`), nav menu panel background and its menu backdrop — must reference this one token, never a literal white. They are stacked and expected to blend seamlessly, so when dark mode lands they have to move together.
- **Viewport height units:** Never use raw `svh` (or `vh`) for a height constraint that matters visually — Microsoft Edge on iOS doesn't reliably honor `svh`, letting it track the address bar's show/hide mid-scroll and shove blocks below it up/down (see issue #96). Use the shared helper `src/lib/safeVh.ts` (`bindSafeVh()` in `Layout.astro`), which sets a JS-computed `--vh-safe` custom property once on load and only recomputes it on a genuine width change (never on the height-only resize an iOS toolbar toggle fires). Keep `svh` only as the pre-JS/no-JS fallback: `calc(var(--vh-safe, 1svh) * N)`. Do not re-implement this per component.
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

No auto-save. **Save** never commits; **Save & Publish** does — see below.

### Save vs Save & Publish

The save bar has two buttons:

- **Save** — disk only, unchanged behaviour. Use when the edit should sit locally until it's committed by hand.
- **Save & Publish** — saves, then commits the content surface to `main` and pushes. Cloudflare deploys ~30s later.

Content always lands on `main`, but **you don't have to be standing there**. From a feature branch the commit is built against `main` and pushed; your checkout, your index, and your branch are untouched.

What gates Publish is whether the branch changes **content-rendering code**, not which branch you're on:

- No rendering changes → Publish works, from any branch.
- Rendering changes present → the bar shows an amber ⚠ naming the files, Publish steps down to an outline, and clicking it asks you to confirm before going ahead.

The reason for the gate: content and the engine that renders it are versioned separately, and only the engine travels through the branch. A content edit that depends on an unmerged feature breaks the live site **silently** — there's no schema, and `ProjectSections.astro` dispatches on `section.type` through an `if` chain ending in `return null`, so an unknown section type just vanishes and an unknown field is ignored.

The check is deliberately **branch-level**, not field-level. A per-field check (feature manifest, static analysis of `main`'s renderer) fails **open** — one unregistered field silently permits a breaking publish. This fails closed, and the override covers the false positives, because you know whether you just used a new toggle and the check can't. **Don't re-litigate this without a new reason.**

Implementation is `scripts/dev-publish.mjs` (`publishDevWriter()`, registered in `astro.config.mjs`):

- `RENDERING_PATHS` is the gate's path list. A stale list fails **open**, so err towards adding a path when you add a component.
- `GET /api/publish` → `{ branch, files, canPublish, onPublishBranch, rendersContent, renderingFiles }`; the save bar polls it on load and on dev-mode entry.
- `files` means **unpublished**, `behind` means **`main` moved and this branch hasn't picked it up**. Both differ from `main`; only the first is yours to publish. A file you haven't touched since you last published or branched is `behind` — offering to publish it would revert whatever landed on `main`. `behind` shows in the branch-label tooltip, not the change count.
- `.git/vcd-last-publish.json` records `path → blob sha` for everything this checkout has published. It's what lets the staleness guard tell **our own** last publish from a foreign one — without it, publishing twice from the same branch fails the second time, because `main` carries a commit the branch's merge base predates. Local, never committed.
- `POST /api/publish` (`{ manifest, force }`) → on `main`, stages **only** `src/content` + `public/images` and commits in place; it refuses if anything outside that surface is already staged. Off `main`, it builds the commit with plumbing against a scratch index (`read-tree` from `origin/main` → swap in content blobs → `commit-tree` → push the bare SHA), so nothing is ever staged in your checkout. It refuses if `main` has newer edits to the files being published **that didn't come from here**.
- **Publishing off-branch leaves your branch one commit behind `main` — that's the design, not a fault.** The commit lands on `main`; your branch never moves. It resolves when the branch merges or rebases.
- `bun run test:publish` exercises both paths against throwaway repos. **Run it after any change here** — the off-branch path is plumbing, and a subtle mistake shows up as a bad commit on `main`.
- The commit subject is written by a **local model** — `gemma3:4b` via Ollama on `localhost:11434` — given the save bar's **change manifest** (semantic counts like `3 crops`, `2 text fields`), not the JSON diff, which is mostly reordering noise. No API key, no cost, no network.
- Ollama runs as a login service (`brew services start ollama`, ~34MB idle). If it's down, missing the model, or slow, publishing still succeeds with a deterministic message built from the same manifest (`content: update tapico (5 changes)`). **Message generation must never block a publish.**
- `gemma3:1b` was tried and rejected — it hallucinated page names, which is disqualifying for text landing in git history unattended. Don't swap the model without re-benchmarking. Two things in `SYSTEM_PROMPT` are load-bearing at this model size: naming the banned verb forms explicitly, and **no few-shot example** (an example block makes it echo the manifest back verbatim). Field paths are deliberately kept out of the prompt — the model copies them into the subject instead of describing the edit.

### Content vs engine

`src/content/**` and `public/images/**` are the **content surface**. Everything else is **engine**.

- Content publishes to `main` from the save bar, from whatever branch you're on. Never stage it in a feature commit.
- Engine work goes on a feature branch. Commit it with:

  ```bash
  bun run commit:engine "your message" src/components/Thing.astro scripts/thing.mjs
  ```

  **Pass the paths you changed.** Agents: this is the required form — only list files you edited in this session. The script refuses content paths outright.

  The no-paths form (`bun run commit:engine "msg"`) sweeps *every* dirty engine file, which cannot distinguish your edits from another agent's in-flight work. It prints a warning when it does this. Use it only when you know the tree is otherwise clean.

Exception: schema migrations that require touching content JSON alongside the code change — commit them together and say so in the message.

### Key files (agents: read these for editor bugs)

- `src/components/DevTextEditor.astro` — text/spacing save bar, section insert/delete, pending media batch
- `src/components/DevModeController.astro` — dev mode toggle
- `src/components/project/ProjectImage*Tuner.astro` — crop, grid, caption pending edits
- `scripts/dev-api-plugins.mjs` — `readDevDocument` / `writeDevDocument`, `suppressContentHmr` on every write
- `scripts/dev-publish.mjs` — `/api/publish` (branch gate, content-only staging, commit message generation)
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
- **New slug 404s in an already-running session:** Astro caches `getStaticPaths()` — a newly added `{slug}.json` (or checking out a branch that adds one) will hit `/404` until you restart (`bun run dev:session:stop` then `bun run dev:session`). Do not dig into routing until you've restarted.

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
