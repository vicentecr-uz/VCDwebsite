# Dev panels

Read when building or changing a dev panel. The `design-system-first` skill walks through the same steps.

## Structure

A floating panel is `DevOverlay` (`src/components/DevOverlay.astro`, rendering `ui/DevOverlayFrame.astro`); an in-flow card is `DevPanel`. Give a `DevOverlay` a `panelKey` whose title comes from `src/lib/devPanelTitles`, put header buttons in `slot="head-actions"`, and put one content root in the default slot, assembled from `Field`, `RangeField`, `TextField`, `TextArea`, `EditorSelectField`, `ToggleRow`, `SegmentedControl`/`ViewportSelector`, `Button`, `Hairline` and `PanelActions`.

## The panel owns its inset

- `DevOverlay` pads all four sides with `--dev-panel-pad` (12px), separates head and body with `--dev-panel-gap` plus the head's `--dev-panel-spacing`, and spaces body children with `--dev-panel-content-gap` (16px). `DevPanel` uses the same tokens.
- Content never sets padding or margin on its root, and never adds bottom padding or margin to its last child. Room an animation needs goes inside the animated element or into the panel component, so the bottom inset always equals the side inset. `scripts/test/dev-chrome-ownership.test.ts` fails otherwise.
- The bottom row of actions is `PanelActions`, which owns its gap and top spacing.
- Never re-set `.dev-overlay`, `.dev-overlay__head` or `.dev-overlay__body` padding, gap or radius at a call site; change `devOverlayFrame.css`.
- Texts that share a row share a baseline. Align rows with `align-items: baseline` or by composing a component that already does, not with nudged margins.

## Check it

Open the panel in a worktree preview and run `(await import('/scripts/dev-measure.ts')).report('.dev-overlay[data-dev-panel-key="<key>"]')`. All four `box` insets must read equal and every row `aligned`. Paste the output into the handoff.

## Motion and affordances

Panels fade with a slight rise and mirror it on exit; see [motion](motion.md). Floating layers inside a panel follow [menus](menus.md). A dashed hairline means editable and nothing else; see [colour and ink](colour-and-ink.md). Scrolling regions follow [scrollable overflow](spacing.md#scrollable-overflow).
