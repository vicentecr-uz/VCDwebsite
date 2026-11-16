# Colour, ink, links and edit affordances

Read when choosing colour or rule tokens, styling links, or showing an editable state.

## Page ground

Use `--sys-color-srf` for every surface meant to read as the page: page background, `.site-header__bg`, nav panel, and menu backdrop. Never give one of these stacked surfaces a literal white; they must move together when the ground changes.

## Ground and ink

Choose text and rule tokens by purpose using [Colour roles](../colour-roles.md): primary reading, readable supporting content, or readable optional metadata. Text and decorative rules have separate contrast requirements.

Light/dark variants are named for the **ground**, not the ink. `on-dark` is the white-icon set because it sits on a dark ground. Listing `dark` and `hoverDark` flags likewise describe the cover. Project-grid chip palettes are `--chip-{ink,fill,ring,press}-on-{light,dark}`; the ring is always one step darker than its fill on both grounds.

Gallery title/meta ink flips from one shared threshold: `HOVER_LUMA_THRESHOLD` in `src/scripts/coverLuminance.ts`, used by `adaptiveMediaInk` and `bindGalleryMediaInk`. Higher keeps dark ink over more mid-tones; lower switches to light ink sooner. Do not tune this in CSS or `ProjectGrid.astro`.

## Edit affordances

A dashed hairline means **editable**, and nothing else in dev chrome may use one.

- Text fields show it while `contenteditable`.
- Media frames show it during image drag, inset and rounded so it reads as the receiving slot rather than the frame border.
- Solid rules and fills communicate state: selected, lifted, span frame, or dropping.
- Use `--dev-edit-dash` and `--dev-edit-dash-color` from `global.css`. When touching a legacy hand-rolled `color-mix`, converge that instance; do not sweep unrelated code.

## Text links

Inline text links follow the home intro’s Kingfisher link: an underline at 10% of the current text colour, `0.08em` thick and `0.15em` below the text; pointer hover strengthens it to 30% over 150ms. Use the shared `.text-link` class outside body-text blocks. Body-text links, the existing `.project-inline-link` alias and the home intro action share the same rules in `global.css`; do not recreate the underline at call sites. The editor’s explicit underline-off formatting remains supported. Navigation, cards, media hit areas and filled buttons retain their own component treatment.

The write-up Index control is a native link to `/digital`, styled as a quiet text control: label and return icon both use `on-srf-subtle`, darken together to `on-srf` on hover or keyboard focus, and never underline. Keep this single-use treatment in `WriteupLayout` until another real caller needs it.
