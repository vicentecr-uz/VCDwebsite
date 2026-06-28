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
- Page transitions: GSAP fades `#transition-overlay` (starts opaque, fades out on load with 0.5s delay; fades in on navigation)
- Max page width: fluid gutter via `#site-wrapper { padding-inline: max(1em, calc((100% - 60em) / 2)) }` — gutter holds at 1em until viewport exceeds 62em, then grows to keep content at 60em max

## Scope
What belongs in this repo: work that is **the site itself** — IA, global layout, deploy, nav, and integration of other work (routes, embeds, links, how a tool sits inside vcruzdesigns.com). What does **not** belong here: tasks inside another repo's product (calculator logic, chart bugs, Stoozing HTML layout, AutoSpeedTest features) — those stay in that project's own notes. Gray line: if the issue is the site shell (iframe sizing, Astro page grid, site chrome breaking mobile), it's here; if it's Stoozing's own layout/CSS in `stoozing-playground.html`, it's Stoozing Playground.

Open tasks are tracked in [GitHub Issues](https://github.com/vcruzdesigns/VCDwebsite/issues).

## Implementation notes

### About page
Three-state responsive layout with GSAP Flip animations on breakpoint transitions:
- **Wide (≥50em):** photo 3/4 (17em col) left, Contact+About+Experience stacked in right col
- **Medium (40–50em):** photo 1:1 (17em) + Contact top row; About+Experience span full width below
- **Narrow (<40em):** single column, photo 1:1 full-width → Contact → About → Experience
- Photo `object-position: 50% 35%` in square crop for headroom; `50% 50%` in portrait
- GSAP Flip animates element repositioning; photo height wipe + object-position animated separately
- Bio `max-width: 38em`; noscript CSS media query fallback for all states
