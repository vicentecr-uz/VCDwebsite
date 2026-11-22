# 0001. No code comments

Status: Accepted (2026-11-22)

## Context

An audit of the engine found 2,844 comments (4,817 lines) across 285 files. They fell into four kinds:

- **Tautology**: restates what the code already says.
- **Stale**: describes code, history or issue numbers that no longer hold. Several cited issue numbers from before the issues were re-imported (`#256` for dark mode is now a merged PR about block reordering).
- **Excuse**: licenses a shortcut ("belt-and-suspenders", "Ceiling: …", "keep in sync with …", "legacy … kept for older readers"). The next change copies the shortcut because the comment makes it look sanctioned.
- **Decision record**: explains an important, non-obvious choice. These are worth keeping, but a comment beside one call site is invisible from every other place the decision applies, and it rots silently when the code moves.

## Decision

- Source files carry no comments. A non-obvious decision goes in an ADR in this folder; a shortcut becomes a GitHub issue that names the file and symbol; everything else is deleted.
- Machine-read directives are not comments and stay: `@ts-check`/`@ts-expect-error`, JSDoc type tags that type plain JavaScript (`@type`, `@param {…}`, `@returns {…}`, `@typedef`), `/// <reference>`, lint/format pragmas, `/*! license */` banners, shebangs, and the design-system marker `good-enough: #<issue>` (see `docs/interface/components.md`).
- Vendored code (`src/vendor/`, `src/lib/stageshow/`), patches and the private content surface are out of scope.
- `bun run lint:comments` enforces this as a ratchet. `scripts/comment-baseline.json` records how many comments each file had when the rule landed. A file may not exceed its baseline and a new file starts at zero. When a file drops below its baseline the check fails until `bun run lint:comments --update` locks the lower number in, so the ratchet only turns one way. CI runs it in *Engine validation*.
- The `/delete-comment` skill (`.claude/skills/delete-comment/`) repeats the audit on a slice of the codebase.

## Consequences

- Code has to explain itself through names, small functions, tests and types. When it cannot, the explanation belongs in an ADR, which is reviewed like code.
- This supersedes the Atlas standard that asks for a one-line comment naming a deliberate corner-cut's ceiling and upgrade path. In this repository that ceiling goes in an issue.
- Explanations for trivia are lost by design. If deleting a comment would lose something a future reader needs, that is a decision record; move it, do not keep it.
- The checker parses each language rather than grepping, so `//` inside strings and URLs is not a comment: Babel for JS/TS, PostCSS for CSS, `@astrojs/compiler` for Astro (frontmatter, `<script>`, `<style>`, HTML comments and `{/* … */}` expressions), and full-line `#` for shell. The Astro compiler reports byte offsets, so `astroComments` re-anchors each region by searching for its text.

## Where

`scripts/check-comments.mjs` → `commentsIn`, `sourceFiles`; `scripts/comment-baseline.json`; `.github/workflows/engine-validation.yml` → *Ban new code comments*
