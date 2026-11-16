# Demo frames

Read when building or changing an embedded demo, its frame, or Stageshow choreography.

The outer demo frame sits directly on the page with shallow, raised edges. Use [`ProjectInteractiveDemo`](../../src/components/project/ProjectInteractiveDemo.astro) through an `interactiveDemo` content block. Register the demo in [`craftDemos.ts`](../../src/lib/craftDemos.ts); the shared component supplies the frame automatically. Do not recreate its frame in a demo component or add `dev-surface`, a stronger elevation shadow, or a second background plate.

The shared frame ([`demoFrame.css`](../../src/styles/demoFrame.css)) owns `--comp-demo-frame-container` (aliased to the page surface, `--sys-color-srf`), the save bar’s shared `--surface-stroke-shadow` (a light inner ring and dark outer ring, both zero-blur) drawn above demo content, a tighter soft drop shadow, corner radius, and mobile full bleed. Full bleed applies to any `.project-block.demo-frame`, so every demo in the page flow gets it without component CSS; nested frames stay inset. Pad demo content with `--demo-frame-inset` (`2u`, then `--page-gutter` once the frame bleeds) so it lines up with the page column at every width. Depth comes from these edges rather than a contrasting fill or a broad floating-card shadow. At widths below `40em`, it must reach both page edges without horizontal overflow. Controls or product panels **inside** the demo may use the editor's surfaces; that does not change the outer frame.

Only use another frame treatment when Anto explicitly requests it. Record a frameless exception as `frame: 'none'` in the registry, as the image-framing demo does. Keep exceptions out of page-specific CSS so the default remains shared and reviewable.

The shared frame shows the existing `LoadingSpinner` while an iframe loads and any Astro islands finish hydrating. Keep this loading state in `ProjectInteractiveDemo`, not in individual scenes.

Iframe demos use [`DemoLayout`](../../src/layouts/DemoLayout.astro). A small control demo must fit its frame without vertical scrolling; opt into `scrolling` only when scrolling is part of the demonstrated interaction. Size the scene and layout together rather than merely hiding an overflowing control. Stageshow supplies the scene and choreography inside this frame, not a replacement outer surface.

Demo cursors keep their native proportions relative to the featured control. Share the control’s enlargement factor with every cursor kind, including the I-beam: a control enlarged by 47% needs a cursor at 1.47×. Use one scale setting for the control and cursor, then let stage fitting scale both together. Do not choose an independent large-cursor preset. Sabi uses `--sabi-demo-scale` for its field height and Stageshow’s `--ss-cursor-size`.

Cursors, pointing/grabbing hands, finger circles and click ripples represent the demonstrator using the reader’s screen. By default they belong above the page, outside the demo frame’s clipping and iframe viewport. Use `createDemoIndicatorLayer` (`src/lib/demoIndicatorLayer.ts`) for DOM guides; Stageshow projects its cursor and ripples through this layer automatically. Keep the scene and keypress visualizer inside the frame. The layer preserves coordinate scale, follows scroll/resize, ignores pointer events, and is removed with the guide. Only constrain indicators to a frame when explicitly requested.

Use `demoCursorGlyphs.ts` for the shared artwork, dimensions and hotspots, and `demoIndicators.css` for cursor shadows and finger-circle surfaces. The home intro guide, DOM demos and Stageshow must use the same set. Keep control-relative scaling on top of these shared base dimensions; do not redraw a separate pointer or finger style for a new demo.

At mobile widths below `40em`, omit the frame’s outer drop shadow while retaining its edge strokes and full bleed.

Run `bun scripts/test/craft-demo-build.test.mjs` after a build. It checks that embedded demos use the shared frame and that exceptions are explicit. Review the save-bar rings above the content, subtle outer shadow, full bleed, and absence of accidental scrolling at desktop and phone widths.

