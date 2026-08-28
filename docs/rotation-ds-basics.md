# DS basics — QA rotation

This plan is for use with the `qa-rotation` skill. You are the manager — read that skill before continuing.

Scope: design-system basics (type tokens, doc outline, font loading, heading polish, About binding). Branch: new branch off `origin/main` in a sibling worktree (`VCDwebsite-ds-basics`). QA on the Cloudflare Pages preview for that branch, not `localhost:4321`.

## Queue

- [x] **T1 · Site type tokens** — **signed off.** Commits `e7686da` + fixup `da037bb` on `feat/ds-doc-outline`. Fixup: grid card **title** stays Bold (reverted); the Regular weight instead binds to the **year/meta label** next to it (`.project-grid__subtitle`), including the dev-mode JS-created host in `DevProjectGridEditor.astro`. `/styles` catalog note updated to match. Follow-up filed: [#265](https://github.com/vcruzdesigns/VCDwebsite/issues/265) — flatten `/styles` catalog cards, hover for detail (v1 — Launch, not blocking, do last).
- [x] **T2 · Document outline** — **signed off.** Commit `f2c926e` on `feat/ds-doc-outline`.
- [x] **T3 · Font loading** — **signed off.** — commit `c12ff50` on `feat/ds-doc-outline`. Small enough to do inline (2 lines, 2 files) rather than a worker. Google Fonts URL now `ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400` (dropped unused 300, added real italic 400 — verified the face actually loads via a direct fetch of the Fonts CSS); `font-synthesis: none` added once on `html` in `global.css`.
- [x] **T4 · Heading polish** — **signed off.** Commit `094c44c` on `feat/ds-heading-polish`. — `text-wrap: balance` on headings, skip-to-content link into `<main>`. Branch `feat/ds-heading-polish`, built on top of T1+T2+T3.
- [x] **T5 · About type binding** — **signed off pending your QA.** Commit `c343dbf` on `feat/ds-heading-polish`. `.section-header` / `.about-grid` bound to the About heading/body tokens (values unchanged, just tokenized); `#000000` → `var(--sys-color-on-srf)`; hover transition cut from 1s to 0.3s (same easing curve, just faster — no established shared duration token existed, so this is a judgment call, not a mechanical swap). Left `.contact-link`'s own `-0.3px` tracking alone — it doesn't match any defined Type/Site role and isn't in scope. Not the About copy rewrite (parked, separate rotation later).

**Merged.** PR [#267](https://github.com/vcruzdesigns/VCDwebsite/pull/267), merge commit `a2623cd` on `main`. Feature branches deleted (local + remote). Local `main` checkout fast-forwarded, dev session restarted. Rotation complete.

## Figma (out-of-band, not part of the branch above)

- Type/Site particle sample text now shows each role's own name (was mixed — some already correct, "Wordmark" showed "vcruzdesigns", "Nav" showed "Work", "Body" showed "Body text").
- New "Content" auto-layout frame added between "Site" and "Dev" in the Particles > Text Components section, holding the three roles scoped for the future text-formatting-bar work: Section title (H2), Subheading (H3), Body. "Site" keeps the component-bound roles only.
- Format-bar wiring itself is intentionally not started — waits until base styles are reviewed in Figma; likely an Opus session, per Anto.

## Pre-flight findings (from code, confirms/extends the audit)

- `.project-body-text`, `.project-section-title`, `.project-grid__title/subtitle` sizing, `.section-header`/`.about-grid` (About), and the footer `.footer-text` **already match** their Figma role numerically — T1 is mostly swapping literal values for `var(--text-role-*)` references, not changing them.
- `ProjectPressQuoteTicker.astro:193-197` already matches "Press quote 16.8 Italic 135% / −1%" exactly (not in the original audit's match table — add it).
- Grid title weight fix is a 2-line Tailwind class swap: `ProjectGridItem.astro:184` and `:285`, `font-bold` → `font-normal`.
- Italic is real, not decorative: `project.css:972` (`.project-body-text em`), `project.css:1013` (`.project-prose em`), `ProjectPressQuoteTicker.astro:195` all set `font-style: italic`, but only Hanken Grotesk (no italic) is loaded — the browser is currently faking every one of those. `font-synthesis: none` (T3) will make them render upright instead unless italic loads first — **T3 must add the italic weight before or alongside disabling synthesis**, not after.
- Header wordmark/nav are **not safe to force onto literal Figma px values**. `Header.astro` computes `--header-wordmark-size` from the logo box (`--wordmark-cap`/`--wordmark-trim` comments) and corrects kerning with a runtime JS pass (`applyWordmarkKerning`), and its tracking is `-0.05ch` — a different unit from the `em`-based tracking everywhere else, already hand-tuned against that JS. Figma's "Wordmark 37 Bold −3%" and "Nav 19.2 Medium −3%" are the source for **weight** (700/500, already correct) — leave size and tracking mechanics alone. Flag this explicitly in the T1 worker spec so it doesn't get "corrected" to match Figma literally.
- No `h1` anywhere on `index.astro` / `work.astro` / `play.astro` (Header renders the wordmark as a styled link, not a heading) — confirms T2.
- No skip-to-content in `Layout.astro` — confirms T4.
- `about.astro` `.section-header` and `.about-grid` already match "About heading 32 Black" / "About body 19.2 Medium 125% / −0.4px" numerically; T5 is swapping `#000000` → `var(--sys-color-on-srf)` (or equivalent) and the two hardcoded px tracking values for tokens, not re-deriving them.

## Status
