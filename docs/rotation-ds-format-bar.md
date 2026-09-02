# Format bar — block style picker — QA rotation

This plan is for use with the `qa-rotation` skill. You are the manager — read that skill before continuing.

Scope: a block-style dropdown in the in-page text format bar (`DevTextEditor.astro`) — Text / Heading 1 / Heading 2 — converting the **whole block**, Notion-style. Branch off `origin/main` (`a2623cd`). Follows the DS-basics rotation (T1–T5, merged as PR #267, see `docs/rotation-ds-basics.md`).

## Queue

- [x] **F1 · Token rename + Heading 2 gets its own type** — **signed off.** PR [#281](https://github.com/vcruzdesigns/VCDwebsite/pull/281). Extra commit `214cacc` orders the `/styles` catalog Heading 1, Heading 2, Text to match the Figma style panel. Branch `feat/ds-type-token-rename`, pushed. Commits `fa0f17e` (rename + h3 binding) + `b5d0937` (manager fix: Heading 2 aligned to Figma's 110% / -2%; the pre-rename token carried the *footer's* 100% / -3%, so `--text-footer-*` keeps those and the two roles are now genuinely separate). Rename `--text-section-title-*` → `--text-heading-1-*`, `--text-subheading-*` → `--text-heading-2-*`; give the Footer its own `--text-footer-*` (same values) so it stops riding the content role. Then bind `level: 3` to `--text-heading-2-*` instead of `.project-section-title`. Without this last part Heading 1 and Heading 2 are pixel-identical and the picker has nothing to show. Pass: a `level: 3` block on `/whatisbudgeting` renders visibly smaller and bolder than an `h2`; `h2`, Footer and `/styles` all unchanged visually.
- [x] **F2 · Figma: icons, renames, style mockups** — **signed off in full.** Mockup reworked to use component instances per the new standard, fixing two faults the hand-built version had hidden (see Findings); Footer particle (`778:4307`) added to close the gap Anto flagged. Added `Icon/Pilcrow` (`759:4308`), `Icon/Heading1` (`759:4314`), `Icon/Heading2` (`759:4320`) to the Icons frame — 16×16, stroke 1.333, bound to `content/icon`, matching the existing set. Renamed `Type/Site/Section title|Subheading|Body` → `Type/Content/Heading 1|Heading 2|Body`; created `Type/Site/Footer`. Built the composition mockup **"Text block styles"** (`761:4299`) on the Design System page: real 40em prose measure, real rhythm (16px after a heading, 64px between clusters). *Original scope was:* add `Icon/Pilcrow`, `Icon/Heading1`, `Icon/Heading2` to the Icons frame (`348:1045`, Particles); rename the three Type styles to match the picker; build a mockup frame composing Heading 1 / Heading 2 / Text in a realistic block sequence so Anto can judge feel before the code lands. Figma write task — needs the `figma-use` skill. Can run parallel to F1.
- [x] **F3 · SelectField → custom listbox** — initial QA found clipping, layout, treatment, and keyboard faults; the F3b/F3c rework below resolved them.
- [x] **F3b / F3c · SelectField popup rework** — **signed off.** PR [#286](https://github.com/vcruzdesigns/VCDwebsite/pull/286) + [#290](https://github.com/vcruzdesigns/VCDwebsite/pull/290) (`f0e6a84`).
- [x] **F4 · Dropdown + conversion** — **signed off and merged.** PR [#293](https://github.com/vcruzdesigns/VCDwebsite/pull/293) (`862815c`).
- [x] **F5 · Cmd+Enter → new block below** — **signed off and merged.** PR [#294](https://github.com/vcruzdesigns/VCDwebsite/pull/294) (`b927498`). Remainder at top of the new block. Undo → [#285](https://github.com/vcruzdesigns/VCDwebsite/issues/285) (v1).
- [ ] **F6 · Outline / nav sync** — converting **to** Heading 1 mints a `sectionId` + `outline` entry; converting **away** removes it. Existing `sectionId`s on Text blocks (scrollspy grouping, e.g. `the-rams.json`) are preserved untouched. Pass: convert a Text block to Heading 1 → appears in the sidebar nav after Save; convert back → it leaves.
- [x] **F7 · Gap toolbar exclusive + menu stacking** — **signed off.** PR [#292](https://github.com/vcruzdesigns/VCDwebsite/pull/292) (`f574d6d`). Closes [#289](https://github.com/vcruzdesigns/VCDwebsite/issues/289).

Order: F1 and F2 in parallel → F3 → F4 → F5 → F6. F4 depends on F1 and F3.

## Model (settled with Anto, 2026-08-27)

A **block** is one entry in `sections[]`. Enter inserts a **line inside** the current block (today's behaviour — unchanged); Cmd+Enter makes a new block (F5). So:

| Picker label | JSON | Renders | Token |
| --- | --- | --- | --- |
| Text | `{ type: 'bodyText', paragraphs: [...] }` | `<p>` per line | `--text-body-*` |
| Heading 1 | `{ type: 'sectionTitle', level: 2 }` | `<h2>` | `--text-heading-1-*` |
| Heading 2 | `{ type: 'sectionTitle', level: 3 }` | `<h3>` | `--text-heading-2-*` |

UI labels are author-facing; the tag is document semantics. Heading 1 renders `<h2>` because the page title owns the single `<h1>` (established in T2).

**No content-schema change.** `level` already exists on `sectionTitle` and already carries exactly this meaning. Conversion replaces `sections[i]` in place, preserving `spacing`; text moves across as `paragraphs.join('\n')` ↔ `title.split('\n')`. Multi-paragraph blocks survive the round trip as line breaks inside the heading — same as Notion converting a Shift+Enter block to H1. Requires `title` to tolerate `\n` (render via `white-space: pre-line` or `<br>`).

## Decisions settled

- Cmd/Ctrl+Enter makes a new block, and **splits at the caret** like Notion (Anto's call — carry the remainder into the new block, don't just insert an empty one).
- Footer gets its own `--text-footer-*` token and a matching `Type/Site/Footer` Figma style.
- F3 migrates `DevLogIssue.astro`'s three selects in the same item.
- Figma naming is `Type/Content/*`, mirroring the Content frame.

## Filed for the v1 clean-up pass (not this rotation)

- [#275](https://github.com/vcruzdesigns/VCDwebsite/issues/275) — Footer rest colour too illegible; shift rest to hover's token, bump hover a level
- [#276](https://github.com/vcruzdesigns/VCDwebsite/issues/276) — `/styles` shows one caption style, there is more than one
- [#277](https://github.com/vcruzdesigns/VCDwebsite/issues/277) — Heading 1 maps to `level: 2`; decide what owns level 1 and unify the naming
- [#278](https://github.com/vcruzdesigns/VCDwebsite/issues/278) — Grid title role documents the meta label; split into two styles
- [#279](https://github.com/vcruzdesigns/VCDwebsite/issues/279) — About should use project-page typography and the same editing tools
- [#285](https://github.com/vcruzdesigns/VCDwebsite/issues/285) — Dev-mode Cmd+Z should undo structural edits (block insert/split/move, crop tuner, etc.), not just typing

## New standard recorded

**Figma — build from components, not ad-hoc nodes.** PR [#282](https://github.com/vcruzdesigns/VCDwebsite/pull/282); cross-project standard in Atlas `standards.md`, with the VCD rule in [`interface-conventions.md`](interface-conventions.md) and root `AGENTS.md` routing every harness to it.

## Findings (from code + Figma)

- **The arrow-key failure was a focus-model bug, not a key-handling bug.** `openListbox()` called `listbox.focus()` and bound every open-state key to `target.closest('.dev-select__listbox')`; focus never landed there, so all keys fell through. Fix is to stop moving focus at all — APG's *select-only combobox* keeps DOM focus on the trigger and drives the highlight with `aria-activedescendant`. Consequence worth remembering: **the focus ring staying on the field while the popup is open is correct**, not a defect.
- **A `<label for>` must never wrap a listbox.** `DevLogIssue` wrapped each `SelectField` — popup included — in `<label for="…-trigger">`, so a click on any option forwarded to the trigger. The label text still needs to be clickable, so `Field` gains an optional `labelFor` and renders a real `<label for>` around the label text only.
- **The bare-column menu treatment was the wrong reference for a select.** That came from the F3 spec, not the worker. `.dev-gap-toolbar__menu` / `.dev-launcher` are menus of independent actions; a select's options are one set and belong in one container. Alt+M is also not a "launcher" — it is a meta tool for reaching dev-mode panels.

- **The component-first rule caught two real faults immediately.** Rebuilding the mockup from instances (rather than styled `createText()` nodes) exposed both: the text particles carried `SCALE` constraints, so any resized instance rescaled its text instead of reflowing it; and `Body text` was a hug-both-axes particle, which cannot wrap to a measure. Fixed at the components — text now uses `MIN` constraints, and `Body text` is a wrapping block (`STRETCH` horizontal, `HEIGHT` autoresize). A hand-built mockup hid both, which is exactly the argument for the standard.
- **Text size is not an overridable property inside a Figma instance.** A child can only follow its instance via constraints, which is why the wrapping behaviour had to be fixed on the component rather than per-instance.

**Correction:** `SelectField` was **not** unused — `src/pages/styles.astro:25,945` imports and renders one in the component-library showcase. The earlier "imported nowhere" note here came from a shell glob error that silently returned no matches. The conclusion still holds (a catalog showcase is not real adoption, so changing its internals was still cheap), but the claim was wrong.

- **The format bar only exists inside `bodyText` blocks today.** `findParagraphState()` (`DevTextEditor.astro:2076`) filters `textStates` to `kind === 'paragraphs'`. Section titles are `kind: 'text'`, `contenteditable="plaintext-only"`, and never raise the bar. F4 must extend this.
- **`level: 2 | 3` is already live.** `ProjectSectionTitle.astro:52` picks the tag; `ProjectSections.astro:119` passes it. On disk: `whatisbudgeting.json` (3 blocks — the numbered "1. Get transactions…" steps) and `conic-collection.json` (4, legacy). Both levels render the same CSS class, so there is no visual difference today.
- **An h2/h3 convention already holds in content.** In `whatisbudgeting.json` every `level: 2` title carries a `sectionId` and an `outline` entry; every `level: 3` carries neither. F6 codifies this rather than inventing it.
- **Figma and CSS had drifted on this role.** Figma's `Type/Site/Subheading` was Bold 17.6 / **110%** / **-2%**; the CSS token was 700 / 1.1rem / **100%** / **-3%**. The CSS was really carrying the *footer's* numbers. Splitting the role fixes both: Heading 2 takes Figma's values, Footer keeps the ones it actually ships, and neither regresses. `Section title` and `Body` matched Figma exactly and were untouched.
- **The Footer is riding the content role.** `--text-subheading-*` is consumed by `Footer.astro:8` and the `/styles` sample — nothing else. Figma now files Subheading under **Content**, not Site, so the footer needs its own role or the rename couples two unrelated things.
- **Body blocks are routinely multi-paragraph** — 2 to 7 paragraphs across `tapico`, `the-rams`, `whatisbudgeting`. This is why whole-block conversion has to preserve line breaks rather than joining on a space.
- **Figma has the three type styles but not the picker.** The Content frame (`752:4299`) holds Section title 1.5rem/700, Subheading 1.1rem/700, Body 1.2rem/400 — Subheading is smaller than Body but much heavier, deliberate. Dropdown chrome is **not** mocked; code prototype first, Figma follows.
- **Figma already mirrors the format-bar icons.** Icons frame `348:1045` (Particles) holds `Icon/Bold`, `Icon/Italic`, `Icon/Underline`, `Icon/Link`, `Icon/Chevron` and 21 others. `Icon/Pilcrow` + the two heading icons slot into an established set.
- **Icons available in `lucide-static`:** `heading-1`, `heading-2`, `pilcrow`, `chevron-down`. Same import pattern as the existing format-bar icons (`DevTextEditor.astro:3-7`).
- **Cmd+Enter is free.** The only modifier binding is `metaKey || ctrlKey` for B/I/U/K at `DevTextEditor.astro:2558`, which excludes shift/alt. Enter itself is handled at `:1441` for paragraph splitting.
- **Two serializer landmines.** `serializeInlineHtml` (`:302`) allowlists `strong`/`em`/`u`/`a` only. `readParagraphsValue` (`:338`) reads `:scope > p` first. Both assume a body block's shape — F4 changes what a block can be.
- **The publish gate will fire, correctly.** `src/components/project/` and `src/styles/project.css` are in `RENDERING_PATHS` (`scripts/dev-publish.mjs:40`), so the save bar shows the amber ⚠ while this branch is unmerged. Designed behaviour — do not "fix" it.
- **Housekeeping:** a leftover worktree from another session sits at `.claude/worktrees/qa-rotation-skill-issues-4daba8`. Not ours; flagged so a `git switch` failure is not mis-diagnosed.

## Open question for Anto

- **Popup motion.** The worker deliberately shipped the listbox with no fade, on the grounds that both reference menus (`.dev-gap-toolbar__menu`, `.dev-launcher`) have zero motion, and a correct fade needs a generation counter to survive rapid open/close. Defensible, and consistent — but the project convention says dev chrome should not pop. Anto's call whether the whole menu family gets a fade later as its own item.

## Status

F1–F5 and F7 are signed off; their code changes are merged. F6 is the remaining queue item. GitHub Issues and PRs are the current task record if this historical rotation log drifts again.
