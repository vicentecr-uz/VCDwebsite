# 0012. Image carousel

Status: Accepted (2026-11-22, recorded from code comments)

## Decision

**Scrolling is native.** The track uses `overflow` and `scroll-snap`, so a trackpad swipe moves the carousel only while the pointer is over it and the page keeps its own scroll on the cross axis. Mouse users get click-drag; touch and trackpad need nothing extra. If native snap leaves the track in the gap between slides, a last-resort correction jumps instantly: a second smooth `scrollTo` felt like slow-then-speed-up. A short CSS catch-up bridges native whole-pixel release offsets.

**Everything follows fractional progress.** Dots, caption opacity, caption width and slot height all read the same continuous scroll position, so they slide with the images instead of jumping on snap.

- The dot window has at most five slots: three full dots centred on the active one, and a shrunken preview dot at each end while there are more images that way. SSR uses the same geometry so the first paint matches.
- Below-image captions fade out by `fadeEnd` of the way to the neighbour, leaving a gap mid-swipe where neither shows (dots crossfade instead). Each caption keeps its own image's width so fading text does not reflow.
- While editing leaves `data-caption-editing` on after Save, the caption is pinned only while its slide is nearest, or a staged caption stays opaque and stacks on its neighbour.

**Height.** In dynamic height mode the visible clip (`[data-carousel-clip]`) lerps while the scrollport stays at the tallest slide, so mandatory snap can finish without a script re-scroll. The clip must wrap only the track: putting the height on the element that also holds the dots flex-shrank the track and broke iOS snap. Cap metrics change once webfonts load, so trim and slot height are measured again then.

## Where

`src/lib/projectImageCarousel.ts` → `carouselDotGeometry`, `carouselCaptionOpacity`, `syncCaptions`, `applyHeight`, `bindDrag`, `bindTouchSnap`; `src/components/project/ProjectImageCarousel.astro`
