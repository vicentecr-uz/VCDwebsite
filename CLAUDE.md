# VCDwebsite — Claude Instructions

> This file is the single source of truth for project context. All memory is kept here, in the repo.

## Project
Astro + Bun + Tailwind CSS v4 + GSAP portfolio site for Vicente Cruz (industrial designer, London). Rebuilding vcruzdesigns.com as an independent site.

Vicente Cruz is a UAL: CSM graduate, currently Junior Industrial Designer at Kingfisher. He references the live Webflow site frequently for design decisions and has a strong design eye — precise aesthetic calls on font weight, letter spacing, spacing systems, and transitions.

## Key conventions
- Spacing unit: `1em` consistently across header, grid, footer, gaps — use inline `style=` not Tailwind arbitrary values for guaranteed rendering
- Font: Hanken Grotesk (Google Fonts, weights 300–800)
- Background: `#ffffff`
- Bun path: `$HOME/.bun/bin/bun` (not on PATH)
- Dev server: port 4321
- Page transitions: GSAP fades `#transition-overlay` (starts opaque, fades out on load with 0.5s delay; fades in on navigation)
- Max page width: fluid gutter via `#site-wrapper { padding-inline: max(1em, calc((100% - 60em) / 2)) }` — gutter holds at 1em until viewport exceeds 62em, then grows to keep content at 60em max

## Pending tasks (as of 2026-03-31)

### Header (next up)
1. **Sticky header** — `position: sticky; top: 0; background-color: #ffffff; z-index` so content scrolls underneath
2. **White safe-area overlay** — `position: fixed; top: 0` strip covering browser chrome safe-area inset (Zen browser, Safari mobile)
3. **Reduce header height ~15%** — current padding `1em` all sides is slightly tall vs Webflow reference; try `padding: 0.85em 1em`, scale font-size and logo proportionally

### Roadmap
1. Header polish (above)
2. ~~**Fluid max-width layout** — replace hard `1024px` breakpoint + `75vw` snap with `padding-inline: max(1em, calc((100% - 60em) / 2))` on `#site-wrapper`; gutters grow smoothly into the 60em cap~~
3. **About page** — rebuild to match vcruzdesigns.com Webflow about page (layout, copy, experience list, styling)
3. **Project pages** — rebuild each to match Webflow equivalents (image layouts, captions, sections, typography)
4. **Style guide page** — `/styles` or `/debug` page previewing all site-wide components: h1–h3, body text, hover titles, captions, grids, footer, buttons — for QA and design consistency
5. **Hosting & domain** — deploy to vcruzdesigns.com (likely Cloudflare Pages, Netlify, or Vercel; DNS switch from Webflow)
6. **Progressive image loading** — LQIP strategy: blurred placeholder → full-res swap; use Astro `@astrojs/image` / `sharp` or blur-hash + `loading="lazy"` + srcset
