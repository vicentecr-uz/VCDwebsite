# Figma design system — architecture & agent handbook

Context for anyone (human or agent) picking up work in the VCD Website Figma file.
Read this before touching the Design System page.

**File:** `$FIGMA_FILE_KEY` · **Page:**
[`Design System`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=285-525)

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

The page has one top-level frame:
**[LGTM](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=391-2710)**,
the signed-off design system and its kitchen-sink specimens.

LGTM has side-by-side
**[Light](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=480-1237)**
and **[Dark](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=481-1237)**
columns. Light is the working, populated column. Dark is intentionally empty while
Anto is not actively working on dark mode; it is not a mirror that must be kept
current. When a dark pass is useful, copy the frames inside Light into Dark. Dark's
explicit `sys/Dark` mode then resolves their bound variables automatically.
Dark also still carries the deprecated `_deprecated Color - Theme/Dark` override.
It is inert for current masters and can disappear with that deprecated collection;
do not use it as the active theme mechanism.

Within Light, `Tokens Group` comes first, followed by `Dev Components`, `Layout
Blocks`, and `Site Pages`. The latter two are page-level areas for larger
compositions and eventual screen specimens; reusable component masters belong in
the tier ladder below.

### The tier ladder (inside LGTM › Dev Components › Container)

The ladder is a **reading and organisation model**, ordered from small reusable parts
toward assembled UI. It is not a strict dependency DAG: a structural base may hold a
default or swappable instance whose master is displayed in a later tier. Place a
master by what it owns and how it is used, not by forcing every dependency to point
left.

1. **[Particles](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-3348)** — icons, type particles, hairlines and crop handles; things with no interactive identity.
2. **[Atoms](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-3356)** — structural bases such as `Button Base`, `Field Base`, `Checkbox Base`, `DevPanel Base` and `Footer Base`.
3. **[Atom Variants](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-3368)** — skin/state families such as `Button`, `Field`, `Checkbox`, `traffic-light`, `Grid Thumb`, `Save bar`, `DevPanel Layout` and `Footer`.
4. **[Elements](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-3376)** — small compositions such as `Button Container`, `Slider Row`, `Crop Toolbar`, `Crop Stage`, `Thumb Board` and `dev-overlay__lights`.
5. **[Component Variants](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-3384)** — variants of larger compositions, currently including `Segmented Control` and `Checked Field`.
6. **[Dev Panel Components](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-3392)** — panel-ready controls such as `dev-overlay__head`, `Select Field`, `Text Field`, `Text Area`, `Toggle Row`, `Panel Actions` and the viewport/theme selectors.
7. **[Dev Panel Contents](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=531-21987)** — the `DevPanel Content` set, with one body variant per panel type.
8. **[Dev Panels](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=397-4502)** — assembled panel specimens plus related authoring-chrome specimens.

Each tier shell is plain frame scaffolding: `Frame Name Container` + `Contents`.
There is no shared `Frame Template` component relationship to preserve.

---

## The governing pattern: Base + Variants

**Master owns stable structure. Variants own selectable skin/state.** This is the
recurring pattern:

| Base structure | Variant family |
| --- | --- |
| `Button Base` — radius, padding, slots, min-size | `Button` — Emphasis × State (25) |
| `Field Base` — `radius/input`, padding, slots | `Field` — State (Rest/Hover) |
| `Checkbox Base` — 16×16 fixed, `radius/checkbox` | `Checkbox` — Checked × State (6) |
| [`Footer Base`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=926-4038) — structure built from the [`Footer text`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=778-4307) particle | [`Footer`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=722-4165) — State (Rest/Hover) |
| `DevPanel Base` — shared header + content structure | `DevPanel Layout` — Layout × State (4) |

**Why it matters:** change radius once on the atom, every variant follows. State skin
is chosen at the variant layer, either through a paint override or through inherited
`Content` / `Ink Emphasis` modes. That split is the whole design, and it also sets up
dark mode — shape is theme-invariant, skin isn't.

`DevPanel Content` is not the skin half of `DevPanel Base`. It is a separate family
of ten panel bodies, selected through the base's `Panel` instance swap. A complete
panel reads as `DevPanel Layout` → `DevPanel Base` → `dev-overlay__head` +
`DevPanel Content`; the header swaps a matching `Dev Panel Title` variant.

### Content is booleans, not variants

Hard rule, repeatedly validated. `Button Base` has `Show leading icon` /
`Show label` / `Show trailing icon` as booleans plus instance-swap for the icon
itself. Making content another variant axis would multiply the existing 25-state
Button matrix for no structural benefit.

Same for `Button Container` (`Show button 3/4`) and `Panel Actions`
(`Show button 1/2`). Hidden children drop out of auto-layout flow, so the parent
hugs correctly.

**Exception — Checkbox.** Anto explicitly chose a variant set over the (mechanically
possible) boolean approach, because seeing every state side by side is worth more
than the layer saving for a control this small. Don't "optimise" it back.

---

## Token architecture

Colour follows Material 3's **class** structure with the `md.` prefix dropped —
`ref` / `sys` / `comp`. Each tier is its own Figma collection **because each needs a
different mode structure**, and modes are per-collection:

| Collection | Modes | Purpose |
| --- | --- | --- |
| `ref` | Value | 207 raw colour primitives: the Tailwind v4 chromatic ramps plus the custom `grey`, `warm/800` and `brand/*` values. Literal hex, theme-invariant. |
| `sys` | Light / Dark | 42 semantic roles — `color/srf`, `color/on-srf`, `color/outline-container`, `color/outline-on-srf`, `color/error*`. **The only tier that carries light/dark.** Surface ladder is M3's: `srf` → `srf-container-low` → `srf-container` → `srf-container-high`. |
| `comp` | Value | 49 component rules — `button/*`, `traffic-light/*`, `footer/*` and other state families. **One mode on purpose.** |
| `Content` | Ink / Ink-Solid / Danger-Text / Bg | 2 variables selecting which ink **role** applies to icon + label inside a control. |
| `Ink Emphasis` | Full / Subtle | 2 variables selecting how **strong** that ink is. |
| `Primitives` | Mode 1 | 22 radii, spacing, motion and opacity values. |
| `Responsive` | Desktop / Mobile | `space/unit` only (1 variable). |
| `_deprecated Color Palette` / `_deprecated Color - Theme` / `_deprecated Color - Adaptive` | — | Hidden pre-refactor collections (24 / 45 / 1 variables), kept as the undo path. Current component masters do not bind to them. |

### Why the tiers are separate collections

`comp` having **one mode is the load-bearing decision.** There is no dark slot to
hardcode, so theme-sensitive `comp` tokens ultimately resolve through `sys` — dark
mode is inherited rather than re-decided per component. Fixed brand values may alias
`ref`, related component values may alias another `comp` token, and the ghost fill is
a deliberate transparent literal. Before the refactor, ~20 `button/*` tokens each
carried their own Light and Dark values; that was the same theme decision made twenty
times, and it is why dark mode was painful.

Naming is a **mechanical transform in both directions**, so no lookup table exists or
is needed:

```
CSS name = "--" + collection + "-" + variable path with "/" → "-"

sys  · color/on-srf           →  --sys-color-on-srf
comp · button/filled/label    →  --comp-button-filled-label
ref  · palette/grey/100       →  --ref-palette-grey-100
```

**Every ramp runs dark→light** (Material 3 tone direction): `grey/0` is black,
`grey/1000` is white, `red/50` is the darkest red, `red/950` the lightest.

The rule for the Tailwind hues is **ours = 1000 − Tailwind step**. It mirrors around
500, so every mapped step lands on a real Tailwind step (50↔950, 200↔800, 500↔500),
and `grey/N`, `red/N` and `blue/N` all mean the same lightness. **Watch out:** the
number is the same as Tailwind's but the *meaning* is inverted — our `red/50` is
Tailwind's `red-950`.

Values are Tailwind **v4** (read from `node_modules/tailwindcss/theme.css` and
converted oklch→hex). The original red ramp was v3, so danger colours shifted slightly
when the palette landed.

`surface` is abbreviated **`srf`** throughout, matching how Anto writes it by hand.

**Two roles were deliberately retired**, so don't reintroduce them: `on-srf-muted`
(merged into `on-srf-variant` — M3 carries two ink weights, not three) and
`srf-variant` (replaced by `srf-container-low`; M3 has effectively retired
`surface-variant`, and only the `on-surface-variant` pairing survives).

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
the MCP context. **`saveVersionHistoryAsync` is NOT available through the MCP bridge**
— it throws *"not a supported API"* (verified 2026-08-23; an earlier version of this
doc wrongly listed it as usable). There is no way to create a *named* restore point
from an agent. Figma's own autosave history still works from the UI, and the practical
substitute is to export the frame as a PNG (`exportAsync` → `figma.createImage`) and
park it beside the original as a frozen visual reference.

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

9. **A cloned variant inherits the source's variable-mode overrides.** `Emphasis=Page`
   was cloned from `Emphasis=Solid` and silently kept Solid's `Content=Ink-Solid` mode.
   That is correct for Solid (dark fill, white ink) and wrong for Page (fill *is* the
   page), so every icon placed in a Page button rendered white-on-white — invisible,
   with correct geometry, visibility and strokes. **Fills and inks were rebound; the
   mode override was not, because it isn't a fill.** After cloning a variant, check
   `explicitVariableModes`, not just paints.

10. **Nested-instance IDs invalidate mid-loop.** Updating a master while iterating over
   instances nested inside placed copies throws "node not found". Sequence it: fix the
   master template → fix placed overrides → sweep the file → then delete the old master.

---

## Relationship to code

The repo's token files and generated CSS form one code-side pipeline, but the live
Figma variables and `tokens/design-tokens.json` have **material drift today**. Neither
side is safe to overwrite blindly from the other. Reconcile names, aliases and values
before the next Figma or code token write, then update both representations from that
reviewed result.

**Current drift snapshot (`2026-09-02`):** live Figma has `207 / 42 / 49`
`ref / sys / comp` variables; `tokens/design-tokens.json` has `206 / 44 / 39`.
Notable Figma-only material includes `warm/800`, `outline-on-srf`,
`inverse-srf-disabled`, checkbox states, toolbar outlines, the colour-swatch outline
and the field placeholder. Code retains the old `outline` role and four media-ink
roles that are absent from Figma. Two values also disagree: Light `on-srf` is
`grey/100` in Figma versus `grey/150` in code, and `outline-variant` is `warm/800`
versus `grey/800`.

Footer exposes the most immediate regression risk. Figma and the checked-in generated
CSS use Rest → `srf-container` and Hover → `srf-container-high`; the JSON still says
Rest → `srf-container-low` and Hover → `srf-container`. Therefore `bun run
tokens:check` currently fails, and running `tokens:build` before reconciliation would
overwrite the newer CSS aliases with the older JSON graph.

- `tokens/design-tokens.json` (DTCG format) is the code-side source for generated colour CSS.
- `bun run tokens:build` regenerates the block between `/* @tokens:start */` and
  `/* @tokens:end */` in `src/styles/global.css`. Idempotent; never hand-edit that block.
- `bun run tokens:check` fails on drift — an undefined `var(--ref|sys|comp-*)`, a
  leftover `--color-*`, stale generated CSS, **or** a mismatch against the Figma name
  snapshot in `tokens/figma-tokens.json`.

**`tokens/figma-tokens.json` is a manual name snapshot, not proof of parity.** Nothing
refreshes it automatically. Once a Figma variable change has been reconciled with the
code graph, re-export the `ref`/`sys`/`comp` collections and rewrite the snapshot, or
`tokens:check` will fail. Do not refresh the snapshot merely to make an unexplained
Figma/code difference pass.

### Editing a colour

The editor/API deliberately allows value edits only on `ref`; treat that as a product
policy rather than a claim that every `sys` and `comp` value is an alias. Nineteen
live `sys` roles still use deliberate hot-pink placeholder literals, and
`comp.button.ghost.container` is literal transparent. For established semantic and
component roles, change what the role points at rather than painting a resolved value.
`/styles` reflects this: an editable **ref · palette** section, and a read-only
**sys · roles** section showing what each role resolves to. `/api/style-token` accepts
only `ref` names and rejects everything else.

`tokens/design-tokens.json` is stored pre-normalised to `JSON.stringify(json, null, 2)`
— the exact shape the editor writes — so a one-colour edit stays a small diff instead
of reformatting the full file. **Don't reformat it.**

---

## Current state

Light holds the current working system; Dark is intentionally empty as described in
*Page architecture*. The live high-level inventory includes **34 icons**, **19 type
particles**, the full 25-variant Button set, Field and Checkbox families, ten
`Dev Panel Title` variants, ten `DevPanel Content` variants, and ten assembled panel
specimens.

The reusable-style layer currently consists of **20 Hanken Grotesk text styles** and
no paint, effect or grid styles. All text styles are consumed. Elevation remains
duplicated as inline shadow/blur effects rather than represented by effect styles.
The canvas token specimens also lag the live collections: the `sys` specimen shows
40 roles against 42 variables, and the `comp` specimen shows 21 against 49.

The assembled panels are **Edit image**, **Edit grid**, **Edit carousel**, **Caption**,
**Project settings**, **Outline marker**, **Log new issue**, **Edit colour token**,
**Gallery Manager**, and **Asset Manager**. The first eight use the portrait layout;
Gallery Manager and Asset Manager use landscape. Each is an instance of `DevPanel
Layout`, so title, body and layout are exercised through the same composition a real
consumer uses. The title variant currently spells `Edit color token` while the body
variant spells `Edit colour token`; keep the two matched by meaning until the names
are normalised.

The panels deliberately use **labels only**: no explanatory sub-titles, hint
paragraphs or status prose. Board labels such as `Visible` and `Parking lot` stay
because they name a thing rather than explain a control. If a control needs a
sentence, fix its label, grouping or interaction.

Footer follows the component ladder:
[`Footer text`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=778-4307)
particle → [`Footer Base`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=926-4038)
atom → [`Footer`](https://www.figma.com/design/$FIGMA_FILE_KEY?node-id=722-4165)
set in Atom Variants (`State=Rest/Hover`). The variants use `comp/footer/rest` and
`comp/footer/hover` respectively.

**Key panel building blocks** (all in LGTM and token-bound):

| Component | Tier | Notes |
| --- | --- | --- |
| `Grid Thumb` | Atom Variants | `State=Rest/No remove/Hover/Selected` on `Grid Thumb Base`; Hover turns the Remove label `sys.color.error`. |
| `Slider Row` | Elements | Label, track with fill + knob, value readout. Edit image zoom. |
| `Crop Toolbar` | Elements | Centre-X, centre-Y, crop lock. Uses `Icon/AlignCenterX/Y` + `Icon/Lock`. |
| `Crop Stage` | Elements | Crop frame, eight resize handles, centre reposition handle. |
| `Thumb Board` | Elements | Label + tray of `Grid Thumb`. One per breakpoint board. |
| `Viewport Selector` | Dev Panel Components | Desktop/Tablet/Mobile through `Segmented Control`. |
| `Theme Selector` | Dev Panel Components | System/Light/Dark, icon-only. Mirrors `DevThemeToggle.astro`. |

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
- **Component descriptions are the intended component-level documentation.** They
  travel with the component and surface in `get_design_context`, but current coverage
  is incomplete and some descriptions lag their live sets. Verify the canvas, then
  update the description whenever you touch a master. Put the *why* there; keep this
  handbook for system-level architecture and traps.
- **Batched API writes can leave the canvas stale.** Elements sometimes render out of
  place until a real interaction forces relayout; a 1px nudge fixes it. There is no
  API to force a relayout pass. Don't chase it as a config bug — but do check
  properties first to rule out a real one.
