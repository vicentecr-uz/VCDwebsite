# VCDwebsite

Portfolio site for **Vicente Cruz** — London-based industrial designer. Built with Astro, Tailwind CSS v4, and GSAP, deployed on Cloudflare Pages.

Live: [vicentecr.uz](https://vicentecr.uz)

This public repository contains the site engine and the source of the design-engineering work behind Vicente's portfolio. Site content and media are maintained in a separate private repository and must be supplied in `src/content/` and `media/` before running a build. Fetching that private content requires configured credentials.

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

In the owner's primary local checkout, Astro and branch sync run together:

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

The build is fully static (`output: "static"`). Ordinary engine fixture CI uses no secrets; fetching private content requires configured credentials. Optional:

- `PUBLIC_TEASER_PASSWORD` — teaser project unlock on the public site (see `.env.example`)

For a local engine-only check in a fresh isolated checkout, use the fixtures for automated validation:

```sh
fixture_repo=$(mktemp -d "${TMPDIR:-/tmp}/vcd-engine-fixture.XXXXXX")
git init -q "$fixture_repo"
cp -R scripts/test/fixtures/content/. "$fixture_repo/"
git -C "$fixture_repo" add .
git -C "$fixture_repo" -c user.name=CI -c user.email=ci@example.com commit -qm fixture
CONTENT_REPO="$fixture_repo" bash scripts/fetch-content.sh
bun run build
bun run test
bun run test:assets
```

These fixtures validate the engine boundary for automated checks; they are not polished sample content.

## Deploy

Deployment is automatic. **Cloudflare Pages builds and deploys the engine on every push to `main`**. A push to `main` in the private content repository triggers its private Action and deploy hook; Cloudflare then rebuilds this engine with the latest private content. There is no manual deploy step.

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
├── content/      # private JSON content supplied before a content-backed build
├── styles/       # global.css, project.css
└── lib/          # helpers (image resolution)
public/           # static passthrough assets (favicon, vendored tools)
media/            # private source media supplied before a content-backed build
```

## Conventions

- **Spacing:** use `var(--space-unit)` consistently; it is `1rem`, tightening to `0.75rem` below `40em`.
- **Page width:** text caps at `40em`, media at `50em`, and the outer column derives from the larger cap.
- **Fonts:** Hanken Grotesk (upright 400–900 plus 400 italic) site-wide; EB Garamond loaded only where needed via the `serif` prop on `Layout`.

## Docs

- [`AGENTS.md`](AGENTS.md) — canonical cross-harness project and delivery workflow.
- [`docs/interface-conventions.md`](docs/interface-conventions.md) — UI, layout, component, motion, accessibility, and Figma rules.
- [`docs/dev-authoring.md`](docs/dev-authoring.md) — in-page Edit, content/media, project status, and publishing internals.
- [`docs/product-vision.md`](docs/product-vision.md) — north star (View/Edit, online Edit parity, WYSIWYG). Not a sprint backlog.

## Licensing

The original engine source and documentation in this repository are available under the [MIT License](LICENSE). Site content and media supplied from the private content repository are **all rights reserved** and are not covered by that licence. Third-party dependencies, fonts, vendored tools, and other included materials retain their own licences and notices.
