# Figma design system — architecture & agent handbook

Context for anyone (human or agent) picking up work in the VCD Website Figma file.
Read this before touching the Design System page.

**File:** `$FIGMA_FILE_KEY` · **Page:** `Design System` (`285:525`)

Companion docs: [`button-design-system.md`](button-design-system.md) is the original
build plan for Button specifically — still accurate on the governing idea, superseded
on specifics. [`product-vision.md`](product-vision.md) is long-horizon product intent.

**This doc is meant to grow with the site** — update it as the Figma system and the
site's own `/styles` design-system page evolve, the same way those two are expected
to grow. Don't let it go stale the way the old build checklist did; fold new
decisions and traps into the relevant section above rather than appending a change
log.

Anto's intent is for `/styles` to eventually live *inside* the Design System page
too — a kitchen-sink page in the literal sense ("everything but the kitchen sink"):
one page holding a live instance of every component and every state at once, so the
design system can be seen and played with directly rather than demoed piecemeal.

---

## What this is for

The Design System page is **not just a component library**. Anto's stated goal is
that it eventually holds **one live instance of everything on the site**, so he can
change the real thing directly instead of describing changes to an agent every time.
It's a kitchen-sink page, and that's deliberate.

The `/styles` route on the site is the code-side equivalent. The two are meant to
converge, but **they are not in sync today** — see *Relationship to code* below.

---

## Page architecture

Two top-level frames:

| Frame | Role |
| --- | --- |
| **Site Screens Ref** | Everything from the old `Site Screens` page, moved wholesale. Unreviewed, legacy, reference-only. To be deleted eventually. |
| **LGTM** | Signed-off work. Nothing enters without Anto's approval. |

This is a **filter, not a library split**. Material moves Ref → LGTM one piece at a
time as it's rebuilt on the new architecture. The old `Site Screens` page is now
empty and can be deleted.

**The admission test is objective:** a frame can enter LGTM when zero instances
inside it resolve to a master living in Site Screens Ref. Check it with a traversal,
not by eye — `getMainComponentAsync()` on every instance, then walk `parent` up to
see whether the chain passes through `Site Screens Ref` or `LGTM`.

### The tier ladder (inside LGTM › Dev Components › Container)

Ordered by **compositional depth**, not category. Nothing in a tier may depend on
anything to its right:

1. **Particles** — icons, type ramp, crop handle. Things with no interactive identity.
2. **Atoms** — `Button Base`, `Field Base`, `Checkbox Base`, `DevPanel Base`, `Traffic Light Base`, `Traffic Light Container`. Shape only, no skin.
3. **Atom Variants** — `Button`, `Field`, `Checkbox`, `traffic-light`, `Dev Panel Title`, `DevPanel Content`. Skin + state.
4. **Elements** — `Button Container`, `Panel Actions`, `dev-overlay__lights`. Compositions of atom variants.
5. **Component Variants** — `Segmented Control`.
6. **Dev Panel Components** — `dev-overlay__head`, `Select Field`, `Text Field`, `Text Area`, `Toggle Row`, `Viewport Selector`.
7. **Dev Panels** — assembled panels. Currently `Project settings`, `Caption`.

Each tier frame is `Frame Name Container` + `Contents`, driven off a `Frame Template`
component so labelling stays consistent.

---

## The governing pattern: Base + Variants

**Master owns shape. Variants own skin.** Applied consistently:

| Atom (shape) | Variant set (skin/state) |
| --- | --- |
| `Button Base` — radius, padding, slots, min-size | `Button` — Emphasis × State (20) |
| `Field Base` — `radius/input`, padding, slots | `Field` — State (Rest/Hover) |
| `Checkbox Base` — 16×16 fixed, `radius/checkbox` | `Checkbox` — Checked × State (6) |
| `DevPanel Base` — header + Contents slot | `DevPanel Content` — one variant per panel |

**Why it matters:** change radius once on the atom, every variant follows. Colour
never propagates because every variant overrides it deliberately. That split is the
whole design, and it also sets up dark mode — shape is theme-invariant, skin isn't.

### Content is booleans, not variants

Hard rule, repeatedly validated. `Button Base` has `Show leading icon` /
`Show label` / `Show trailing icon` as booleans plus instance-swap for the icon
itself. Making content a variant axis would take Button from 20 variants to 60+.

Same for `Button Container` (`Show button 3/4`) and `Panel Actions`
(`Show button 1/2`). Hidden children drop out of auto-layout flow, so the parent
hugs correctly.

**Exception — Checkbox.** Anto explicitly chose a variant set over the (mechanically
possible) boolean approach, because seeing every state side by side is worth more
than the layer saving for a control this small. Don't "optimise" it back.

---

## Token architecture

Seven collections:

| Collection | Modes | Purpose |
| --- | --- | --- |
| `Color Palette` | Mode 1 | Raw ramps: `grey/0–1000`, `red/50–950`. Tailwind's red scale. |
| `Color - Theme` | Light / Dark | Semantic. `button/*` (new system), `color/*` (mirrors `global.css`). |
| `Content` | Ink / Ink-Solid / Danger-Text / Bg | Which ink **role** for icon + label inside a control. |
| `Ink Emphasis` | Full / Subtle | How **strong** that ink is. |
| `Primitives` | Mode 1 | Radii, spacing, motion, opacity. |
| `Responsive` | Desktop / Mobile | `space/unit` only. |
| `Color - Adaptive` | On Light / On Dark | `color/title` only (legacy). |

### The two-axis discovery — read this before adding modes

`Content` and `Ink Emphasis` are **deliberately separate collections** solving a real
combinatorial problem.

Originally there was one collection whose modes tried to encode both "which ink role"
*and* "is it subtle" — which forces every combination to become its own mode
(`Ink-Subtle`, `Ink-Solid-Subtle`, `Danger-Subtle`…). Anto hit the wall directly:
he needed `button/ink-solid-subtle` but couldn't map two things to one variable.

Splitting them makes the axes **compose instead of multiply**:

- Set `Content` mode on the button → picks the role.
- Set `Ink Emphasis` mode on an **individual layer** → picks Full or Subtle.

Because Figma resolves variable modes per-node with inheritance, setting Emphasis on
just the icon layer mutes the icon while its sibling label stays full strength. That's
how the Select Field's chevron reads quieter than its value.

**Economics: 6 mode definitions cover 8 combinations.** Flat, it'd be 8 modes, and a
fifth role would cost 2 more instead of 1. **If you find yourself adding a mode that
names two concepts at once, split the collection instead.**

`Subtle` is currently a no-op for `Danger-Text` and `Bg` — deliberate, per Anto.
Extending it is one variable (`emphasis/danger`), not new modes.

### Spacing inside Dev Panels

Two tiers of rhythm:

- **12** — normal gap between adjacent fields (`DevPanel Base`, `Contents`, both panel bodies, `Row`). Currently literal, not tokenized. Tokenize when it's worth it.
- **`space/dev-panel-spacing`** (8) — extra break at *section* boundaries: below `dev-overlay__head`, below the viewport selector, above `Panel Actions`.

**One source per boundary.** The below-header gap is `header paddingBottom (8) +
DevPanel Base gap (12) = 20`, and nothing else. Panel-level `paddingTop` is 0 on
every panel deliberately — an earlier version had three sources feeding one gap,
implemented differently per panel. Don't reintroduce it.

---

## Figma Plugin API — hard limits (verified, not assumed)

These cost real time to discover. All were tested directly against live nodes.

### Component properties

- **`componentPropertyReferences` accepts only `visible`, `characters`, `mainComponent`.** Nothing else. `opacity` returns "Unrecognized".
- **No property type can drive colour or opacity.** The enum is `BOOLEAN | TEXT | INSTANCE_SWAP | IMAGE | SLOT | NUMBER | VARIANT`. `NUMBER` exists but cannot attach to `opacity`. Use **variable modes** for colour/strength instead.
- **A property cannot bind to a layer inside a nested instance** — only to layers native to the component. Error: *"Cannot set component property references on instance sublayer"*. This is why `DevPanel Base` couldn't expose the title directly; the fix was making `Title` a property on `dev-overlay__head` (where the text *is* native) and then setting `isExposedInstance = true` on the nested header.
- **`isExposedInstance`** on a nested instance surfaces its properties on the parent's panel. Real, useful, easy to miss.
- **`INSTANCE_SWAP` defaults take a node id, not a component key.** Passing a key throws "Property value is incompatible with component property type".

### Sizing

- **`minWidth`/`minHeight` cannot be overridden on an instance** — master-only. If a floor must vary per placement, it has to live on a master or be achieved another way.
- **`layoutSizing` overrides *can* be set on instances**, including nested ones. This is the lever when `minWidth` isn't.
- **FILL requires a definite-width parent.** A hugging parent with a filling child is circular; Figma silently resolves it by pinning the child to `FIXED` at its current width. This has bitten repeatedly — see *Traps*.

### Variables

- **Colour variables have no alpha channel you can set separately.** You cannot alias a variable and layer opacity on top — binding a fill to a variable removes the opacity control entirely. Bake alpha into the variable's own literal value per mode (that's what `button/fill-ghost-hover` does).
- **No derived/conditional properties.** Nothing can say "if Panel = X then Title = Y". `DevPanel Base`'s `Panel` and its header's `Title` are two dropdowns you keep in sync by hand. Accepted tradeoff.

### Attribution

**There is no per-node edit attribution.** `lastModifiedBy`, `lastModified`,
`updatedAt`, `editedBy` are all absent; `currentUser`/`activeUsers` are blocked in
the MCP context. `saveVersionHistoryAsync` exists but is file-level.

`getSharedPluginData`/`setSharedPluginData` **are** available and currently unused —
a viable way to stamp agent-touched nodes if the "who changed this" problem recurs.

---

## Traps that have actually bitten

1. **Overridden instances stop inheriting.** Change something on a master and one
   placement won't follow — because that placement was customised earlier. Hit twice
   (Checkbox rebuild, Panel Actions icons). **Verify per-instance, don't trust the
   master edit.**

2. **FILL-inside-HUG pins children to FIXED.** Appending FILL-sized masters into a
   hugging container freezes them at creation-time width. Symptom: buttons that don't
   resize when their label changes. Fix: set the child to `HUG`, or give the parent a
   definite width.

3. **`SPACE_BETWEEN` with one child parks it at the start.** Invisible until the child
   is narrower than its parent. Was the root of the Viewport Selector misalignment —
   the wrapper had Figma's untouched defaults (`SPACE_BETWEEN`, counter `MIN`, gap 10).

4. **`combineAsVariants` doesn't lay variants out or add the dashed border.** UI-created
   sets get both free. Via API you must position each variant, resize the set, and apply
   the stroke manually: solid `#8a38f5`-ish, `dashPattern: [10, 5]`, `strokeAlign: INSIDE`,
   `cornerRadius: 12`, 24px inset. It also **only accepts `COMPONENT` children** — build
   each variant as a component first (`createComponentFromNode`), then combine.

5. **Empty grid tracks don't collapse.** A 2-column grid holding one item left a phantom
   column ~3000px wide. Set `gridColumnCount` to match actual content.

6. **Freeform → Grid conversion defaults tracks to `FLEX`, not `HUG`.** Cells then divide
   a stale fixed width instead of fitting content.

7. **Instances cannot add or delete children.** Any layer a variant will ever need must
   exist in the base up front.

8. **Renaming a layer orphans its property references.** `Show label` on `Button Base`
   was silently dead for a while because the raw text node had been swapped for a
   component instance. Toggling it did nothing. **If a boolean seems inert, check
   `componentPropertyReferences` on the target child.**

9. **Nested-instance IDs invalidate mid-loop.** Updating a master while iterating over
   instances nested inside placed copies throws "node not found". Sequence it: fix the
   master template → fix placed overrides → sweep the file → then delete the old master.

---

## Relationship to code

**The Figma `button/*` tokens do not exist in the codebase.** They're new work.

The `color/*` family in `Color - Theme` is a 1:1 mirror of the 15 colour custom
properties in `src/styles/global.css`. That's the "Figma mirrors the source" origin.

So the two token families are two clean layers nobody labelled:
`color/*` is *what the site currently is*, `button/*` is *what it's being designed into*.
The migration ahead is teaching the source about `button/*`.

Genuinely dead in the source (0 `var()` references): `--color-link-strong-hover`,
`--color-surface-control-strong`. Everything else in `color/*` is live — `--color-text`
alone has 126 uses. **Don't delete `color/*` tokens on the basis of Figma usage.**

---

## Current state

**Built and in LGTM:** full Button system (20 variants), Field/Field Base, Checkbox
(2×3), Segmented Control, Button Container, Panel Actions, Select Field, Text Field,
Text Area, Toggle Row, dev-overlay__head, traffic lights, DevPanel Base + Content,
10 icons, 5 type components.

**Dev Panels assembled: 2 of 5** — Project settings, Caption. Both fully LGTM-sourced.

**Remaining 3 panels** — Edit image, Edit grid, Edit carousel. Each needs its body
extracted into `DevPanel Content` as a new variant, same as Caption. Titles already
exist for all five.

**Components still needed** (all still legacy-only in Ref):

- **Grid Thumb** — image thumbnail with remove-on-hover. **15 instances** across Edit grid + Edit carousel — the single biggest remaining dependency. Related: `Board — Drop Target`, `project-grid-tuner__thumb.is-dragging` (the image re-order interaction).
- **Slider track / Slider Row** — Edit image's zoom control.
- **Crop lock toggle** — needs `Icon/Lock` + `Icon/Unlock` (currently 🔒 emoji).
- **Crop center controls** — needs `Icon/AlignCenterX` / `Icon/AlignCenterY`. **Decided:** two distinct Lucide icons (`align-center-horizontal` / `align-center-vertical`), re-weighted from Lucide's stroke-2/24px to match the existing ~1.17–1.33 stroke on a 16px grid.

Legacy components in Ref that are **superseded, not migrated** — `Button Default/Dark/Outline/Danger`, `SegButton *`, `Text Pill`, `Icon Chip`, `Icon Control`, plus the three `*Hover` components that only existed because the old system had no State axis.

---

## Working conventions

- **Anto edits the file in parallel.** Unexpected state changes are often his work,
  not corruption. **Ask before "fixing" something you didn't just touch.** This has
  already caused one wrongly-reverted edit.
- **Verify visually.** Screenshot after structural changes — several bugs (clipped
  buttons, wrong ordering, stale widths) were only visible in a render, not in
  property values.
- **Verify the consumer, not just the component.** After changing an atom, screenshot
  something two levels up that depends on it.
- **Anto tests the work.** Hand him a numbered script and stop; don't drive interactive
  UI headlessly. (Project convention — see `CLAUDE.md`.)
- **Component descriptions are the real documentation.** They travel with the component
  and surface in `get_design_context`. A standalone checklist doc was tried and deleted
  — it drifted within days. Put the *why* in the description.
- **Batched API writes can leave the canvas stale.** Elements sometimes render out of
  place until a real interaction forces relayout; a 1px nudge fixes it. There is no
  API to force a relayout pass. Don't chase it as a config bug — but do check
  properties first to rule out a real one.
