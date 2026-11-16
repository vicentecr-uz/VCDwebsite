# Components and page blocks

Read when choosing, adding or changing a component, button or page block.

## Approved components

Use the components and patterns listed on `/styles`. Build UI by assembling existing components and sub-components, not by defining one-off styles. Each component should settle a decision once so later work does not re-make it. Do not copy legacy case-study markup from `src/components/project/legacy/`.

A component in `src/components/ui/` owns its padding, gap and radius, as `Menu` does. A call site composes it and never re-sets those; to change one, change the component (or add a variant to it) so every instance moves together. `scripts/test/dev-chrome-ownership.test.ts` enforces this.

## When a component does not exist

The rule is in the [index](../interface-conventions.md#when-the-component-does-not-exist): stop, say what is missing, build it into the design system (properly, or good-enough with at most two rounds of iteration), and file an issue to finish it. A good-enough component carries a `good-enough: #<issue>` comment at the top of its file until the issue closes; `interface-docs.test.ts` checks every such marker names an issue. Do not hand-style a one-off at the call site.

## Buttons

Raised buttons (`raised` on `Button`, `.dev-btn--raised`) are opt-in for a filled or soft button that should stand out a little more, such as the Sabi hero CTAs or a Save bar. They do not replace the flat default. A dark fill gets a semi-transparent top highlight only; a light fill gets a bottom shade only, from `--sys-color-surface-shadow`; `light-dark()` swaps them by theme. Pressing flattens the bevel. Do not hand-roll a bevel or drop shadow on a button.

Any interactive element built from Button Base or its variants needs a hit area beyond every visual edge. Figma models it as `space/hit-inset` (8px in Primitives) but deliberately not as geometry. In code, `Button` and `Field` already draw it from `--dev-hit-inset` (4px: halved, so buttons 8px apart meet in the gap; a packed `SegmentedControl` zeroes `--dev-btn-hit-inset`). A new interactive element uses the same token on an interactive wrapper or a pseudo-element; never hardcode the value.

## Page blocks

When creating a page, compose its headings, text, and media from the existing content-backed page blocks wherever they fit, so Anto can edit them through in-page Edit. Use the disk-backed page loader and verify Save survives a reload; styled hardcoded text is not equivalent to an editable block.

Treat difficulty expressing a page through blocks as evidence of an editor capability gap. Identify the missing capability and address it within the agreed task scope, or explicitly report the remaining gap. Do not silently bypass the editor with page-specific markup. Functional controls may still need engine code; keep that boundary explicit.

Signed-off Tapico/future case-study primitives:

- `ProjectLayout`
- `ProjectImage`
- `ProjectImageGrid`
- `ProjectBodyText`
- `ProjectSectionTitle`
- `ProjectPressQuoteTicker`
- `ProjectRedditCommentCarousel`
- `ProjectInteractiveDemo`

Home, Work, and Play use `ProjectGrid` from `src/components/ProjectGrid.astro`. Its `variant` is `home`, `work`, or `play`; listings come from each project document. `src/components/project/legacy/LegacyProjectGrid` is a case-study media cluster, not the same listing grid.

## Labels and accessibility

Site and dev-layer chrome ships with **labels only**. A control names itself and stops; if it needs an explanatory sentence, improve its label, grouping, or interaction.

Do not volunteer subtitles that repeat headings, helper prose below fields or toggles, panel introductions, parenthetical hints, or explanatory tooltips. These are still valid:

- the control label;
- an inline unit such as `px` or `%`;
- actionable error text;
- editorial site content such as About or a case study;
- invisible accessible names such as `aria-label` and `title` on icon-only controls.

Never strip an accessible name to satisfy the labels-only rule. If Anto explicitly asks for tooltips or onboarding, build that requested help layer properly rather than reducing it to a bare label.
