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

In Anto's primary local checkout, Astro and branch sync run together:

```sh
bun run dev:session         # start Astro (4321) + branch sync
bun run dev:session:status  # check what's running (includes sync)
bun run dev:session:stop    # stop both
```

That primary checkout and port `4321` are the human live-editing workspace. Agent changes, builds, Git operations, and review servers run in dedicated task worktrees; site/UI review uses `scripts/dev-worktree-preview.sh` on an unused port `4322+`. See [`AGENTS.md`](AGENTS.md).

### Content editing

Toggle **dev mode** on the live page to edit in place (text, crops, sections, grids, Save / Save & Publish). Content lives as JSON under `src/content/`; source assets live under `media/`. There is no separate `/admin` CMS. See [`docs/dev-authoring.md`](docs/dev-authoring.md).

## Build

```sh
bun run build        # outputs static site to ./dist/
bun run preview      # preview the built site locally
```

The build is fully static (`output: "static"`). No environment variables are required for the public site. Optional:

- `PUBLIC_TEASER_PASSWORD` — teaser project unlock on the public site (see `.env.example`)

## Deploy

Deployment is automatic. **Cloudflare Pages builds and deploys on every push to `main`** — the change is live at [wip.vcruzdesigns.com](https://wip.vcruzdesigns.com) within ~30 seconds. There is no manual deploy step.

- Engine and repository-doc changes reach `main` through a feature/docs branch and pull request.
- Routine content is published from in-page Edit with **Save & Publish**.
- Colour-token changes are published from `/styles` with **Publish styles**.

The two app-mediated publishers are the only direct-main paths; do not use shell Git to push VCDwebsite changes directly to `main`.

## Project layout

```text
src/
├── pages/        # routes (index, work, play, about, project pages, 404)
├── layouts/      # Layout.astro — <head>, fonts, page-transition overlay
├── components/   # Header, Footer, and project/ content components
├── content/      # JSON content consumed by pages and in-page Edit
├── styles/       # global.css, project.css
└── lib/          # helpers (image resolution)
public/           # static passthrough assets (favicon, vendored tools)
media/            # source media; reachable assets are copied to dist/images at build
```

## Hosted tools

- **Stoozing Playground** — served at [`/stoozing-playground`](https://wip.vcruzdesigns.com/stoozing-playground) from `public/stoozing-playground/index.html`. This is a **vendored copy** of the single self-contained HTML file in the [`vicentecr-uz/stooze-page`](https://github.com/vicentecr-uz/stooze-page) repo (canonical source). It has no build step and loads Chart.js from a CDN. Mobile touch tweaks (16px inputs to stop iOS zoom-on-focus, floating Settings pill) are applied in this copy under a `@media (max-width: 640px)` block. To refresh, re-copy `stoozing-playground.html` from `stooze-page` over the vendored file and re-apply the mobile block if it was overwritten.

## Conventions

- **Spacing:** use `var(--space-unit)` consistently; it is `1rem`, tightening to `0.75rem` below `40em`.
- **Page width:** text caps at `40em`, media at `50em`, and the outer column derives from the larger cap.
- **Fonts:** Hanken Grotesk (upright 400–900 plus 400 italic) site-wide; EB Garamond loaded only where needed via the `serif` prop on `Layout`.

## Docs

- [`AGENTS.md`](AGENTS.md) — canonical cross-harness project and delivery workflow.
- [`docs/interface-conventions.md`](docs/interface-conventions.md) — UI, layout, component, motion, accessibility, and Figma rules.
- [`docs/dev-authoring.md`](docs/dev-authoring.md) — in-page Edit, content/media, project status, and publishing internals.
- [`docs/product-vision.md`](docs/product-vision.md) — north star (View/Edit, online Edit parity, WYSIWYG, eventual open source). Not a sprint backlog.
