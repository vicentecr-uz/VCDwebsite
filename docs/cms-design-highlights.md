# CMS design highlights (meta page seed)

Living list of **novel Edit / CMS UX** worth calling out on the eventual **meta CMS design** page (and anywhere we explain what makes this authoring layer ours).

**Not** every feature — only things that aren’t just a competent copy of existing CMS patterns, or where the *reason* for the departure is the point.

When something you’re proud of ships (or you articulate the why in chat), append it here in the same turn.

---

## Highlights

### Gap toolbar — freeze while choosing, crossfade on leave

**Why:** Resizing a section gap moves the gap’s midpoint. If the spacing pill tracked that midpoint live, the author would chase the control with every chip click. While the pointer is on the pill, freeze it in the viewport; when the pointer leaves, crossfade it to the new midpoint (including when restoring the previous clean value). Vicinity-only reveal stays in-flow so the pill still scrolls with the page. Scroll is locked only while hovering the pill itself.

Small interaction detail; large difference in how calm gap editing feels.

### LQIP / image preview derivatives

**Why:** Fast first paint without ThumbHash theatre — Immich-style thumb → preview path so case-study images feel immediate, with wipe/decode behaviour that doesn’t collapse layout. (Expand on the meta page with before/after feel.)

### Dropdown menus (site + Edit chrome)

**Why:** *(Expand — what we refused from default menu kits, and what the interaction is proud of.)*

### Crop on the page

**Why:** Edit should feel hands-on: crop and frame on the real image in situ (WYSIWYG), not only through a detached console. Aligns with the product-vision push toward in-canvas controls over modal tuners.

---

## How to use this list

- **Meta CMS design page:** each entry is a candidate story — show the interaction, then the why.
- **Agents:** when Anto names something as pride / “highlight for the meta CMS page,” add it here immediately.
- **Sibling:** long-horizon product intent stays in [`product-vision.md`](product-vision.md); this file is the **pride / novelty** inventory for Edit.

**Atlas:** same list mirrored at `projects/P-018/cms-design-highlights.md` for sessions that open Atlas first; **this repo file is canonical** for the site/meta page.
