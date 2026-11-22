# 0007. Viewport canvas and page boot

Status: Accepted (2026-11-22, recorded from code comments)

See `docs/dev-canvas.md` for what the canvas is and when it is on. This records why it behaves as it does.

## Decision

**Hold the reader's place while the page morphs.** The shell anchors whatever sits under the middle of the viewport (the image or text there, and the same point within it) and corrects scroll as the page reflows.

- Anchor what is actually shown: a cropped or sliding image is larger than its box, and content inside a scroller moves on its own, so the visible box stands in for both.
- Prefer the finest piece of content (`img`, `video`, `p`, headings, captions, list items) over `.project-block`, which can be several screens tall; among pieces spanning the middle take the one centred nearest it. A piece one viewport hides has no box, so its nearest rendered ancestor stands in.
- The browser's own scroll anchoring stands down while the shell holds the anchor; both correcting the same shift makes the page jump (seen in Firefox).
- The page resizes blocks from its own frame callbacks and observers, which run after the shell's tick, so the shell corrects again once layout settles, before paint, and keeps holding until the page has been still for a while or the reader acts (wheel, touch, pointer, key).

**Resize delivery.** In the canvas, `Layout.astro` registers a resize listener before any page script (so it also precedes capture-phase listeners) and holds back page resize listeners during a morph, about 120 ms of editor work per step, delivering one resize at the end. ResizeObservers still run, so script-sized content keeps up. Layout that cannot wait, the fixed header, listens for `vcd:viewport-flux-frame`, which the shell dispatches in the same frame as each width change because the page's own resize event arrives a frame late.

**Timing.** The morph uses the page's clock, so an inspector that slows time in the page (Lapse) slows the morph too. A dragged width is laid out at most once a frame, and a slow page reflows only every second to fourth frame, so the slider keeps frames of its own in between.

**Page boot.** Layout readiness stays independent of the heavier transition and editor graph. Dev styles arrive as module scripts while production links are render-blocking, so readiness waits on both forms. An inline white background covers the first paint because bundled CSS can arrive after the page is visible. On the transition overlay, setting `startTime` cancels pending playback, so it resets only after the renderer is ready.

## Where

`src/pages/dev/canvas-shell.astro` → `anchor`, `settleAnchor`, `customGeometry`, `clock`; `src/layouts/Layout.astro` → `data-canvas-resize-observer` script, layout readiness script, `revealPage`
