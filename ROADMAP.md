# VCDwebsite Roadmap

**Single source of truth** for upcoming **vcruzdesigns.com** work. Atlas lists the project under **vcruzdesigns.com** (`P-018`) but does **not** duplicate this checklist — edit here only.

**Local checkout:** `$HOME/Documents/Projects/VCDwebsite/`

**Scope (what belongs here):** Work that is **the site itself** — IA, global layout, deploy, nav, and **integration** of other work (routes, embeds, links, how a tool **sits inside** vcruzdesigns.com). **What does *not* belong here:** tasks that live inside another repo’s product (calculator logic, chart bugs, responsiveness of the **standalone** Stoozing HTML, AutoSpeedTest features, etc.) — those stay in **that project’s** roadmap (or in-file notes). **Gray line:** if the issue is the **site shell** (iframe sizing, Astro page grid, site chrome breaking mobile), it’s here; if it’s **Stoozing’s own** layout/CSS in `stoozing-playground.html`, it’s **Stoozing Playground**.

---

## v1 — ship a cohesive site

- [ ] Recreate core pages with AI-assisted workflow.
- [ ] Clear IA: home, work/projects pointer, contact or link-out as needed.
- [ ] Match **vcruzdesigns.com** branding.
- [ ] **Done-for-now bar:** site live; no blocking placeholders on primary pages; Stoozing Playground reachable from the site; **`/tools`** stub or first real entry (see below).

---

## Stoozing Playground on site

Standalone calculator lives in **Stoozing Playground** (Atlas `P-002`, repo `stooze-page`, `stoozing-playground.html`). This site **hosts, links, or embeds** it.

- [ ] Add a **Stoozing Playground** surface — dedicated route (e.g. `/stooze`, `/tools/stoozing`) or embed.
- [ ] Wire to the existing **P-002** artifact or deployed asset (copy, submodule, build step, or CDN — pick one approach and document it in **README**).
- [ ] One obvious path from homepage or main nav.

(Calculator feature roadmap stays in the **Stooze Page** HTML MEMORY / that repo — not this file.)

---

## Tools nook

- [ ] Carve **`/tools`** (or equivalent) so small side builds don’t fight the main portfolio story.
- [ ] First entry can be Stoozing or a simple index linking out.

---

## Deploy & repo hygiene

- [ ] Document **how to publish** in **README** (install, `bun run build`, where output goes, env if any).

### Cloudflare Pages

- [ ] Connect GitHub repo **`vcruzdesigns/vcdwebsite`** to Cloudflare Pages.
- [ ] Build command: `bun run build`
- [ ] Output directory: `dist`
- [ ] Connect custom domain **vcruzdesigns.com** (DNS already on Cloudflare).
- [ ] No adapter needed (static site, pre-rendered at build time).
