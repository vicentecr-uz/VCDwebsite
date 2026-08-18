# Button design system — build plan

A hands-on plan for rebuilding the site's buttons in Figma as one primitive with
a variant skin, so that shape lives in one place and colour lives in another.

Written to be read beside Figma while building. Steps are staged — you can stop
after any stage and still have something usable.

---

## Why this exists

Buttons in the codebase are currently rebuilt per component. The same control
(a viewport chip, an action button) is restated in four or five files with
slightly different padding, radius and colour each time. Related issues:
[#232](https://github.com/vcruzdesigns/VCDwebsite/issues/232) (viewport chip
styles diverge), [#233](https://github.com/vcruzdesigns/VCDwebsite/issues/233)
(extract shared tuner controls),
[#236](https://github.com/vcruzdesigns/VCDwebsite/issues/236) (hardcoded radius),
[#238](https://github.com/vcruzdesigns/VCDwebsite/issues/238) (`color/text` used
as a fill).

The Figma rebuild is where this drift became visible. Fixing it in Figma first
gives the code a target to migrate towards.

---

## The governing idea

**Master owns shape. Variants own skin.**

| Layer | Owns | Effect |
| --- | --- | --- |
| `Button Base` — one component | auto-layout, padding, gap, radius, layer inventory | change radius once, all variants follow |
| `Button` — one component set | fill, ink, ring per Emphasis × State | colour is the only thing that varies |

Radius propagates because nothing overrides it. Colour doesn't propagate because
every variant overrides it deliberately. That split is the whole design.

It also sets up dark mode: shape is theme-invariant, skin is theme-variant.
Modes swap the skin and never touch the shape.

---

## Hard constraints

1. **Instances cannot add or delete children.** `Button Base` must contain every
   layer any variant will ever need, up front. Fills, strokes, radius, padding
   and effects are *properties* and override freely — only layers are locked.
2. **Variants must be components**, so each variant is a thin wrapper containing
   one `Button Base` instance. Keep the wrapper transparent and Hug-sized; put
   all colour on the nested instance. Colour in two places is the most likely
   way to lose an hour later.
3. **Content is booleans, not variants.** `Show icon` / `Show label` as boolean
   properties plus an instance-swap for the icon. Making content a variant axis
   would take the set from 20 variants to 60.

---

## Decisions already made

- `Pressed` is distinct from `Selected`.
- `Selected + Hover` is **not** a distinct state. The existing CSS already
  treats them identically (`button:hover, button.is-active` share a rule in the
  crop tuner; grid and carousel have no hover rule for active at all), so State
  can stay one 5-value axis instead of splitting into a boolean.
- The delete button's smaller radius (`0.35em`) is drift — it unifies to
  `radius/control`.
- `Ground` (on-light vs on-dark) is a **variable mode**, not a variant.

## Still open

- **Padding.** Current spread across the codebase: `0.45/0.55` (chip),
  `0.5/0.65`–`0.5/0.7` (tuner actions), `0.55/0.75` (save bar),
  `0.45/0.4` (viewport chips), `0.35/0.65` (delete). Suggested unification:
  **8 / 11px**, closest to the tuner action buttons. Needs a decision.
- **Does the colour input keep `0.35em`?** The delete button is drift, but
  inputs may legitimately want a tighter radius than buttons. Affects #236.
- **Ghost's hover fill.** The save bar fills to `surface-strong`; section
  controls may differ. Confirm it's one behaviour before building Ghost/Hover.
- **Soft's resting fill.** `surface-soft` (#f5f5f7) in crop/caption vs
  `color-mix(surface-strong 70%)` in grid/carousel. Pick one.

---

## Tier 0 — tokens first

Create these before any component, so bindings exist when you need them.

**New collection `Ground`, modes `On Light` / `On Dark`:**

| Token | On Light | On Dark |
| --- | --- | --- |
| `button/ink` | `#1a1a1a` | `#ffffff` |
| `button/fill-soft` | `#e7e7e9` | `rgb(0 0 0 / 0.58)` |
| `button/fill-solid` | `#1a1a1a` | `#ffffff` |
| `button/ring` | `#e2e2e5` | `color-mix(bg 22%, #1a1a1a)` |
| `button/fill-press` | `#e2e2e5` | `color-mix(bg 12%, #1a1a1a)` |

**Flat tokens (no mode):** `color/danger` `#6a1010`, `color/danger-soft`
`#fff0f0`, `color/danger-border` `#dd8888` — per #234.

Bind everything. A typed hex here defeats the point of the exercise.

---

## Stage 1 — `Button Base` (30 min)

One component. No variants. This is the shape.

```
Button Base                  horizontal auto-layout, Hug × Hug
├─ Icon                      14×14, instance swap → Icon/*
└─ Label                     Hanken Grotesk Medium 13
```

- Padding: your decision from "Still open" above (suggested 8 / 11)
- Gap: 4
- Radius: bind → `radius/control`
- Fill: none (variants supply it)
- Add boolean properties `Show icon` and `Show label`
- Add instance-swap property on the Icon layer

**Done when:** toggling `Show icon` off leaves a text-only button that still hugs
correctly, and toggling `Show label` off leaves a square-ish icon button.

## Stage 2 — `Button` set, Rest only (45 min)

Four variants, property `Emphasis` = `Ghost` · `Soft` · `Solid` · `Danger`.

Each variant: a wrapper component (transparent, Hug) containing one
`Button Base` instance. Colour goes on the nested instance.

| Emphasis | Fill | Ink | Ring |
| --- | --- | --- | --- |
| Ghost | none | `button/ink` | none |
| Soft | `button/fill-soft` | `button/ink` | none |
| Solid | `button/fill-solid` | `button/ink` (inverted mode) | none |
| Danger | `color/danger-soft` | `color/danger` | `color/danger-border` |

**Done when:** changing `Button Base`'s radius updates all four variants at once.
That single test proves the whole architecture works — if it fails, the wrapper
is carrying styling it shouldn't.

## Stage 3 — add `State` (1 hr)

Second variant property, `State` = `Rest` · `Hover` · `Pressed` · `Selected` ·
`Disabled`. Takes the set to 20 variants.

| State | Change from Rest |
| --- | --- |
| Hover | Ghost → gains `button/fill-soft`; others → one step darker |
| Pressed | fill → `button/fill-press` |
| Selected | fill → `button/fill-solid`, ink inverted |
| Disabled | opacity `0.45` |

Figma adds variants to an existing set **non-destructively** — instances already
placed keep working. So there's no cost to stopping after Stage 2 and returning
to this later.

## Stage 4 — composition

```
Segmented Control      Button Count: 2 · 3 · 4
  └─ 2–4× Button instances (Emphasis=Soft), each Fill width
Viewport Selector      1× Segmented Control (3-button), labels baked in
```

`Selector Button` is deliberately **not** in this tree. A segment is just
`Button` with `Emphasis=Soft` and `State=Selected|Rest`, so a dedicated
component would add a nesting level without adding capability. Add it back only
if segments turn out to need something generic buttons never will.

---

## Gotchas

- **Fill width can't be baked into a component.** Fill is defined relative to a
  parent, and a main component has none. Set Fill on the instances inside
  `Segmented Control`; that's the correct place, not a workaround.
- **Deep override chains get awkward.** Four levels is manageable; five starts
  to hurt, and a high-level "reset overrides" can wipe deep ones. This is the
  main argument for skipping `Selector Button`.
- **Reordering or renaming layers in `Button Base` can orphan variant
  overrides.** Figma matches overrides by layer identity. Settle the layer
  inventory in Stage 1 before building 20 variants on top of it.

---

## Migrating the code afterwards

Out of scope for the Figma build, but the eventual target: one shared button
rule set that the tuners, save bar and gallery chips all reference, replacing
the per-file restatements. That's #233, unblocked once #232 and the padding
question above are decided.
