# Motion

Read when adding or changing any animation or transition.

Dev chrome should not pop into existence. Standalone panels such as `DevOverlay` fade with a slight rise and mirror it on exit. Veils covering an existing surface fade only. Menus are the exception: they open and close instantly (see [menus](menus.md)).

`prefers-reduced-motion` suppresses **movement**, not fades. Opacity keeps its transition and easing. A translate/rise keeps its duration but uses zero offset; scale, width/height, and layout motion are suppressed or crossfaded. Never use `transition: none` for a fade or zero a shared duration that opacity also reads.

This rule includes JavaScript timing. Do not turn an enter/exit duration into zero, skip its class lifecycle, or call the finish path in the same frame merely because reduced motion is enabled; those make a CSS fade snap. Existing genuine-movement overrides include the section-lift `scale(1.02)`, drop-indicator height, and crop-stage transforms. The one movement kept under reduced motion is the press scale on small pressable controls (`motion/press-scale` in `global.css`); do not extend it to cards or panels.

Broader reduced-motion parity is deprioritized until v1 **actually ships**. The former target date, 2026-08-31, is not evidence that v1 shipped. Do not proactively extend or audit reduced-motion coverage before then, but do not regress behavior already implemented. Revisit after the real v1 release or if the site-builder work begins serving other people.

Room an animation needs (a rise, an overshoot, a shadow) lives inside the animated element or its component, never as extra padding on the container around it; see [panels](panels.md).

## Page transitions

Page navigation starts with `#transition-overlay` opaque. On initial load, a small inline controller fades it out over `0.25s` after fonts and viewport-visible LQIP/thumb images are ready and one painted frame has elapsed, with a four-second fallback; the deferred transition module adopts that state without re-covering the page. Preview upgrades begin as the fade starts. There is no minimum hold. Outgoing navigation fades in over `0.25s`, and the CSS five-second safety reveal remains if JavaScript fails. In dev, `?dev-transition=visible` keeps the page visible while preserving the readiness boundary; the fixed `Fade would start` status marker appears exactly when the normal fade and preview upgrade would begin, and remains visible for diagnosis. Internal links carry the query forward. A production build honors the no-veil query only on loopback hosts for local performance capture; deployed hosts ignore it. Passive `vcd:` User Timing marks align readiness and fade events with browser Performance traces.
