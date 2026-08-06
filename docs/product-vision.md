# Product vision (north star)

Captured 2026-08-06 from product discussion. **Not a build plan** — guidance for later milestones (v3+). Do not start online edit or open-sourcing from this file alone.

## Modes

Mentally there are two states:

1. **View** — the public site
2. **Edit** — same pages, authoring tools on

Everything else (section reorder, crop, log issue, grid management, style tokens, …) sits **inside Edit**. There is no separate “mode identity” for those tools in the author’s head.

Locally today this is “dev mode.” Longer term the product word is **Edit**.

## Online Edit = full parity

When Edit is eventually hosted on the live site (auth once, session cookie ~1 week, same keyboard shortcut), it must do **everything** offline Edit can do today — not a content-only subset.

That includes content writes, media, crops, spacing, section/grid tooling, issue filing, style work, publish flows, and whatever else Edit grows into. Partial online Edit that forces a laptop for “the rest” is a non-goal.

Still not scheduled. Stack direction (static site + authenticated write path) can support it; the bar is parity, not a thinner CMS.

## WYSIWYG (guiding principle)

In Edit, what you see on the page is what View will show. Same renderer, same layout, same components — authoring overlays the real site; it does not preview a parallel skin.

### Hands-on Edit (UX direction)

Pop-up tuner panels are a current means, not the destination. Over time, Edit should move controls **onto the page**:

- Example: “edit image” → in-place affordances (aspect-ratio dropdowns, crop frame on the image itself) instead of a separate control panel
- Feel: direct manipulation, hands-on — not operating the site through a detached console

New Edit UI should prefer in-canvas / adjacent chrome over modal tuners when both are viable.

## Open source (later)

Longer horizon: open-source the project so others can run their own sites. Operators bring:

- Hosting (own VPS, other web host, a PikaPods-style one-click, or an optional hosted offering with a small margin)
- Their own content and ideas

The codebase can grow past what one author imagines. Growth stays under the same principles: **View / Edit**, **WYSIWYG**, and Edit that stays hands-on on the real page.

## Related today

- Local Edit: `import.meta.env.DEV`, `DevModeController`, content APIs in `astro.config.mjs` / `scripts/dev-*.mjs`
- Production CMS (`/admin`, Sveltia + GitHub PKCE) is a separate structural editor — not a substitute for full online Edit parity
- Content vs engine split and Save & Publish remain relevant however Edit is hosted
