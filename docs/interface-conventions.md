# Interface conventions

Read this before changing site or dev-layer UI. Root [`AGENTS.md`](../AGENTS.md) owns the delivery workflow; this file owns the detailed interface rules.

## Foundations

- **Spacing:** Use `var(--space-unit)` consistently for header, grid, footer, and gaps. It is `1rem` at every breakpoint and steps down to `0.75rem` below `40em`. It is defined in `src/styles/global.css`; do not replace it with a literal `1em`. Prefer inline `style=` over framework arbitrary values when guaranteed rendering matters.
- **Mobile breakpoint:** `40em` (640px). This is where `--space-unit` tightens and the header steps down through `--header-wordmark-size`, `--header-menu-link-size`, and `--header-logo-size`.
- **Typography:** Hanken Grotesk, upright weights 400–900 plus 400 italic. Content Heading 2 uses the body size, leading, and tracking with bold weight 700; body emphasis stays at 500. It remains a heading block in the editor and rendered document.
- **Page ground:** Use `--sys-color-srf` for every surface meant to read as the page: page background, `.site-header__bg`, nav panel, and menu backdrop. Never give one of these stacked surfaces a literal white; they must move together when the ground changes.

## Scrollable overflow

Scrollable content needs a clear edge treatment. For grouped controls, cards, and other contained UI, put the existing radius token on the actual overflow viewport and clip its contents to that rounded shape, as with the clipped areas of the Asset manager. For text-like content that continues past its edge, use a gradient alpha mask to fade the text, as with overflowing text fields. Preserve native scrolling and visible keyboard focus in both cases. Reuse the existing dev controls and styling patterns rather than introducing a new overflow abstraction. Hiding scrollbars is a local choice for a specific control; this pattern does not make it a global rule.

## Page width and viewport height

Text and media use separate caps:

- `--page-text-max-width` (`40em`) caps body text and section titles.
- `--page-media-max-width` (`50em`) caps images, grids, carousels, video, press ticker, Reddit board, and project grids.
- `--page-max-width` is derived with `max()` and defines the outer column used by `#site-wrapper`, the header feather, and sidebar navigation.

All three tokens live in the `html` block of `src/styles/global.css`. The sidebar-nav breakpoint is derived from outer column + `28.5em` (currently `78.5em`), but media-query conditions cannot read custom properties. Roughly six literals across `SectionSidebarNav.astro`, `project.css`, `DevTextEditor.astro`, and `DevPageWidthToggle.astro` must be re-derived together. Missing one can leave the nav positioned and hidden in the same band. Read [`page-width.md`](page-width.md) before changing a width; the dev-mode **Page width** panel previews both caps but does not update shipped CSS for you.

Never use raw `svh` or `vh` for a visually important height constraint. Microsoft Edge on iOS can let `svh` follow address-bar movement and push content during scroll. Use `bindSafeVh()` from `src/lib/safeVh.ts`, initialized in `Layout.astro`; it sets `--vh-safe` on load and recomputes only for a genuine width change. Keep `svh` only as the pre-JS/no-JS fallback:

```css
height: calc(var(--vh-safe, 1svh) * 100);
```

Do not reimplement safe viewport height per component.

## Ground, ink, and edit affordances

Light/dark variants are named for the **ground**, not the ink. `on-dark` is the white-icon set because it sits on a dark ground. Listing `dark` and `hoverDark` flags likewise describe the cover. Project-grid chip palettes are `--chip-{ink,fill,ring,press}-on-{light,dark}`; the ring is always one step darker than its fill on both grounds.

Gallery title/meta ink flips from one shared threshold: `HOVER_LUMA_THRESHOLD` in `src/scripts/coverLuminance.ts`, used by `adaptiveMediaInk` and `bindGalleryMediaInk`. Higher keeps dark ink over more mid-tones; lower switches to light ink sooner. Do not tune this in CSS or `ProjectGrid.astro`.

A dashed hairline means **editable**, and nothing else in dev chrome may use one.

- Text fields show it while `contenteditable`.
- Media frames show it during image drag, inset and rounded so it reads as the receiving slot rather than the frame border.
- Solid rules and fills communicate state: selected, lifted, span frame, or dropping.
- Use `--dev-edit-dash` and `--dev-edit-dash-color` from `global.css`. When touching a legacy hand-rolled `color-mix`, converge that instance; do not sweep unrelated code.

## Labels and accessibility

Site and dev-layer chrome ships with **labels only**. A control names itself and stops; if it needs an explanatory sentence, improve its label, grouping, or interaction.

Do not volunteer subtitles that repeat headings, helper prose below fields or toggles, panel introductions, parenthetical hints, or explanatory tooltips. These are still valid:

- the control label;
- an inline unit such as `px` or `%`;
- actionable error text;
- editorial site content such as About or a case study;
- invisible accessible names such as `aria-label` and `title` on icon-only controls.

Never strip an accessible name to satisfy the labels-only rule. If Anto explicitly asks for tooltips or onboarding, build that requested help layer properly rather than reducing it to a bare label.

## Motion

Dev chrome should not pop into existence. Standalone panels such as `DevOverlay` fade with a slight rise and mirror it on exit. Veils covering an existing surface fade only.

`prefers-reduced-motion` suppresses **movement**, not fades. Opacity keeps its transition and easing. A translate/rise keeps its duration but uses zero offset; scale, width/height, and layout motion are suppressed or crossfaded. Never use `transition: none` for a fade or zero a shared duration that opacity also reads.

This rule includes JavaScript timing. Do not turn an enter/exit duration into zero, skip its class lifecycle, or call the finish path in the same frame merely because reduced motion is enabled; those make a CSS fade snap. Existing genuine-movement overrides include the section-lift `scale(1.02)`, drop-indicator height, and crop-stage transforms.

Broader reduced-motion parity is deprioritized until v1 **actually ships**. The former target date, 2026-08-31, is not evidence that v1 shipped. Do not proactively extend or audit reduced-motion coverage before then, but do not regress behavior already implemented. Revisit after the real v1 release or if the site-builder work begins serving other people.

Page navigation starts with `#transition-overlay` opaque. On initial load, a small inline controller fades it out over `0.25s` after fonts and viewport-visible LQIP/thumb images are ready and one painted frame has elapsed, with a four-second fallback; the deferred transition module adopts that state without re-covering the page. Preview upgrades begin as the fade starts. There is no minimum hold. Outgoing navigation fades in over `0.25s`, and the CSS five-second safety reveal remains if JavaScript fails. In dev, `?dev-transition=visible` keeps the page visible while preserving the readiness boundary; the fixed `Fade would start` status marker appears exactly when the normal fade and preview upgrade would begin, and remains visible for diagnosis. Internal links carry the query forward. A production build honors the no-veil query only on loopback hosts for local performance capture; deployed hosts ignore it. Passive `vcd:` User Timing marks align readiness and fade events with browser Performance traces.

## Approved components

Use only components and patterns listed on `/styles`. Ask Anto before introducing something outside that library. Do not copy legacy case-study markup from `src/components/project/legacy/`.

When creating a page, compose its headings, text, and media from the existing content-backed page blocks wherever they fit, so Anto can edit them through in-page Edit. Use the disk-backed page loader and verify Save survives a reload; styled hardcoded text is not equivalent to an editable block.

Treat difficulty expressing a page through blocks as evidence of an editor capability gap. Identify the missing capability and address it within the agreed task scope, or explicitly report the remaining gap. Do not silently bypass the editor with page-specific markup. Functional controls may still need engine code; keep that boundary explicit.

Signed-off Tapico/future case-study primitives:

- `ProjectLayout`
- `ProjectImage`
- `ProjectImageGrid`
- `ProjectBodyText`
- `ProjectSectionTitle`
- `ProjectPressQuoteTicker`
- `ProjectRedditCommentCarousel`
- `ProjectInteractiveDemo`

Home, Work, and Play use `ProjectGrid` from `src/components/ProjectGrid.astro`. Its `variant` is `home`, `work`, or `play`; listings come from each project document. `src/components/project/legacy/LegacyProjectGrid` is a case-study media cluster, not the same listing grid.

Any interactive element built from Button Base or its variants needs a hit area extending `space/hit-inset` (8px in Figma Primitives) beyond every visual edge. Figma deliberately does not model this geometry. In code, use an interactive wrapper or a pseudo-element with `inset: -8px`; when the token is exported to CSS, reference it instead of hardcoding the value.

## Demo frames

The outer demo frame sits directly on the page with shallow, raised edges. Use [`ProjectInteractiveDemo`](../src/components/project/ProjectInteractiveDemo.astro) through an `interactiveDemo` content block. Register the demo in [`craftDemos.ts`](../src/lib/craftDemos.ts); the shared component supplies the frame automatically. Do not recreate its frame in a demo component or add `dev-surface`, a stronger elevation shadow, or a second background plate.

The shared frame owns `--comp-demo-frame-container` (aliased to the page surface, `--sys-color-srf`), the save bar’s shared `--surface-stroke-shadow` (a light inner ring and dark outer ring, both zero-blur) drawn above demo content, a tighter soft drop shadow, corner radius, and mobile full bleed. Depth comes from these edges rather than a contrasting fill or a broad floating-card shadow. At widths below `40em`, it must reach both page edges without horizontal overflow. Controls or product panels **inside** the demo may use the editor's surfaces; that does not change the outer frame.

Only use another frame treatment when Anto explicitly requests it. Record a frameless exception as `frame: 'none'` in the registry, as the image-framing demo does. Keep exceptions out of page-specific CSS so the default remains shared and reviewable.

The shared frame shows the existing `LoadingSpinner` while an iframe loads and any Astro islands finish hydrating. Keep this loading state in `ProjectInteractiveDemo`, not in individual scenes.

Iframe demos use [`DemoLayout`](../src/layouts/DemoLayout.astro). A small control demo must fit its frame without vertical scrolling; opt into `scrolling` only when scrolling is part of the demonstrated interaction. Size the scene and layout together rather than merely hiding an overflowing control. Stageshow supplies the scene and choreography inside this frame, not a replacement outer surface.

Demo cursors keep their native proportions relative to the featured control. Share the control’s enlargement factor with every cursor kind, including the I-beam: a control enlarged by 47% needs a cursor at 1.47×. Use one scale setting for the control and cursor, then let stage fitting scale both together. Do not choose an independent large-cursor preset. Sabi uses `--sabi-demo-scale` for its field height and Stageshow’s `--ss-cursor-size`.

Run `bun scripts/test/craft-demo-build.test.mjs` after a build. It checks that embedded demos use the shared frame and that exceptions are explicit. Review the save-bar rings above the content, subtle outer shadow, full bleed, and absence of accidental scrolling at desktop and phone widths.

## Figma

Build Figma work from the existing design-system components: elements → atom variants → atoms → particle components. A text sample in a mockup is an instance of the text-style particle, not a hand-styled raw text node. If the needed component does not exist, create it properly first or ask Anto about the structure. A raw node that merely looks right hides the missing system component.

When mentioning a Figma component, frame, or mockup in chat, PRs, or rotation docs, link its canonical node URL (`https://www.figma.com/design/:fileKey?node-id=:id`, with an ID such as `123-456`) rather than giving only its name. See [`figma-design-system.md`](figma-design-system.md) and [`figma-source-alignment.md`](figma-source-alignment.md).

## About page

The About page uses a CSS-only three-state layout, with no Flip or resize tween:

- Wide (`>=50em`): 3:4 photo in a `17em` column left; Contact, About, and Experience stacked right.
- Medium (`40–50em`): square `17em` photo and Contact in the top row; About and Experience full width below.
- Narrow (`<40em`): square full-width photo, then Contact, About, Experience.
- Photo position is `50% 35%` for the square crop and `50% 50%` for portrait.
- Bio `max-width` is `38em`.
