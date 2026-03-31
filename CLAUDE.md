# VCDwebsite — Claude Instructions

## On every session start
Read all files in `$HOME/.claude/projects/-Users-anto-Documents-Projects-VCDwebsite/memory/` before doing anything else. Start with `MEMORY.md` (the index), then read whichever files are relevant to the current task. Use these to resume context without requiring the user to re-explain prior decisions.

## Project
Astro + Bun + Tailwind CSS v4 + GSAP portfolio site for Vicente Cruz (industrial designer, London). Rebuilding vcruzdesigns.com as an independent site.

## Key conventions
- Spacing unit: `1em` consistently across header, grid, footer, gaps — use inline `style=` not Tailwind arbitrary values for guaranteed rendering
- Font: Hanken Grotesk (Google Fonts, weights 300–800)
- Background: `#ffffff`
- Bun path: `$HOME/.bun/bin/bun` (not on PATH)
- Dev server: port 4321
- Page transitions: GSAP fades `#transition-overlay` (starts opaque, fades out on load with 0.5s delay; fades in on navigation)
- Max page width: `width: 75vw; max-width: 60em` on `body`, centered, applied at `min-width: 1024px`
