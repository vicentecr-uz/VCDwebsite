# 0013. Motion

Status: Accepted (2026-11-22, recorded from code comments)

Tuned values live in code and config; this records what was chosen over what.

## Decision

**Segmented-control pill.** Each edge of the pill rides its own spring, after Motion's time-defined springs: stiffness `(2π / (visualDuration × 1.2))²`, damping ratio `1 − bounce`, unit mass, starting at rest. The leading edge is quicker and lands without overshoot; the trailing edge follows, so the pill stretches toward the target and catches up. It runs until both edges rest, never for a fixed time. The rest threshold is 0.1 px because Motion's default 0.5 px left a visible last-frame jump. Edges move by transforms only (a clip for the right edge, a same-size fill for the left), so corners never scale and the slide stays smooth during a viewport morph. Boxes are measured fractionally from computed size and rect centre, divided by the group's drawn scale, so the pill neither snaps on landing nor shrinks for a pressed button.

**Header menu demo.** Chosen from the spotlight prototype: proportional eased feather, opacity exit and asymmetric cursor travel. A fixed feather, an expanding exit and timed glyphs were rejected; approved values live in `headerMenuDemoConfig.json`. Every dismissal freezes the scene and fades it, so all exits look the same.

**Image lens release.** Chosen from `/proto/lens-momentum`: a cubic ease-out coast and a bumper wall (spring foam plus a slap at the stops), friction 10/s, threshold 150 px/s, stiffness 240, restitution 0.4. Rejected: exponential cutoff (kinked at 0), linear slide, clamp wall (dumped leftover speed), spring-only (no slap).

**Carousel drag overscroll** gives at most 2.5 px; `tension` controls the diminishing give.

**Home reveal.** Reduced motion keeps the spatial opacity wave and drops only movement and blur. Clones stay visible so WAAPI can reveal them while the semantic source stays hidden until cleanup.

**Panel collapse** animates only the bounded panel's box, so text and controls never scale, and holds the final geometry while the body fades.

**Sabi demo fade** replays the old 150 ms transition as a rate limit: each edge moves toward its target at no more than one full fade per 150 ms, so a jump exposes text while it catches up and a stream of scroll events cannot hold it in place.

## Where

`src/lib/segmentedSlide.ts`; `src/lib/headerMenuDemo.ts`; `src/lib/imageLensInertia.ts`; `src/lib/carouselDragTuning.ts`; `src/lib/homeReveal.ts`; `src/lib/devPanelCollapse.ts`; `src/lib/sabi/demo.ts`
