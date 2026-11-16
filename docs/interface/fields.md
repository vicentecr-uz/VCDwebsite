# Fields, selects and sliders

Read when adding or changing a form control in dev chrome.

- **Field** (`ui/Field.astro`) stacks a label row over a value box. It owns the label gap (`--dev-panel-label-gap`), the value box padding (`--dev-field-padding`), radius and hover/focus fills, and the hit slop (`--dev-hit-inset`). Put a label accessory in `slot="labelAccessory"`; never pad or round `.dev-field__value` or `.dev-field__input` at a call site.
- **TextField / TextArea** wrap `Field`. Overflowing text fades with a gradient mask (`src/lib/fieldOverflow.js`) rather than clipping hard.
- **EditorSelectField** is the one select. Its trigger value and options read `--dev-text-select-value`, so the open listbox overlays the value exactly; see [menus](menus.md).
- **RangeField** is the slider: a fill track with a thin thumb and the value printed inside the track, in the field's own box. Pass `unit` for an inline unit (`px`, `%`).
- **ToggleRow** is a checkbox with its label; **SegmentedControl** is a group of `Button`s, and `ViewportSelector` is the Desktop / Tablet / Mobile segmented control. Add `data-slide-selection` for the sliding pill.
- `select-typography.test.mjs` and `select-open-highlight.test.mjs` hold the select rules; `dev-chrome-ownership.test.ts` holds the spacing ownership.
