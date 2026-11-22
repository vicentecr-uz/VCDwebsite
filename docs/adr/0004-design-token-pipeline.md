# 0004. Design-token pipeline

Status: Accepted (2026-11-22, recorded from code comments)

## Context

Colour tokens are edited by hand, from the `/styles` page, and in Figma. Three sources drift unless one is authoritative.

## Decision

- `tokens/design-tokens.json` (DTCG) is the single source. `scripts/build-tokens.mjs` generates the token block in `src/styles/global.css` and a dev-only alarm sheet, idempotently. A DTCG alias `{a.b.c}` compiles to `var(--a-b-c)`.
- Only `ref` tokens hold literal hex; `sys` and `comp` alias them. The `/styles` writer edits `ref` tokens only, writes the JSON, then regenerates the CSS. The editable set is rebuilt from the JSON on every request so a hand edit needs no dev-server restart.
- An unfilled `sys` token ships in the JSON as `#ff00ff`. Production CSS omits it; the dev alarm sheet keeps it (including under the OS dark media query) so a gap is loud locally.
- `bun run tokens:check` fails on: a token reference in `src/` missing from the JSON, any legacy `--color-*` reference, generated CSS out of date, and token names drifting from the Figma snapshot (`tokens/figma-tokens.json`). Names are derived from Figma by a pure string rule, so any divergence means one side moved without the other.
- Colour-token CSS is the one engine file the save bar may publish straight to `main` (**Publish styles**), using the same scratch-index pattern as content publish ([0002](0002-content-publishes-separately-from-engine.md)); `STYLE_TOKEN_PATHS` limits it to `global.css` and the JSON.
- `src/styles/dev-chrome.css` is imported site-wide from `Layout.astro`. Every `Dev*.astro` panel uses its classes but none imports it, so without the global import real pages rendered dev chrome unstyled.

## Consequences

Never edit the generated block in `global.css` by hand. Production dark mode is pinned off for now (issue #68), which is why production omits the OS media query.

## Where

`scripts/build-tokens.mjs`; `scripts/check-tokens.mjs`; `astro.config.mjs` → `collectRefTokenEntries`, `styleTokenDevWriter`; `scripts/dev-commit-engine.mjs` → `STYLE_TOKEN_PATHS`; `src/layouts/Layout.astro`
