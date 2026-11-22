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

## Saving, feedback and revert

- **An action bar is optional.** Add `PanelActions` only when the panel has something to commit; a panel whose controls apply as you use them has none.
- **Save feedback is a toast.** Dispatch `vcd:edit-toast` on `window` with `{ message: 'Saved', icon: 'success' }`; a failure is the same event with `icon: 'warning'` and the error as the message. Never add a status line under the actions.
- **Inline feedback, when asked for, lives in the button.** The Save button's label blur-fades to `Saved` and back (the icon-swap tokens in `global.css`); the panel's height does not change.
- **A panel that saves has Revert.** A ghost `Revert` button beside Save returns every control in the panel, and whatever it previews on the page, to the last save. Unsaved tuning may sit in browser storage until then; Save clears it.
- **Panel and page move together.** A preview in the panel and the thing it edits on the page update in the same gesture, before Save, as the image crop panel does.
- **Text beside a label matches the label.** A readout in a field's label row uses the label's type and sits at the row's trailing edge; `Field` styles an `<output slot="labelAccessory">` this way, so do not size or place it at the call site.

## Check it

Open the panel in a worktree preview and run `(await import('/scripts/dev-measure.ts')).report('.dev-overlay[data-dev-panel-key="<key>"]')`. All four `box` insets must read equal and every row `aligned`. Paste the output into the handoff.

## Motion and affordances

Panels fade with a slight rise and mirror it on exit; see [motion](motion.md). Floating layers inside a panel follow [menus](menus.md). A dashed hairline means editable and nothing else; see [colour and ink](colour-and-ink.md). Scrolling regions follow [scrollable overflow](spacing.md#scrollable-overflow).
