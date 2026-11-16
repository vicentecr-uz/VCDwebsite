# Spacing, type and page geometry

Read when changing page spacing, type, widths, breakpoints or viewport heights. Dev-chrome spacing is owned by the components; see [panels](panels.md) and [fields](fields.md).

## Spacing unit

Use `var(--space-unit)` consistently for header, grid, footer, and gaps. It is the ink gap between two body lines (baseline to next cap top): `--text-body-size × (--text-body-leading − 0.697)`, about `15.4px` on desktop and `14.4px` below `40em`, so it follows the body size. Text gaps are whole units, measured ink to ink: line `1u`; every related gap around text is `2u`, from the cap line above or the baseline below, never the descender: paragraph breaks, title to body text, and body text or a title to a box (image, embed, code block, form) on either side. It is defined in `src/styles/global.css`; do not replace it with a literal `1em`. Prefer inline `style=` over framework arbitrary values when guaranteed rendering matters.

## Dev-chrome spacing

Dev chrome is fixed-scale tooling in px, from the `--dev-*` tokens in `src/styles/global.css` (mirrors the Figma Primitives collection). Components read them; call sites never set them or the padding, gap and radius they drive. `bun test scripts/test/dev-chrome-ownership.test.ts` fails on a call-site override; its baseline lists older overrides and may only shrink.

Check spacing with numbers, not by eye. In a running preview's console or a browser tool:

```js
(await import('/scripts/dev-measure.ts')).report('.dev-overlay[data-dev-panel-key="log-issue"]')
```

It prints the inset on all four sides, naming the element that sets each, and the baselines of texts that share a row. `box` insets take text at its line box (what component padding sets); `ink` insets take text from cap line to baseline, as text gaps above are measured. Equal means within `0.5px`.

## Breakpoint and type

- **Mobile breakpoint:** `40em` (640px). This is where the body size, and with it `--space-unit`, steps down and the header steps down through `--header-wordmark-size`, `--header-menu-link-size`, and `--header-logo-size`.
- **Typography:** Hanken Grotesk, upright weights 400–900 plus 400 italic. Content Heading 2 uses the body size, leading, and tracking with bold weight 700; body emphasis stays at 500. It remains a heading block in the editor and rendered document.

## Page width and viewport height

Text and media use separate caps:

- `--page-text-max-width` (`37.5em`) caps body text and section titles.
- `--page-media-max-width` (`50em`) caps images, grids, carousels, video, press ticker, Reddit board, and project grids.
- `--page-max-width` is derived with `max()` and defines the outer column used by `#site-wrapper`, the header feather, and sidebar navigation.

All three tokens live in the `html` block of `src/styles/global.css`. The sidebar-nav breakpoint is derived from outer column + `28.5em` (currently `78.5em`), but media-query conditions cannot read custom properties. The literal appears in `SectionSidebarNav.astro`, `project.css`, `ProjectSectionTitle.astro`, `DevPageWidthToggle.astro` and the `reports/RailSchematic.astro` prototype; re-derive them together (`grep -rn 78.5em src`). Missing one can leave the nav positioned and hidden in the same band. Read [`page-width.md`](../page-width.md) before changing a width; the dev-mode **Page width** panel previews both caps but does not update shipped CSS for you.

Never use raw `svh` or `vh` for a visually important height constraint. Microsoft Edge on iOS can let `svh` follow address-bar movement and push content during scroll. Use `bindSafeVh()` from `src/lib/safeVh.ts`, initialized in `Layout.astro`; it sets `--vh-safe` on load and recomputes only for a genuine width change. Keep `svh` only as the pre-JS/no-JS fallback:

```css
height: calc(var(--vh-safe, 1svh) * 100);
```

Do not reimplement safe viewport height per component.

## Scrollable overflow

Scrollable content needs a clear edge treatment. For grouped controls, cards, and other contained UI, put the existing radius token on the actual overflow viewport and clip its contents to that rounded shape, as with the clipped areas of the Asset manager. For text-like content that continues past its edge, use a gradient alpha mask to fade the text, as with overflowing text fields. Preserve native scrolling and visible keyboard focus in both cases. Reuse the existing dev controls and styling patterns rather than introducing a new overflow abstraction. Hiding scrollbars is a local choice for a specific control; this pattern does not make it a global rule.
