# Interface rules audit — 2026-11-16

Audit of the former 156-line `docs/interface-conventions.md` and the UI rules in `AGENTS.md`, done while splitting the doc into a 35-line index plus `docs/interface/*.md`. Every rule was moved, none deleted; stale facts were corrected in place.

## Enforced by a test

| Rule | Check |
| --- | --- |
| Floating layers render in the top layer (`popover`) | `top-layer-floating.test.ts` |
| Top-layer menus and listboxes use `.dev-menu` | `top-layer-floating.test.ts` |
| A call site never re-sets padding, gap or radius a `ui/` component owns, by CSS rule, a class on the component tag, inline `style`, a utility class, or re-pointing a `--dev-*` spacing token | `dev-chrome-ownership.test.ts` **(new)**; 21 older overrides form a baseline that may only shrink |
| DevOverlay content sets no padding or margin on its root and no bottom padding or margin on its last child | `dev-chrome-ownership.test.ts` **(new)** |
| The interface index stays under 40 lines, links resolve, every topic file is routed | `interface-docs.test.ts` **(new)** |
| A good-enough component names its finishing issue (`good-enough: #N`) | `interface-docs.test.ts` **(new)** |
| Select value and options share `--dev-text-select-value` | `select-typography.test.mjs` |
| Demos use the shared frame; exceptions are explicit | `craft-demo-build.test.mjs` (post-build) |
| Page transition readiness and loopback-only no-veil query | `page-transition.test.ts` |

## Enforced by a component (no test, but the call site cannot get it wrong if it composes)

Menu spacing, radius, separators and instant open; DevOverlay inset, gaps, fade-with-rise and reduced-motion rise of 0; Button and Field hit areas (`--dev-hit-inset`); raised button bevel; text-link underline (`.text-link` in `global.css`); demo frame, loading spinner, full bleed; safe viewport height (`bindSafeVh`); gallery ink threshold (one constant in `coverLuminance.ts`).

## Prose only

| Rule | Why not automated |
| --- | --- |
| Text gaps are whole `--space-unit`s, ink to ink | Needs layout. Now measurable with `scripts/dev-measure.ts`; the test suite has happy-dom only, no layout engine |
| Equal panel insets and shared baselines at runtime | Same: measured by `dev-measure.ts`, not asserted. A headless-browser test would need a new dependency |
| Dashed hairline means editable only | 26 `dashed` uses; deciding which are edit affordances is judgement |
| No raw `vh`/`svh` for a visually important height | 15 raw uses; "visually important" is judgement |
| Reduced motion keeps fades (`transition: none` never on a fade) | 66 `transition: none`; a static scan cannot tell fade from movement |
| Labels only, no explanatory copy | Natural-language judgement |
| Page ground surfaces use `--sys-color-srf`, never literal white | Checkable for the four named selectors; not done yet |
| `78.5em` sidebar literals stay in sync | Checkable (all literals equal); not done yet |
| Do not copy `project/legacy/` markup | Checkable as an import ban; not done yet |
| Colour roles by purpose; ground-named variants; chip ring one step darker | Judgement / no structural hook |
| Compose pages from content-backed blocks; report editor gaps | Judgement |
| Figma: build from components, link node URLs | Outside the repository |
| About page three-state layout | Single page; visual review |
| Write-up Index control stays single-use in `WriteupLayout` | Judgement |

## Stale, corrected in this PR

- `--page-text-max-width` is `37.5em`, not `40em` (also fixed in `page-width.md`).
- The `78.5em` literal no longer lives in `DevTextEditor.astro`; it is in `ProjectSectionTitle.astro` and `reports/RailSchematic.astro` too.
- The hit-area token now exists in CSS as `--dev-hit-inset` (4px, halved); the doc still said "when the token is exported".
- "Use only components on `/styles`; ask Anto before introducing something" contradicted "add it to the design system". Replaced by the missing-component rule in the index.
- The reduced-motion press-scale exception lived only in a `global.css` comment; now in `motion.md`.

## Still to decide (owner)

- Reduced-motion parity is parked "until v1 actually ships"; confirm whether that still holds.
- `dev-measure.ts` on `/styles` reports a 1.5px baseline gap between the label and value in the Award badge and Award block size range rows, and `Image descriptions` / `Pages` / `Award block size` panels show bottom insets that differ from their sides when opened outside their normal context. Worth a look before treating them as bugs.

## Skill

`design-system-first` (Atlas `custom-skills/`, installed for Codex, Claude Code and Cursor) carries the workflow for any design system: find the index, compose instead of styling, stop on a missing component, check with numbers, graduate repeated mistakes into checks. It bundles a generic copy of the measuring script and keeps VCDwebsite's paths and checks in `references/vcdwebsite.md`.
