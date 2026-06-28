# VCDwebsite Roadmap

**Single source of truth** for upcoming **vcruzdesigns.com** work. Atlas lists the project under **vcruzdesigns.com** (`P-018`) but does **not** duplicate this checklist — edit here only.

**Local checkout:** `$HOME/Documents/Projects/VCDwebsite/`

**Scope (what belongs here):** Work that is **the site itself** — IA, global layout, deploy, nav, and **integration** of other work (routes, embeds, links, how a tool **sits inside** vcruzdesigns.com). **What does *not* belong here:** tasks that live inside another repo’s product (calculator logic, chart bugs, responsiveness of the **standalone** Stoozing HTML, AutoSpeedTest **features**, etc.) — those stay in **that project’s** roadmap (or in-file notes). **Gray line:** if the issue is the **site shell** (iframe sizing, Astro page grid, site chrome breaking mobile), it’s here; if it’s **Stoozing’s own** layout/CSS in `stoozing-playground.html`, it’s **Stoozing Playground**.

---

## v1 — ship a cohesive site

- [x] Change Extras page to Play
	- [x] Play page will be like Work (gallery of projects and stuff)
- [x] Add Work link to header
- [x] Fix nav header wordmark kerning bug on project/page titles (seen on Tapico: "Tapico Typer") caused by per-character kerning transforms; ensure consistent spacing across all non-home headers
- [ ] Design System page
	- have all the components in use across the site → so that I can build new project pages just by saying something like 'create a new project page with the following components: hero, text, inline image, 2x2 grid image, text, hover detail image, quote, text'
	- [ ] Figure out how to add a little example pop-up to show the component used in context in other pages
- [ ] Change homepage project gallery images to something more representative of each project's design, something more eye-catching
- [ ] Add 404 page
- [ ] Add links to the business names on the About page
- [ ] Change site to use off-white/black background colour and have it roll-out site-wide
	- [ ] Have light/dark theme react to local time of browser
	- [ ] Add toggle in menu
- [ ] Add detail animations
	- [ ] When on homepage, have it shake like in an 'interaction denied' type of way when clicked, then if clicked again, have the text appear in a slightly lighter gray to the left/right of it saying "you're already on this page", then if you click it again, have the text darken. Click it one more time and the menu option gradient from below upwards as the rest of the links shift up by one
	- [ ] Add a way for scrolls to slow down (like the browser is hitting literal honey or something) if the user scrolls to the top with a quick swipe. That way, instead of the browser scroll taking the momentum impact (or not), it's built-right in.
- [ ] Clean up mobile version

## v2+
- [ ] Make some objects 3D rotatable (using gaussian splats or however it's done on chaz.fun/phonemuseum)
- [ ] Add a short RSVP/Spritz-style opening micro-intro (name + one-liner) that informs while assets load, with strict non-blocking/skip behavior

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
