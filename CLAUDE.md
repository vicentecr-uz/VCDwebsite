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
- **Dev session:** `bun run dev:session` starts Astro dev server; `dev:session:stop` / `dev:session:status`. One Cursor chat owns the session — reuse servers, don't duplicate. See `.cursor/rules/dev-session.mdc`. No local CMS proxy needed — CMS is accessed via `wip.vcruzdesigns.com/admin`.
- **Deployment:** Cloudflare Pages auto-deploys on every push to `main` — live at `wip.vcruzdesigns.com` within ~30s. No manual deploy step needed. CMS admin at `wip.vcruzdesigns.com/admin` (Sveltia CMS with GitHub PKCE auth).
- Page transitions: GSAP fades `#transition-overlay` (starts opaque, fades out on load with 0.5s delay; fades in on navigation)
- Max page width: fluid gutter via `#site-wrapper { padding-inline: max(1em, calc((100% - 60em) / 2)) }` — gutter holds at 1em until viewport exceeds 62em, then grows to keep content at 60em max

## Pending tasks (as of 2026-03-31)

### About page — ✓ done
Three-state responsive layout with GSAP Flip animations on breakpoint transitions:
- **Wide (≥50em):** photo 3/4 (17em col) left, Contact+About+Experience stacked in right col
- **Medium (40–50em):** photo 1:1 (17em) + Contact top row; About+Experience span full width below
- **Narrow (<40em):** single column, photo 1:1 full-width → Contact → About → Experience
- Photo `object-position: 50% 35%` in square crop for headroom; `50% 50%` in portrait
- GSAP Flip animates element repositioning; photo height wipe + object-position animated separately
- Bio `max-width: 38em`; noscript CSS media query fallback for all states

### Footer
4. **Centered footer at breakpoint** — dynamically animate/transition footer text to `text-align: center` (and possibly `justify-content: center`) below a certain viewport width (width TBD). Consider GSAP ScrollTrigger or a CSS media query transition.

### Roadmap
1. ~~Header polish~~ ✓
2. ~~**Fluid max-width layout**~~ ✓
3. ~~**About page** — initial rebuild~~ ✓ (polish tasks above remain)
4. **Project pages** — rebuild each to match Webflow equivalents (image layouts, captions, sections, typography)
5. **Style guide page** — `/styles` or `/debug` page previewing all site-wide components: h1–h3, body text, hover titles, captions, grids, footer, buttons — for QA and design consistency
6. **Hosting & domain** — deploy to vcruzdesigns.com (likely Cloudflare Pages, Netlify, or Vercel; DNS switch from Webflow)
7. **Progressive image loading** — LQIP strategy: blurred placeholder → full-res swap; use Astro `@astrojs/image` / `sharp` or blur-hash + `loading="lazy"` + srcset
