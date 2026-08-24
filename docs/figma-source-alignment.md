# Aligning source components with the Figma system

A plan, not a commitment. Written for review before any of it starts.

## Where the two sides stand

Figma now has a real composition chain:

```
Button Base  →  Button (Emphasis × State)  →  Button Container  →  Segmented Control
                                                                        ↓
                                              Viewport Selector · Theme Selector
DevPanel Base + DevPanel Content  →  Dev Panels (5)
Field Base → Field · Select Field · Text Field · Text Area · Toggle Row · Panel Actions
```

Source has none of that structure. Each dev tuner hand-rolls its own markup and CSS.
They now share **tokens** (that landed this session) but not **components** — so a
button in `ProjectImageCropTuner.astro` and a button in `DevTextEditor.astro` are two
unrelated pieces of CSS that happen to look alike.

## Is this worth doing?

Honest split:

- **The primitives are worth it.** Button/field/panel markup is duplicated across ~10
  components. One `Button.astro` with `emphasis`/`state` props removes real
  duplication, and makes the next dark-mode pass one edit instead of ten.
- **Rewriting the working tuners is high-risk, low-reward.** Crop, grid and carousel
  tuners are intricate, heavily JS-wired, and *work*. Rebuilding their markup to look
  tidier risks breaking drag, pointer capture, and Save for no user-visible gain.

So: build the primitives, adopt them opportunistically, and **do not** schedule a
big-bang tuner rewrite.

## The single biggest landmine

**The tuners select DOM by `data-*` attribute and class name.** Every JS handler,
every Save path, every drag interaction depends on the exact attributes in the current
markup (`[data-crop-zoom]`, `[data-grid-item-id]`, `.project-grid-tuner__thumb`, …).

Any markup change must preserve those **exactly**. A primitive that renders a button
without passing through `data-crop-save` silently disables Save — and it will still
build, still look right, and still pass every check. This must be in every spec.

## Staged plan

### Stage 1 — presentational primitives (delegable)

New `src/components/ui/`, pure presentation, no behaviour, no data attributes of their
own — every one accepts and spreads arbitrary attributes so callers keep their hooks.

| Component | Mirrors | Props |
| --- | --- | --- |
| `Button.astro` | `Button` | `emphasis` (ghost/soft/solid/danger/page), `state`, `leadingIcon`, `trailingIcon`, `label` |
| `SegmentedControl.astro` | `Segmented Control` | `items[]`, `value` |
| `SelectField.astro` | `Select Field` | `label`, `value`, `options` |
| `TextField.astro` / `TextArea.astro` | `Text Field` / `Text Area` | `label`, `value` |
| `ToggleRow.astro` | `Toggle Row` | `label`, `checked` |
| `PanelActions.astro` | `Panel Actions` | `buttons[]` |
| `DevPanel.astro` | `DevPanel Base` | `title`, slot for body |

Each must be added to `/styles`, since the project convention is that only components
listed there may be used.

**Verification:** `bun run build`, `bun run tokens:check`, and the `/styles` page
renders each primitive in both themes. No existing component changes in this stage,
so nothing can regress.

**Good worker task** — self-contained, well-specified, verifiable without a browser.

### Stage 2 — adopt in one panel (manager-led)

Rebuild **Project settings** (the simplest, fewest interactions) on the primitives,
preserving every existing `data-*` hook. Diff the rendered DOM before/after — the
attribute set must be identical.

Not delegable blind: the value is in knowing which attributes are load-bearing.

### Stage 3 — roll out, one panel per PR

Caption → Edit image → Edit grid → Edit carousel. Each one separately, each verified by
Anto actually using the panel (drag, crop, Save), because a green build proves nothing
here.

### Stage 4 — Code Connect (optional)

Map Figma components to their source counterparts so `get_design_context` returns real
code instead of generated approximations. Cheap once Stage 1 exists; pointless before.

## What would make me stop

If Stage 2 shows the primitives can't express a panel without contorting them, that is
evidence the Figma composition and the source's real needs have diverged — and the
right response is to change the Figma side, not to force the code. Stage 2 is
deliberately the smallest possible test of that.
