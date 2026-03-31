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
- Page transitions: GSAP fades `#transition-overlay` (starts opaque, fades out on load with 0.5s delay; fades in on navigation)
- Max page width: fluid gutter via `#site-wrapper { padding-inline: max(1em, calc((100% - 60em) / 2)) }` — gutter holds at 1em until viewport exceeds 62em, then grows to keep content at 60em max

## Pending tasks (as of 2026-03-31)

### About page (next up)
1. **Responsive layout reflow** — on narrow viewports the "About" section sits below the Contact column; above a breakpoint it animates/transitions to sit below the photo (left column), matching the two-panel desktop layout. Use GSAP or CSS transition for the reflow animation.
2. **Photo aspect ratio** — change from `3/4` portrait to `1:1` square crop.
3. **Bio text max-width** — research optimal characters-per-line for reading comprehension (target ~60–75 chars / ~10–12 words per line is the common finding); apply as a `max-width` on the bio `<p>`. Currently `38em` — may need tuning.

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
