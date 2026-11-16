# Interface conventions

Read this before any site or dev-layer UI work. It holds the rules every UI task needs; open a topic file only when the table below sends you there. The `design-system-first` skill carries the same workflow. Root [`AGENTS.md`](../AGENTS.md) owns delivery.

## Always

- **Compose, don't style.** Build from `src/components/ui/` and the blocks on `/styles`. A component owns its padding, gap and radius; a call site never sets them. To change one, change the component so every instance moves together.
- **Tokens only.** Page spacing is `var(--space-unit)`; dev chrome reads the `--dev-*` tokens in `global.css`. No literal spacing, and no re-pointing a token at a call site.
- **Measure, don't eyeball.** In a preview, `(await import('/scripts/dev-measure.ts')).report('<selector>')` prints all four insets and the baselines of texts sharing a row. Equal means within 0.5px.
- **Floating layers** are native popovers, and menus are `Menu` (`.dev-menu`).
- **Motion:** dev chrome fades, never pops; reduced motion removes travel, never the fade.
- **Labels only.** A control names itself and stops: no subtitles, helper text, panel intros or volunteered tooltips. Keep accessible names, units and error text.
- **Checks:** `bun test scripts/test/dev-chrome-ownership.test.ts scripts/test/top-layer-floating.test.ts` before handing off UI work.

## When the component does not exist

1. Stop and say which component or page block is missing. Do not style a one-off at the call site.
2. Build it into `src/components/ui/` (or as a content block) with a specimen on `/styles`: properly, or as a good-enough version marked `good-enough: #<issue>` at the top of its file.
3. Spend at most two rounds of iteration on a good-enough version.
4. File a GitHub issue (label and milestone) to finish it, and put its number in the marker.

## Doing X? Read Y

| Doing | Read |
| --- | --- |
| Building or changing a dev panel (`DevOverlay`, `DevPanel`) | [panels](interface/panels.md), or the `design-system-first` skill |
| Menus, dropdowns, listboxes, popovers, tooltips | [menus](interface/menus.md) |
| Fields, selects, sliders, toggles, segmented controls | [fields](interface/fields.md) |
| Any animation or transition, page transitions | [motion](interface/motion.md) |
| Page spacing, type, widths, breakpoints, viewport height, overflow | [spacing](interface/spacing.md) |
| Colour, ink, page ground, links, edit affordances | [colour and ink](interface/colour-and-ink.md) |
| Choosing or adding components, buttons, hit areas, page blocks, labels | [components](interface/components.md) |
| Demo frames, embedded demos, Stageshow | [demo frames](interface/demo-frames.md) |
| Figma | [figma](interface/figma.md) |
| About page | [about page](interface/about-page.md) |
