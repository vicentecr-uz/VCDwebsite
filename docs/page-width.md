# Page width — the column caps and everything derived from them

The page has **two** independent column caps, not one: text blocks and media
blocks size separately. This file is the map. **Read it before changing a
width** — several literals have to move together, and one of them cannot be a
variable for a reason CSS won't let us work around.

## Current values

| Knob | Value | What it caps |
| --- | --- | --- |
| `--page-text-max-width` | `40em` | Body text, section titles |
| `--page-media-max-width` | `50em` | Everything else — images, grids, carousels, video, press ticker, Reddit board, project grid |
| `--page-max-width` | *derived* `max(text, media)` = `50em` | The **outer** column: wrapper gutter, header fill feather, sidebar nav offset |

All three live in one place: the `html { }` block in `src/styles/global.css`.
`--page-max-width` is **derived, never set by hand** — it is what page chrome
reads so the chrome always tracks the true column edge whichever side is wider.

## To change a width

Edit `--page-text-max-width` and/or `--page-media-max-width` in
`src/styles/global.css`. That is the whole change **unless the *outer* column
moves** (i.e. unless you change whichever of the two is larger) — in which case
see *The derived breakpoint* below, which is the part that bites.

There is also a live A/B: turn on dev mode and use the **Page width** panel
(`src/components/DevPageWidthToggle.astro`, floating, draggable). It writes the
two custom properties on `documentElement` so you can try numbers in the
browser before committing to them. It is temporary — delete it once the widths
are settled. It rewrites the breakpoint below at runtime too, so the preview is
honest; the shipped CSS is not updated for you.

## Which blocks are text

`src/styles/project.css`, just after `.project-block`:

```css
.project-block,
.project-image-grid,
.project-image-carousel { margin-inline: auto; max-width: var(--page-media-max-width); }

.project-block--text     { max-width: var(--page-text-max-width); }
```

Media is the **default**; text opts down. Only two components add
`project-block--text`: `ProjectBodyText.astro` and `ProjectSectionTitle.astro`.
A new text-ish section type needs that class or it will size as media.

`.project-image-grid` and `.project-image-carousel` are named explicitly
because those two roots do **not** carry `.project-block`. Check any new media
component: if its root lacks `.project-block`, add it to that selector list.

Both groups are centred (`margin-inline: auto`), so a narrower text block sits
symmetric inside a wider media column rather than sharing its left edge. That
was a deliberate call — changing it is a one-line edit here, nothing else.

## The derived breakpoint — the part that bites

The gutter nav needs **14.25em per side** (12.5em nav + 1em gap + 0.75em
viewport edge), so the desktop floor is:

```
desktop floor = outer column + 2 × 14.25em = outer column + 28.5em
tablet ceiling = desktop floor − 0.0625em
```

At today's 50em outer column: **78.5em** and **78.4375em**.

**A media query condition cannot read a custom property.** There is no CSS
mechanism for this — not `@media`, not `@container`. So these literals are
hand-maintained and must be re-derived whenever the outer column moves:

| File | Literal |
| --- | --- |
| `src/components/SectionSidebarNav.astro` | `@media (min-width: 78.5em)` — the fixed gutter nav layout |
| `src/components/SectionSidebarNav.astro` | `@media (max-width: 78.4375em)` ×2 — hides the desktop-only nav, and the dev section-editor override |
| `src/styles/project.css` | `@media (min-width: 78.5em)` — `hide-desktop` / `hide-when-sidebar` titles |
| `src/styles/project.css` | `@media (min-width: 48em) and (max-width: 78.4375em)` — `hide-tablet` titles |
| `src/components/DevTextEditor.astro` | `SIDEBAR_TITLE_HIDDEN_MQ = '(min-width: 78.5em)'` — JS `matchMedia`, dev spacing toolbars |
| `src/components/DevPageWidthToggle.astro` | `BASE_MIN_EM` / `BASE_MAX_EM` — what the A/B rewrites *from* |

Find them all with:

```bash
grep -rn "78\.5em\|78\.4375em\|78\.5;\|78\.4375;" src/
```

**Get this wrong and the failure is silent.** A `min-width` lowered without its
`max-width` companion leaves a band where the nav is positioned *and* hidden at
once — that shipped on this branch between `71.75em` and `88.4375em`, and the
lowered breakpoint simply never took effect. If you move one, move all of them.

The tablet/mobile split at **48em** is a real fixed breakpoint and is unrelated
to the column — leave it alone. `40em` (phone: `--space-unit` and header
step-down) is also independent.

## Things that are not the column cap

- **`.project-body-text` is `width: min(100%, 65ch)`** — a typographic measure
  cap, roughly 39em at `1.2rem`. It is *tighter* than the 40em text column, so
  body copy is bound by the measure and the text width mostly controls where
  the paragraph sits, not how wide it runs. Deliberate; don't "fix" it.
- The header, footer and page gutter read the **outer** `--page-max-width`, not
  the media cap. They are chrome and belong on the page's true edge.
