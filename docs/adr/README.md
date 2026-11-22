# Architecture decision records

Source code carries no explanatory comments ([ADR 0001](0001-no-code-comments.md)). A decision that is important and not obvious from the code is recorded here instead; anything else is deleted, and a known shortcut becomes a GitHub issue.

Each record names files and symbols, never line numbers, so `rg` finds the code. Update the record in the same PR when the decision changes; mark a reversed one **Superseded by NNNN** rather than deleting it.

| ADR | Decision |
| --- | --- |
| [0001](0001-no-code-comments.md) | No code comments; decisions live here, shortcuts live in issues |
| [0002](0002-content-publishes-separately-from-engine.md) | Content publishes to main on its own lane, guarded against reverting others |
| [0003](0003-calm-dev-hmr.md) | The dev server never full-reloads on its own |
| [0004](0004-design-token-pipeline.md) | `tokens/design-tokens.json` is the single source of colour tokens |
| [0005](0005-dev-only-authoring-writers.md) | Authoring writes go through dev-only Vite routes that never ship |
| [0006](0006-asset-pipeline.md) | What ships is derived from the build output, not from content status |
| [0007](0007-viewport-canvas.md) | The viewport canvas holds the reader's place while a page morphs |
| [0008](0008-dev-tooling.md) | Dev tooling must degrade cleanly where it cannot run |
| [0009](0009-public-routes.md) | Public routing: Sabi subdomain, tracked short links, absolute metadata |
| [0010](0010-interface-ownership.md) | Components own their spacing; floating layers use the top layer |

## Template

```md
# NNNN. Decision in one line

Status: Accepted (YYYY-MM-DD)

## Context
What forced a choice.

## Decision
What we do, stated so a reader can check code against it.

## Consequences
What this costs and what breaks if it is undone.

## Where
`path/to/file` → `symbol`
```
