# DialKit gap analysis

Compares DialKit 2.2.1 (npm `dialkit`, MIT) with the site editor's design system: `src/components/ui/*`, `src/styles/dev-chrome.css`, and the `/styles` component catalogue (`src/lib/stylesCatalog.ts`). It answers two questions: which DialKit controls the editor lacks, and how to use DialKit's logic behind the editor's own panel.

The spike is at `/dev/dialkit` (`src/pages/dev/dialkit.astro`, dev-only).

## How DialKit separates state from rendering

DialKit ships four layers:

| Layer | Entry | Depends on | What it does |
| --- | --- | --- | --- |
| Store | `dialkit/store` | Nothing (no imports, ~44 KB unminified ESM) | `DialStore` singleton: parses a config into `ControlMeta`, holds values, reset, actions, versions (presets), persistence with cross-tab sync, shortcut target resolution. Also exports `resolveDialValues`, `formatLabel`, `inferStep`, `isHexColor`, `transitionModeOf`. |
| Hooks | `dialkit` (`useDialKit`, `useDialKitController`) | React | Register a panel in the store on mount, subscribe, and return resolved values. A thin wrapper over the store. |
| Controls | `dialkit` (`Slider`, `Toggle`, `SelectControl`, `ColorControl`, `TransitionControl`, `Folder`, `DialPad`, `ImageControl`, `PresetManager`, `ControlRenderer`, …) | React, Motion | Render DialKit's own DOM with `dialkit-*` classes. |
| Root | `DialRoot` | React, Motion | Floating or inline panel, drag, collapse-to-icon, version gallery, Copy, shortcut listener. |

The store is a true singleton: it is kept on `globalThis` under `Symbol.for('dialkit.v2.…')`, so the React adapter and a direct `dialkit/store` import share one instance.

### Can the panel be rendered headlessly or with replaced components?

- **Replaced components: no.** `DialRoot`, `ControlRenderer` and every exported control render fixed markup. There are no slots, render props or component overrides. Leaving out `dialkit/styles.css` gives unstyled DialKit DOM, not our components. Restyling would mean writing a second stylesheet against 100+ `dialkit-*` class names that change between versions.
- **Headless: yes, through `dialkit/store`.** It needs no React or Motion and is documented under "Custom layouts". Our panel can register a config, render from the `ControlMeta` tree, write with `updateValue`, and redraw on `subscribe`.
- **Not reusable from DialKit:** the spring and easing maths, the Bézier geometry, the version thumbnails and the shortcut listener all live in the UI layer and are not exported.

## Control-by-control gap table

Status: **exists** means an existing component covers it, **partial** means one covers part of it, and **missing** means nothing in `ui/` fits.

| DialKit control | Definition | Site equivalent | Status | What closing the gap needs |
| --- | --- | --- | --- | --- |
| Slider | `[default, min, max, step?]`, bare number | `RangeField` | partial | Typed number entry (Enter or click on the value opens an inline number input; Enter commits, Escape cancels). Land the compact variant (label inside the track, value right-aligned) from PR 254. Optional fine and coarse steps with Shift. Not catalogued on `/styles`. |
| Toggle | `visible: true` | `ToggleRow` | exists | DialKit draws an Off/On segmented control. `ToggleRow` is a checkbox row, and `SegmentedControl` can draw On/Off if wanted. No new component. |
| Select | `{ type: 'select', options }` | `EditorSelectField` (Base UI island) | exists | Same `{ value, label }` shape. Ours also has groups and icons. |
| Segmented (internal) | Used by Toggle and the transition editor | `SegmentedControl` (+ `ViewportSelector`) | exists | Ours has a sliding spring pill. |
| Text | `'Hello'` or `{ type: 'text', placeholder }` | `TextField`, `TextArea` | partial | DialKit's text grows up to five lines, then scrolls. `TextArea` has fixed rows. Add an auto-grow option (`field-sizing: content` with a `max-block-size`). |
| Colour | `'#a78bfa'`, `oklch(…)`, `{ type: 'color' }` | None as a field. `StyleColorTokenEditor` uses `color-dialog-box` plus a hex `TextField`, but only for `/styles` tokens. | missing | A `ColorField`: a swatch trigger plus a CSS-colour text input in one `Field`. The swatch opens `color-dialog-box` (already a dependency) in a popover. It accepts hex, rgb, hsl, oklch and `color(display-p3 …)`, and has an opacity channel. Extract it from `StyleColorTokenEditor` so the token editor uses it too. The spike uses a hex-only `TextField`. |
| Image | `{ type: 'image', options }` | None. `DevImageDrop` and `DevAssetManager` are tied to content and media. | missing | An `ImageField`: a thumbnail trigger, a popover grid of options, and a local upload read as a data URL. |
| XY pad | `{ type: 'pad', x, y, labels }` | None | missing | A `PadField`: a square well with a grid, a draggable puck, arrow keys plus Shift ×10, Home to reset, Escape to cancel a drag, Shift-drag to lock an axis, and snapping to grid intersections. |
| Spring / easing | `{ type: 'spring', visualDuration, bounce }`, `{ type: 'spring', stiffness, damping, mass }`, `{ type: 'easing', duration, ease }` | None as a control. The maths exists twice: the time-defined spring inside `SegmentedControl.astro`, and the physics spring plus cubic presets producing `linear()` in `src/lib/easingDevPresets.ts` (used by `/dev/home-reveal` through a native `<select>`). | missing | A `TransitionField`: a `SegmentedControl` for Easing, Time and Physics; `RangeField`s for each mode's parameters; an SVG curve preview; draggable Bézier handles with keyboard nudging; and a preset menu. Move both spring implementations into one shared module first. The spike shows Physics mode as three plain sliders. |
| Action | `{ type: 'action', label }` | `Button` | exists | None. |
| Folder | Nested object, `_collapsed: true` | None. `DevOverlayFrame` minimises a whole panel, not a group. | missing | A `FieldGroup`: a collapsible section from native `<details>`/`<summary>`, with a `Hairline` and dev-chrome label styling. It must nest, and open-height animation can use `::details-content` with `interpolate-size`. The spike draws folders as a `Hairline` and a label. |
| Panel root | `DialRoot` (popover or inline, position, theme, drag, collapse-to-icon, several panels as sections) | `DevPanel` (`draggable`), `DevOverlayFrame` (drag, resize, minimise, hide, persisted position) | exists | No collapse-to-icon. A generic panel that lists every registered config needs a client-side render path (see below). |
| Versions / presets | Save version (page thumbnail), switch, rename, delete, gallery. `versions: 'menu'` gives a plain menu. | `Menu` + `Button` + `PanelActions` | missing | A `VersionMenu` on the store's preset API (`saveNewPreset`, `loadPreset`, `renamePreset`, `deletePreset`, `getPresets`, `hasEdits`). The menu form is enough, and the thumbnail gallery is out of scope. |
| Copy | Copies values and an instruction for applying them | `Button` + clipboard, `ToastStack` for confirmation | exists | Composition only. The spike's Copy writes the resolved values as JSON. |
| Reset | `resetValues()` | `Button` | exists | Composition only. The spike's Reset proves the store-to-panel sync. |
| Shortcuts | Hold a key and scroll, drag or move; a key flips a toggle; a badge shows the key | `Keycap` for the badge | missing | A shortcut listener (keydown/up, wheel, pointermove) calling `DialStore.resolveShortcutTarget` and writing values, plus a `Keycap` in the field's `labelAccessory` slot. `Keycap` is not catalogued on `/styles`. |
| Keyboard map | Arrows, Shift ×10, Home/End, Enter to edit | Native `<input type=range>` gives arrows, Page Up/Down and Home/End | partial | Covered by typed number entry in the Slider row above. |
| Persistence | `persist: true` (localStorage, cross-tab) | Store option | exists | Pass `persist` to `registerPanel`. |
| Timeline dock | `dialkit/timeline` | None | out of scope | A separate product surface, not a panel control. |

## Integration route

**Recommendation: use `dialkit/store` as the logic layer, behind a site-owned binder and our own components.** Do not use `useDialKit` with `DialRoot`, and do not write our own store yet.

Reasons:

1. **It is the only seam DialKit offers.** Its React controls can't be reskinned into our components. Its store has no dependencies, is documented, and is exported for custom layouts.
2. **Our components are Astro, not React.** `useDialKit` returns values to React, and the panel would still need every control rebuilt in React. That would be a parallel component library that `dev-chrome.css` would have to track. With the store, the Astro components we already have render the panel.
3. **The store already does the fiddly work:** tuple and inferred ranges, labels from keys, nested paths, reconciling values when the config changes under HMR, version semantics (edits stay with the selected version until you leave it), persistence with cross-tab sync and migration, and shortcut resolution. A small hook of our own would match the first two in about 150 lines and drift on the rest.
4. **Production cost is nil.** `dialkit` is a devDependency. The spike imports it at render time on a dev-only route and in the browser behind `import.meta.env.DEV`, so a production build drops it. React and Motion are not needed.
5. **Coupling is limited and replaceable.** The binder touches seven store calls: `registerPanel`, `getPanel`, `getValue(s)`, `updateValue`, `subscribe`, `subscribeActions` and `resetValues`. If the store's API changes, a store of our own with the same surface replaces it without touching the components. Pin the exact version.

What the spike shows:

- DialKit's parser runs at render time (`registerPanel` → `getPanel().controls` → `unregisterPanel`), and the page maps each `ControlMeta` to `RangeField`, `ToggleRow`, `EditorSelectField`, `TextField` or `Button`. No markup is duplicated.
- In the browser, a script of about 80 lines registers the same config, writes panel input into the store, and on `subscribe` styles the demo and writes store values back into the controls. Reset shows that store-to-panel sync works.
- An action (`replay`) goes through `triggerAction` and `subscribeActions` and plays a spring built from the panel's spring value with the existing `generateSpringEasing`.

Known limit and phase 2: the spike renders from a config the page knows at render time. A generic root, one panel listing every config registered at runtime (DialRoot's job), needs our controls to render in the browser. The cheapest way that keeps one source of markup is to server-render one `<template>` per control type and clone it from `ControlMeta`, not to port the components to React.

## Missing components in priority order

1. **`FieldGroup`**, a collapsible folder. Every panel with more than a handful of controls needs it, and native `<details>` makes it cheap.
2. **`TransitionField`**, the spring and easing editor with a curve preview and Easing/Time/Physics modes. It is the main reason to prototype with DialKit, and the maths is already in the repo in two places to consolidate.
3. **`ColorField`**: swatch, picker popover, and CSS-colour text. The picker dependency is installed, and `StyleColorTokenEditor` would reuse it.
4. **Typed number entry on `RangeField`**, together with landing the compact variant from PR 254.
5. **`VersionMenu`**, presets on the store's API using `Menu` and `Button`.
6. **Auto-growing `TextArea`** (`field-sizing: content`).
7. **`PadField`**, the XY pad.
8. **Shortcut listener** with `Keycap` badges.
9. **`ImageField`**, image options and local upload.

Documentation gaps found along the way: `RangeField` and `Keycap` are used in panels but have no `/styles` catalogue entry.
