# 0002. Content publishes separately from the engine

Status: Accepted (2026-11-22, recorded from code comments)

## Context

Content (`src/content/**`, `media/**`) lives in a private repository and publishes straight to `main` from the dev save bar. The engine that renders it travels through feature branches and PRs (see `AGENTS.md` → *Choose the delivery lane first*). The two are versioned separately, so a content edit can depend on rendering code the live site does not have yet, and a publish made from a feature branch can silently revert someone else's edit on `main`.

## Decision

**Rendering gate, branch-level and fail-closed.** `RENDERING_PATHS` lists code that decides how content JSON becomes pixels, including the dev writers in `astro.config.mjs` (they shape what gets written) and `scripts/collect-shipped-assets.mjs` (it decides which media ships). Publishing is refused while the branch touches any of them, committed since divergence or dirty in the tree (`renderingChanges`, using a three-dot diff so commits on `main` are not this branch's problem). A per-field check (feature manifest or static analysis of the renderer) was rejected because it fails *open*: one unregistered field or parse miss permits a breaking publish. `force` is the owner clicking through the warning; the owner knows whether they just used a new toggle, the check cannot. A stale list also fails open, so err towards including a path.

**Unpublished means "differs from the publish branch", split into ahead and behind.** Content committed on a feature branch is still unpublished; content published off-branch stops counting once it lands, though it stays dirty against the branch until that merges (`unpublishedContent`). A file whose copy is still what we last put on `main`, or what the branch started from, is *behind*: `main` moved, and offering to publish it would revert whoever moved it. Only *ahead* files are publishable (`splitAheadBehind`, shared with the styles publisher in `scripts/dev-commit-engine.mjs`). With no shared history every difference reads as ours, which is safe because the staleness guard still refuses anything `main` changed under us.

**A local publish record.** `publishRecordPath` stores `path → blob sha` of what this checkout last published, inside `.git`, never committed or synced, because it describes what *this* working tree sent. Without it, the second publish from the same branch saw `main` carrying a commit the merge base predates and refused, so cross-branch publishing worked once per branch. `staleFiles` refuses only files whose `main` copy is neither ours nor the branch's starting point. The record is written only after the push lands, and a failure to write it never fails a publish that already landed (it costs at most a recoverable false "main has newer edits").

**Plumbing, not a second checkout.** `publishFromBranch` seeds a scratch index from `origin/main`, swaps in this tree's content blobs (always mode `100644`; deletions publish as deletions), writes a tree, commits onto `origin/main` and pushes the bare commit, so the push is rejected if `main` moved since the fetch. The working tree, index and branch are never touched, so nothing moves under the dev server and no engine work can be swept in. A worktree pinned to `main` was rejected: same property, plus a lifecycle to get wrong. `publishInPlace` stays separate for the one case where moving the branch ref is wanted (standing on `main`), and refuses if anything outside the content surface is staged. `scripts/test/publish-cross-branch.test.mjs` runs the real module against throwaway origin + clone repos because plumbing bugs are otherwise found on the live site.

**Status is cheap.** `publishBaseRef` compares against the last-fetched tip without fetching: the save bar polls `publishStatus` on every dev-mode entry. Publish and revert fetch before acting.

**Revert restores, never deletes branch work.** `revertUnpublishedContent` restores paths this branch changed to `HEAD` and others to the publish tip. A path a migration changed on the branch reverts only its working-tree edit, because checking out `main` would undo the branch commit and can empty the live page. A file absent from `main` but committed on the branch is branch work, not an untracked edit: an entire branch-new content directory looks exactly like that from `main`'s side.

**Commit subjects.** The VPS helper writes the subject so the Mac needs no resident model. The prompt is bounded at 24,000 characters and leaves JSON field paths out, because small models copy them into the subject. Any failure falls back to a generated subject.

**Branch sync** stops Astro before restoring drafts so nothing writes mid-restore, after lease checks; a replay skips backups that may never have touched their files (`scripts/branch-sync.sh`, `scripts/branch-sync-drafts.mjs`).

**Engine-only builds** must not assume content: pages that show content media import it with optional globs (`src/pages/sabi.astro` → `covers`).

## Consequences

A false refusal is always preferred to a silent revert or a broken live page. The override exists for the false refusals.

## Where

`scripts/dev-publish.mjs` → `RENDERING_PATHS`, `renderingChanges`, `unpublishedContent`, `splitAheadBehind`, `publishRecordPath`, `staleFiles`, `publishBaseRef`, `publishInPlace`, `publishFromBranch`, `revertUnpublishedContent`, `generateMessage`, `publishDevWriter`; `scripts/dev-commit-engine.mjs` → `splitAheadBehind`; `scripts/branch-sync.sh`; `scripts/branch-sync-drafts.mjs`
