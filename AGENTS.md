# VCDwebsite — agent guide

This is the canonical project guide for every agent harness. `CLAUDE.md` and `.cursor/rules/vcdwebsite.mdc` are harness adapters that point here; do not duplicate common policy in them.

Harness and system instructions outrank repository prose. This guide defines project invariants and delivery outcomes, not provider-specific model names or unsupported harness mechanics.

## Project and sources of truth

VCDwebsite is Vicente Cruz's Astro + Bun + Tailwind CSS v4 + GSAP portfolio site. Cloudflare Pages deploys `main` to [vicentecr.uz](https://vicentecr.uz).

- This file is canonical for work inside this repository.
- GitHub Issues is the only task list for this site. Work in other products belongs in those products' repositories; only their VCD route, embed, navigation, or site-shell integration belongs here.
- Long-horizon product intent lives in [`docs/product-vision.md`](docs/product-vision.md); it is not a build queue.

## Workspace boundary

The owner's primary checkout and its port `4321` session are the owner's uninterrupted workspace. Agents may read files and inspect state there only to understand the task or locate/create an isolated worktree. Never edit files, change its branch or index, commit/reset there, or start/stop/restart its dev session or branch sync.

After creating or locating a dedicated sibling worktree, all edits, builds, servers, and task Git operations happen there. A harness-provided task worktree counts. Unless the task explicitly depends on another local base, start from the latest `origin/main`. The responsible agent owns branch, worktree, and preview-port collision avoidance; the owner should not have to operate the terminal or coordinate agent plumbing.

Bun is available as `bun` in the task environment.

## Choose the delivery lane first

The content surface is `src/content/**` plus `media/**`. Everything else is engine unless a row below names a narrower workflow.

| Task | Workspace and delivery lane |
| --- | --- |
| Read-only inspection, explanation, or diagnosis | May inspect the primary checkout. Do not mutate files or repo state, build, start a server, commit, push, or open a PR unless separately requested. |
| Engine code, UI, tooling, or configuration | Dedicated task worktree and feature/fix branch; use the full PR lifecycle below. Never include routine content. |
| Repository docs or standards | Dedicated task worktree and a standalone docs branch from latest `origin/main`; use the same lifecycle with a PR that targets `main`. Never bundle standards work into a feature branch. |
| Routine content | The owner owns authoring and publication through in-page Edit. **Save** writes locally; **Save & Publish** uses the app-mediated publisher. Agents do not edit or publish routine content unless the owner explicitly requests it and agrees the delivery path. |
| Schema migration coupled to engine | Dedicated task worktree and one migration branch/PR. Engine and the required `src/content/**` or `media/**` changes travel together. Commit only explicit paths with `commit:engine --schema-migration`. |
| Styles | The owner's colour-token edits on `/styles` use **Save** then the app-mediated **Publish styles** action; read the current main-branch limitation in `docs/dev-authoring.md`. Agent-authored CSS or style-engine changes use the normal engine PR lane. |
| Isolated hosted task (Codex Cloud or Cursor remote/cloud) | Follow the scoped override at the end of this file. |

There is no shell-Git direct-to-`main` lane in VCDwebsite. The only direct-main exceptions are the app-mediated **Save & Publish** and **Publish styles** flows. Agents never translate those exceptions into `git push origin main` from this repository.

## Engine and docs lifecycle

The responsible top-level agent owns this sequence. When the active harness exposes a repository-configured implementation-worker role, use it for bounded worker steps; otherwise use the harness's native worker mechanism. When work is delegated, the worker's default boundary is: edit in the assigned worktree, run the requested checks, commit explicit paths, and report the commit SHA and evidence. Unless the manager explicitly delegates another bounded step, workers do not push, open PRs, start previews, merge, or clean up.

Use this sequence for every engine or repository-docs change:

1. Fetch current remote state without changing the owner's primary checkout. Create or verify a dedicated task worktree and branch based on latest `origin/main`, unless the task explicitly names another base.
2. Inspect the real flow, choose the correct lane above, and read the relevant references below.
3. Edit only in the task worktree. Preserve unrelated dirty files and coordinate any overlapping paths with other agents.
4. Run `bun run build` and relevant focused tests. A build proves compilation, not UI correctness.
5. Commit only files changed for the current task, passing every path explicitly:

   ```sh
   bun run commit:engine "message" path/a path/b
   ```

   For an approved schema migration only:

   ```sh
   bun run commit:engine --schema-migration "message" path/a src/content/path media/path
   ```

6. Push the branch and open or update its PR. A draft PR is appropriate while result review is pending.
7. The responsible manager reviews `git diff <base>...<head>` itself. Worker reports and green checks are inputs, not substitutes for reviewing the actual diff.
8. For site/UI results only, start a persistent review server from the task worktree on an unused port `4322+`:

   ```sh
   bash scripts/dev-worktree-preview.sh start <port>
   bash scripts/dev-worktree-preview.sh status <port>
   ```

   Confirm the exact route with `curl`. This proves availability only; the owner performs interactive visual verification. Do not drive pointer, hover, focus, drag, or animation QA headlessly.

   Cloudflare Pages branch previews are optional and are not an ordinary review or merge gate. Use one when the owner requests a remotely reachable URL, especially for phone testing away from the local network, or when a task genuinely requires Cloudflare-specific verification. Otherwise use the local worktree preview and do not wait for a pending Cloudflare preview check before merging. An enforced branch-protection requirement still applies until the repository setting is changed.
9. Hand off the branch name, exact reviewed commit SHA, PR link, and checks run. For site/UI work, also provide the clickable localhost route and a numbered test script with exact expected results. Keep the preview and worktree alive through review.
10. Wait for explicit sign-off on the reviewed result, such as “keep”, “approved”, “ship it”, or “looks good”. Silence, partial feedback, or approval of an approach is not result sign-off.
11. On sign-off, fetch the current base and confirm the reviewed SHA and diff are unchanged, the worktree is clean, the PR is conflict-free and mergeable, required build/tests/non-preview CI pass, and no blocking review remains. A Cloudflare branch-preview check is required only under the optional-preview rule above. Mark a draft PR ready if needed. If any review input changed, stop and report the blocker instead of merging unseen work.
12. Merge through the PR route, confirm remote `main` contains the reviewed commit and relevant required check result, stop the preview, remove the review worktree, and delete the merged remote and local branches. Cloudflare Pages **starting** a production deploy of `main` (this commit or a later one that contains it) is enough to stop. Do not curl the live host or wait the 3–4 minute cutover; later merges can replace an in-flight Pages deploy. Keep a base branch only while a stacked PR still depends on it. Never switch or restart the owner's primary checkout during cleanup.

Feedback returns the task to step 3: update the branch, rerun proportionate checks, push, review the new complete diff, and hand off a new SHA. Prior result approval never transfers to a changed SHA. If the owner explicitly declines or abandons the result, do not merge; close the PR when appropriate and clean up its preview, worktree, and unneeded branches unless the owner asks to preserve them.

Never merge another feature branch into a task branch merely to test them together. Use a disposable integration branch or merge each approved PR normally.

## Working rules

- When opening a GitHub issue, assign a relevant label and milestone. If either is genuinely unclear, ask the owner before filing.
- Only stage and commit files changed in the current chat session for this task. Never sweep in another person's dirty work; always pass explicit paths to `commit:engine`.
- Fix root causes and inspect other callers before changing shared behavior.
- First ask whether a change is needed at all. If it is, stop at the first adequate solution: existing project pattern, standard library, native platform feature, installed dependency, one line, then the minimum new code.
- Prefer deletion and existing files over new abstractions or dependencies. Do not trade away validation, error handling, security, or accessibility for a smaller diff.
- The owner owns product intent and UI feel; the responsible agent owns implementation shape and should explain a material tradeoff before locking it in.
- If work moves to another session, leave a builder-ready handoff: done condition, required worker capability, branch/issue, first reads, settled root cause and approach, exact change list, landmines, cleanup, verification, out of scope, and pickup instruction. Include pseudo-code for timing loops, observers, or state machines. Use the handoff mechanism supported by the active harness.

## Task router

- UI, typography, spacing, motion, responsive layout, components, Figma: [`docs/interface-conventions.md`](docs/interface-conventions.md)
- In-page Edit, content/media, project statuses, Save/Publish internals: [`docs/dev-authoring.md`](docs/dev-authoring.md)
- Page-width token and breakpoint inventory: [`docs/page-width.md`](docs/page-width.md)
- Figma architecture and source alignment: [`docs/figma-design-system.md`](docs/figma-design-system.md), [`docs/figma-source-alignment.md`](docs/figma-source-alignment.md)
- QA rotation: [`docs/workflow-qa-rotation.md`](docs/workflow-qa-rotation.md)
- Product direction: [`docs/product-vision.md`](docs/product-vision.md)

## Hosted task override

This section applies inside an isolated hosted agent task where the owner's local paths are unavailable, including hosted Codex and Cursor remote/cloud. It does not apply to local desktop sessions.

- The owner's primary checkout and local persistent review previews are unavailable. Skip only those local steps; do not treat their absence as a blocker.
- Use the task's provided checkout and selected Git ref as the isolated workspace. Do not start `dev:session` or branch sync.
- Bun is available as `bun`. Run `bun run build` and relevant tests before handoff.
- Push the task branch and open a PR. Hosted work is PR-only handoff: never merge and never push directly to `main`.
- Do not modify `src/content/**` or `media/**` unless the task explicitly requires a schema/content migration.
- The owner performs visual acceptance after the PR is available locally.
