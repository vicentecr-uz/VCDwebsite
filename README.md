# VCDwebsite

Portfolio site for **Vicente Cruz** — London-based industrial designer. Built with Astro, Tailwind CSS v4, and GSAP, deployed on Cloudflare Pages.

Live (work-in-progress): [wip.vcruzdesigns.com](https://wip.vcruzdesigns.com)

## Stack

- **[Astro](https://astro.build)** — static site generation
- **[Tailwind CSS v4](https://tailwindcss.com)** — utility styling (via `@tailwindcss/vite`)
- **[GSAP](https://gsap.com)** — page transitions and animations
- **[Bun](https://bun.sh)** — runtime and package manager

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- Node ≥ 22.12 (Astro toolchain)

## Setup

```sh
bun install
```

## Develop

```sh
bun run dev          # Astro dev server at http://localhost:4321
```

For Astro + branch sync together, use the dev session helper:

```sh
bun run dev:session         # start Astro (4321) + branch sync
bun run dev:session:status  # check what's running (includes sync)
bun run dev:session:stop    # stop both
```

While the session runs, **branch sync** auto-pulls the checked-out branch every ~60s (pull-only, no auto-commit). Agents: don't `git pull` manually when sync is running — see `CLAUDE.md` → *Branch sync*.

### Content editing

Toggle **dev mode** on the live page to edit in place (text, crops, sections, grids, Save / Save & Publish). Content lives as JSON under `src/content/` (`play/`, `projects/`, `about.json`, `settings/`, …). There is no separate `/admin` CMS.

## Build

```sh
bun run build        # outputs static site to ./dist/
bun run preview      # preview the built site locally
```

The build is fully static (`output: "static"`). No environment variables are required for the public site. Optional:

- `PUBLIC_TEASER_PASSWORD` — teaser project unlock on the public site (see `.env.example`)

## Deploy

Deployment is automatic. **Cloudflare Pages builds and deploys on every push to `main`** — the change is live at [wip.vcruzdesigns.com](https://wip.vcruzdesigns.com) within ~30 seconds. There is no manual deploy step.

To publish changes:

```sh
git add -A
git commit -m "…"
git push origin main
```

## Project layout

```text
src/
├── pages/        # routes (index, work, play, about, project pages, 404)
├── layouts/      # Layout.astro — <head>, fonts, page-transition overlay
├── components/   # Header, Footer, and project/ content components
├── content/      # JSON content consumed by pages and in-page Edit
├── styles/       # global.css, project.css
└── lib/          # helpers (image resolution)
public/           # static assets (images, favicon)
```

## Hosted tools

- **Stoozing Playground** — served at [`/stoozing-playground`](https://wip.vcruzdesigns.com/stoozing-playground) from `public/stoozing-playground/index.html`. This is a **vendored copy** of the single self-contained HTML file in the [`vcruzdesigns/stooze-page`](https://github.com/vcruzdesigns/stooze-page) repo (canonical source). It has no build step and loads Chart.js from a CDN. Mobile touch tweaks (16px inputs to stop iOS zoom-on-focus, floating Settings pill) are applied in this copy under a `@media (max-width: 640px)` block. To refresh, re-copy `stoozing-playground.html` from `stooze-page` over the vendored file and re-apply the mobile block if it was overwritten.

## Conventions

- **Spacing:** `1em` unit consistently (header, grid, footer, gaps), set via inline `style=` for guaranteed rendering rather than Tailwind arbitrary values.
- **Max width:** fluid gutter — `#site-wrapper` holds content to `60em` max, gutter grows beyond `62em` viewport.
- **Fonts:** Hanken Grotesk (300–900) site-wide; EB Garamond loaded only where needed via the `serif` prop on `Layout`.

## Docs

- [`docs/product-vision.md`](docs/product-vision.md) — north star (View/Edit, online Edit parity, WYSIWYG, eventual open source). Not a sprint backlog.
