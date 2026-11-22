# 0010. Interface ownership

Status: Accepted (2026-11-22, recorded from code comments)

Details live in `docs/interface/`; this records the decisions the guard tests enforce.

## Decision

**Components own their spacing.** Components in `src/components/ui/` own their padding, gap and radius, as Menu does; a call site composes them and never re-sets those values or re-points their spacing tokens. Change the component so every instance moves together. Overrides that predate the rule sit in the test's `BASELINE`, which may only shrink.

**A panel owns its inset.** A DevOverlay panel applies `--dev-panel-pad` on all four sides; content it wraps must not add its own padding or margin, or the bottom inset drifts from the sides. Room an animation needs belongs inside the animated element or the panel component.

**Floating layers use the top layer.** Every `.project-block` is a stacking context (`isolation: isolate`) and the containing block for `position: fixed` (`container-type: inline-size`), so a menu, listbox or tooltip inside one paints under the next block whatever its z-index. Floating layers open as native popovers. Menus and listboxes are built from the Menu component, which owns their padding, gap, radius and separators.

**Touch.** Inputs are at least 16 px so iOS Safari does not zoom the page on focus.

**Block reordering.** Renumbering after a drop reads the full item list: `getItems()` excludes the drag item, which is still set while the drop resolves, and numbering from it skipped the dropped card. Edge-scroll speed eases cubically so target speed is G²-continuous at the dead-zone edge.

**Tuning pages share module state.** `/dev/home-reveal` imports the same `headerMenuDemoConfig.json` instance as `headerMenuDemo.ts`, so edits apply on the next replay.

**Video application page.** Only the video is centred; the Home row hangs above the column without taking part in its height, and the column is as wide as the 9:16 frame that fits with that row's height kept clear above and below.

## Where

`scripts/test/dev-chrome-ownership.test.ts`; `scripts/test/top-layer-floating.test.ts`; `src/lib/floatingLayer.ts`; `src/pages/flat-iron-ranker.astro` → `syncOrderFromDom`; `src/pages/dev/scroll-hold.astro`; `src/pages/dev/home-reveal.astro`; `src/pages/the-bridge-1min-video-nov2026-application.astro`
