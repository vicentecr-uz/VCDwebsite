---
name: delete-comment
description: Audit and delete code comments in VCDwebsite, one slice at a time. Categorise each comment as tautology, stale, excuse or decision record; delete tautologies and stale ones, file an issue for each excuse, move decision records into docs/adr/, then tighten the comment ratchet. Use when the owner says /delete-comment, asks to remove or audit comments, or when `bun run lint:comments` fails because a file grew a comment.
---

# /delete-comment

Policy: [`docs/adr/0001-no-code-comments.md`](../../../docs/adr/0001-no-code-comments.md). Source carries no comments; decisions live in `docs/adr/`, shortcuts in GitHub issues with a `known limit: issue #N` marker at the code. `bun run lint:comments` is the ratchet.

Read root `AGENTS.md` first. This is engine work: a dedicated worktree from latest `origin/main`, a `chore/` or `refactor/` branch, and the full PR lifecycle.

## 1. Pick a slice

The argument is a path regex (`^src/lib/`, `^src/components/project/`). With none, pick the largest remaining directory from `scripts/comment-baseline.json`. Keep a slice to roughly 300–500 comment blocks so every one gets read.

## 2. List

```sh
bun .claude/skills/delete-comment/scripts/list.mjs '<path-regex>' <scratch>/blocks.json
```

Adjacent full-line comments merge into one block. Each block prints as `[id] Lline: text` with the next line of code. Directives are already excluded (`@ts-*`, JSDoc type tags in JS, pragmas, licence banners, `good-enough: #N`).

## 3. Categorise every block

Write `<scratch>/decisions.txt`, one line per block: `<id> <T|S|E|D> [theme-or-issue]`.

| Code | Kind | Test | Action |
| --- | --- | --- | --- |
| `T` | Tautology | The code, a name, a type or an existing doc already says it | Delete |
| `S` | Stale | Describes removed code, old behaviour, or an issue number that no longer matches (check with `gh issue view N`; issue numbers were re-imported) | Delete |
| `E` | Excuse | Licenses a shortcut: "for now", "legacy … kept for", "keep in sync with", "mirrors", "belt-and-suspenders", "Ceiling:", "workaround", "drop once …", a TODO | Delete, file or reuse an issue, then add `known limit: issue #N` |
| `D` | Decision record | Important and not obvious from code: a browser quirk, a rejected alternative, an invariant whose breach is silent | Move into an ADR, then delete |

Judgement calls:

- Read the code, not just the comment. If a rename or an extracted function would make it obvious, it is `T`; say so in the PR rather than doing the refactor here.
- A comment that explains a test's setup is `T`; one that records how the test environment differs from browsers is `D` (ADR 0008).
- A JSDoc block in plain JS keeps its type tags; `apply.mjs` strips only the prose.
- When unsure between `T` and `D`, ask whether a reader changing this code would break something silently without it. Yes is `D`.

## 4. Record decisions

Group `D` blocks by theme. Add to the existing ADR when the theme fits (see `docs/adr/README.md`), otherwise create the next `NNNN-kebab-title.md` from the template there and add it to the index. Write the decision in your own words, naming files and symbols, never line numbers. One ADR per decision area, not per comment. Check every symbol you name exists (`rg`).

## 5. File issues for excuses

Group `E` blocks by the shortcut they excuse, one issue each; collect small scale ceilings into one tracking issue with a checklist. Search open issues first (`gh issue list --search`) and reuse one that already covers it. Every new issue gets a label and a milestone (`AGENTS.md` → Working rules); ask the owner if either is unclear. The body names each file and symbol and quotes what the comment claimed.

Check that each `E` comment annotated real code: an orphan with nothing under it is `S`, not `E`.

## 6. Apply, mark and ratchet

Apply first: `apply.mjs` works from saved offsets and refuses any file that changed since `list.mjs` ran.

```sh
bun .claude/skills/delete-comment/scripts/apply.mjs <scratch>/blocks.json <scratch>/decisions.txt
```

Then put exactly `known limit: issue #N` (in the file's comment syntax) on the line directly above each shortcut. In Astro markup, put it in the frontmatter or a script, never inside a tag. Then tighten and check:

```sh
bun run lint:comments --update
bun run lint:comments
bun run lint:comments --issues
```

`apply.mjs` deletes JS, CSS and shell comments, keeps JSDoc type tags, `@template` and a bare `@deprecated`, and never joins tokens. It refuses and lists three kinds for you to edit by hand: markup comments (`<!-- -->` and `{/* */}`), because removing one can change rendered whitespace (`<pre>`, `pre-wrap`, JSX text); JSDoc whose type tags it cannot keep whole; and blocks marked unparsed. Check the rendered page for each markup comment you remove. Review `git diff -U0 | grep '^+'`: every added line should be a trimmed JSDoc tag or a line that lost a trailing comment.

## 7. Verify and hand off

`bun run build`, `bun run test` and the suites in `.github/workflows/engine-validation.yml`. Compare failures with `origin/main` before blaming the slice. In the PR, report per category: blocks, lines shed, ADRs touched, issues filed or reused.
