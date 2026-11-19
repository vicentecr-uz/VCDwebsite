# Prototyping options

Read this when the owner asks to see options, versions, variations or directions, or to compare two ideas before deciding.

Follow the `emil-prototype` skill's workflow when the harness has it: scope one piece, build genuinely different variants on a named axis, use real materials and the worst real content, verify each, present them with when each wins and what it costs, then stop for the owner's pick. Without the skill, that sentence is the workflow.

**One exception: the picker.** Never build the skill's dark pill (`PICKER.md`). Use `DevVariantPicker` (`src/components/DevVariantPicker.astro`): the same floating bar, Segmented Control and sliding selection as the canvas's Viewport bar (⌥1, ⌥2, ⌥3).

```astro
{import.meta.env.DEV && (
  <DevVariantPicker
    label="Pager"
    target="[data-writeup-pager]"
    variants={[{ id: 'collapse', label: 'Collapse' }, { id: 'index', label: 'Index only' }]}
  />
)}
```

- **Wiring:** the picker writes the chosen `id` to `data-variant` on `target`; each variant is CSS or script keyed on that attribute. Give `target` the first variant's id in its markup so the page renders correctly before the picker runs.
- **Dev only:** render it behind `import.meta.env.DEV`. Production must fall back to one variant without the picker.
- **Placement:** bottom centre, like the Viewport bar. Pass `position="top"` when the variants themselves sit at the bottom of the screen. One picker per page.
- **Keys:** `1`–`N` choose, `←`/`→` step; ignored while typing or with a modifier held. The choice persists in `?v=N`.
- **Labels** name each direction ("Collapse", "Index only"), never "Option A".
- **In place or isolated:** prefer the real page when the variant depends on its context (scroll position, real content, neighbours); keep each variant's code clearly fenced so the losers can be deleted in one pass.

When the owner picks, write the decision and the rejected options in the PR description, then remove the losing variants, the picker mount and any `data-variant` hooks.
