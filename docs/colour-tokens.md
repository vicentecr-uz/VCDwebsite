# Colour tokens — ref / sys / comp

How the colour system is shaped, why it is shaped that way, and what was dropped
getting here. Companion to [`figma-design-system.md`](figma-design-system.md),
which covers the Figma file as a whole.

> This started as a summary frame in Figma. It lives here instead so it can be
> versioned alongside the code it describes.

---

## Why the old system was replaced

The old `color/*` family was a **transcription of `global.css`, not a designed
system** — all 15 `--color-*` custom properties appeared in Figma 1:1, plus five
added later. Three unrelated things shared one prefix: the site stylesheet, two
semantic accents (`danger`, `danger-text`), and one component's hardcoded macOS
hues (`traffic-lights-*`).

A tell that it was transcription rather than design: `color/border`'s **Dark**
value was the literal `#e0ddd8` — the *light* value from the CSS, pasted into the
dark slot. It had been "light in both modes" ever since.

Because there was no semantic tier, `button/*` absorbed its job. `emphasis/ink`
— used by **all** content, not just buttons — routed through `button/ink`, so a
paragraph inherited "button ink". Splitting the tiers fixes that, and makes dark
mode a single decision instead of the ~20 repeated ones it had become.

## The three tiers

| Tier | Question it answers | Modes |
| --- | --- | --- |
| `ref` | "What colours exist?" | one |
| `sys` | "What is this *for* on a page?" | **Light / Dark** |
| `comp` | "How does *this component* use those roles?" | **one** |

`comp` having **one mode is load-bearing.** There is no dark slot to hardcode, so
every `comp` token must alias a `sys` role — which means dark is inherited, never
re-decided per component.

Surface and ink are defined as **pairs** (`srf` / `on-srf`), so legibility is
structural rather than something you check by eye.

## Naming is a mechanical transform

```
CSS name = "--" + collection + "-" + variable path with "/" → "-"

sys  · color/on-srf           →  --sys-color-on-srf
comp · button/filled/label    →  --comp-button-filled-label
ref  · palette/grey/100       →  --ref-palette-grey-100
```

No lookup table exists or is needed — an agent derives the name in either
direction, including for tokens that don't exist yet.

`surface` is abbreviated **`srf`** throughout.

## The palette

`ref` holds the **whole Tailwind v4 palette**: 17 chromatic hues × 11 steps, plus
a 13-step custom `grey`, `warm/800`, and `brand/*`. 203 tokens, all present up
front so none has to be invented mid-task.

**Every ramp runs dark → light** (Material 3 tone direction). The rule is
`ours = 1000 − Tailwind step`. It mirrors around 500, so every mapped step lands
on a real Tailwind step (50↔950, 200↔800, 500↔500) and `grey/N`, `red/N`,
`blue/N` all mean the same lightness.

**Watch out:** the number matches Tailwind's but the *meaning* is inverted — our
`red/50` is Tailwind's `red-950`.

Values are Tailwind **v4**, read from `node_modules/tailwindcss/theme.css` and
converted oklch→hex. The original red ramp was v3, so danger colours shifted
slightly when the palette landed.

## What was dropped, and why

**Genuinely dead** — zero uses in source, zero in Figma:

| Token | Why |
| --- | --- |
| `color/link-strong-hover` | never referenced |
| `color/surface-control-strong` | never referenced; identical hex to `surface-control` |

**Merged** — duplicates that were never distinct:

| Old | Now | Why |
| --- | --- | --- |
| `color/surface-chip` | `sys.color.srf-container` | same role, near-identical value |
| `color/surface-control` | `sys.color.srf-container` | same role, near-identical value |
| `color/surface-press` | `sys.color.srf-container-high` | identical value to `surface-strong` |
| `ink/default` | `sys.color.on-srf` | duplicated `color/text` |
| `text/ink` | `sys.color.on-srf` | duplicated `color/text` |
| `button/fill-ghost` ×4 | `comp.button.ghost.container` | all four states held the **same** value |
| `button/fill-soft-selected` | `comp.button.soft.container-hover` | identical value |
| `button/fill-page-selected` | `comp.button.page.container` | identical value |
| `button/danger-soft-selected` | `comp.button.danger.container` | identical value |

**Retired in the M3 alignment pass:**

| Old | Now | Why |
| --- | --- | --- |
| `on-srf-muted` | merged into `on-srf-variant` | M3 carries two ink weights, not three. 72 call sites went `#888888` → `#5a5a5a`. |
| `srf-variant` | replaced by `srf-container-low` | M3 has effectively retired `surface-variant`; only the `on-surface-variant` pairing survives. |

**Moved tier** — these were in the wrong layer:

- `color/traffic-lights-*` were semantic-tier tokens holding **one component's**
  fixed macOS hues → now `comp.traffic-light.*`, with the raw hues in
  `ref.palette.brand`.
- `button/ink` was a component token doing a page-wide job → the role is now
  `sys.color.on-srf`, and `comp.button.label` aliases it.

## `on-surface-variant` is not paired with `surface-variant`

Worth stating because it looks like an inconsistency and isn't. When
`surface-variant` was retired, `on-surface-variant` **kept its name** — in M3 it
does not mean "ink for `surface-variant`", it means *the variant (secondary) ink
for surfaces generally*.

M3 has no `on-` role per container step. All the surface container steps share
`on-surface` and `on-surface-variant`; that is the point of a tonal ladder — the
steps stay close enough in tone that two ink roles cover all of them. So there is
deliberately no `on-srf-container-low`.

## Still unfilled

`primary` / `secondary` / `tertiary` and their `on-` and `-container` pairs are
**hot pink (`#ff00ff`)** — the marker for "the design system has not decided this
yet", as distinct from "broken". Same for `srf-dim`, `srf-bright`, the outer
container steps, `inverse-primary`, `scrim` and `shadow`.

They stay pink in `tokens/design-tokens.json`; generated production CSS omits
`#ff00ff`, and local DEV loads `src/styles/dev-token-alarms.css`. Production
also omits the `prefers-color-scheme: dark` media query (dark is opt-in via
`data-theme="dark"` / the DEV toggle) so OS-dark visitors stay on the light
sheet until #256. Note that `inverse-srf` already gives "black on light, white
on dark" for free, because opposing the page is what it *means* — a black
`primary` would need its dark value set by hand, since `primary` does not flip.

## Guard rails

- `bun run tokens:build` — regenerates the block in `global.css` and `dev-token-alarms.css`. Idempotent.
- `bun run tokens:check` — fails on an undefined token, a leftover `--color-*`,
  stale generated CSS, **or** drift against `tokens/figma-tokens.json`.

`tokens/figma-tokens.json` is a **manual snapshot** of the Figma names. Nothing
refreshes it automatically — re-export after adding or renaming a Figma variable,
or the check will fail (which is the point).
