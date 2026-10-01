# Dev authoring and publishing

This documents local in-page Edit, the content/media model, project visibility, and the app-mediated publishers. Root [`AGENTS.md`](../AGENTS.md) decides who may use each delivery lane.

## Ownership and boundaries

Routine authoring is Anto-owned. In-page Edit writes the same files the site renders; there is no separate `/admin` CMS.

The content surface is:

- `src/content/**` — JSON documents;
- `media/**` — source media managed by authoring and the reachable-asset build.

Everything outside those paths is engine, except for the narrowly scoped colour-token publisher described below. Agents never stage routine content in a feature commit. The only mixed commit is an explicitly requested schema migration coupled to the engine that consumes it; use `commit:engine --schema-migration` with explicit paths and deliver it through a PR.

## In-page Edit flow

1. `DevModeController` adds `is-dev-mode` to `<html>` and exposes edit controls.
2. Editing happens in the browser DOM. Text becomes `contenteditable`; media, grid, caption, and crop controls preview changes live. `data-dev-*` attributes map DOM nodes to JSON paths such as `sections[12].paragraphs`.
3. `DevTextEditor.astro` tracks pending text, spacing, section, and media changes. Most tuners queue work through `vcd:dev-pending-upsert` until Save.
4. **Save** posts to dev-only API routes registered through `astro.config.mjs`, including `/api/content-text`, `/api/content-spacing`, `/api/content-batch`, and `/api/content-section`. Their handlers patch the JSON on disk through `writeDevDocument()` in `scripts/dev-api-plugins.mjs`.
5. `vcd:dev-pending-committed` tells tuners that their pending state reached disk. Reloading before Save discards any edits that exist only in browser state.

Image uploads and inserted media sections are the important exception: the upload writes `media/**` and `/api/content-section` patches JSON immediately so the new section can mount in place. `persistedMediaInserts` keeps that already-written insert reversible and includes it in the next Save manifest. Asset deletion and some project-cover writes likewise go straight to disk and dispatch `vcd:dev-content-written` so publish state refreshes. Do not assume every item labelled “unsaved” is DOM-only.

### Calm HMR and stale transforms

`contentHmrGate` in `scripts/content-hmr-gate.mjs` drops every Vite `full-reload` WebSocket message and skips hot updates for `src/content/projects/**`, `src/content/pages/**`, and repo-root `media/**`. Other content paths are not covered by that matcher. Component and CSS edits still HMR through normal `update` messages. `suppressContentHmr()` also skips module invalidation briefly for writes whose live preview already matches, including colour-token saves. Save persists state; it is not a reload signal.

Because full reloads are blocked, Vite can keep a stale transform after a Git pull, branch switch, or same-branch merge. A hard browser reload may still serve old component CSS. The tell is a partial update, such as new markup with one old `<style>` block.

On the primary `main` checkout, the branch-sync service fetches `origin/main` every minute. Updates remain deferred while any browser is in Edit mode. When `main` is behind its remote, Edit mode shows **Update available** alongside any Save/Publish actions. Saved, unpublished files and local commits do not hide it. With pending browser edits, the action becomes **Save & Update** and saves locally first; a failed or cancelled save stops the update. Neither action publishes content.

**Update** leaves Edit mode, releases the authoring lease, and wakes the existing sync service. The service preserves local files, replays local commits onto the fetched remote revision, restores the files, and completes dependency installation and the required server restart before reporting success. The browser reloads at the preserved scroll position only after that request succeeds. A Git conflict cancels the update and restores the previous revision and drafts; a recovery failure retains the backup and reports an error. Updates remain unavailable on feature branches or during an unresolved Git operation.

For Anto's primary session, its operator must restart after the Git ref moves; agents never restart that session. Before blaming source CSS, inspect the served transform:

```sh
curl -s "http://localhost:4321/src/components/Thing.astro?astro&type=style&index=0&lang.css" \
  | grep -o 'your-selector' \
  | wc -l
```

`index=0` is the first `<style>` block and `index=1` the next, such as `is:global`. Served CSS is one long line, so `grep -c` is misleading; count matches with `grep -o ... | wc -l`.

## Asset model

All authoring assets live under `media/`, regardless of project status. JSON stores normalized relative paths with no `draft:` prefix. Status changes never move files between draft and public folders.

The build derives publication from navigation-reachable output. Before collecting media, `scripts/public-site-output.mjs` follows rendered internal links from Home, including links in text and embedded pages. It removes unreachable HTML pages and their unused generated assets. The technical 404 page and pure redirect aliases to reachable pages or external destinations remain available; they do not make other pages public.

`scripts/collect-shipped-assets.mjs` then scans the retained HTML, CSS, and JavaScript for `/images/...` references, generates requested derivatives, and copies only those assets from `media/` into `dist/images/`. Draft and unlinked Public case-study media does not ship unless a retained output file also uses it. A teaser's public gallery card can publish its cover without shipping the unreleased project body. Missing source media fails the build instead of creating a silent production 404. Local uploads and Save alone do not make an image public.

## Save and publish lifecycle

- **Pending:** usually browser DOM or a tuner queue; inserted media can already be on disk while remaining reversible in the Save bar.
- **Saved:** the Save bar has cleared pending state and the relevant content JSON/media is on disk; it survives reload but is not committed.
- **Published:** the app has committed the content surface to `main` and pushed it; Cloudflare deploys shortly afterward.

There is no general content auto-save; only the direct-write exceptions above persist before Save.

- **Save** writes content to disk only.
- **Save & Publish** performs Save, then calls the dev-only content publisher. This is the only routine content path to `main`.

Content can publish while the checkout is on any branch. What gates publication is whether that branch changes content-rendering code:

- no rendering changes: publishing proceeds;
- rendering changes: the bar shows an amber warning naming the files, reduces the Publish action's emphasis, and requires Anto to confirm the override.

The gate is deliberately branch-level. There is no schema capable of proving that one content edit is compatible with `main`; `ProjectSections.astro` silently ignores an unknown field and returns `null` for an unknown section type. A per-field allowlist would fail open. `RENDERING_PATHS` in `scripts/dev-publish.mjs` therefore errs toward including any path that can change how JSON becomes pixels. A stale path list fails open too, so add every new content-rendering component or helper when it is introduced.

### Publisher internals

`GET /api/publish` reports the branch, `files`, `behind`, `canPublish`, `onPublishBranch`, `rendersContent`, `renderingFiles`, and `publishBranch`.

- `files` are local versions this checkout changed and can publish.
- `behind` means `main` has a newer version that this checkout did not edit. It is shown as branch context, never offered for publication, because doing so would revert someone else's work.

`POST /api/publish` accepts the Save bar's semantic change `manifest` and an optional confirmed `force` override.

- On `main`, it refuses any staged engine file, stages only `src/content/**` and `media/**`, commits, and pushes.
- Off `main`, it fetches `origin/main`, seeds a scratch index from that tree, swaps in only the changed content blobs, creates a commit on top of `origin/main`, and pushes the bare commit SHA to `main`. It never stages or moves the current checkout, index, or branch.
- It refuses if `main` contains a newer edit to a file being published that did not come from this checkout. It also relies on the push itself being rejected if `main` moves after the fetch.

Publishing off-branch intentionally leaves that branch behind `main`; the branch resolves this when it later merges or rebases. The checkout-local Git record `vcd-last-publish.json` stores `path -> blob SHA` so a second publish can distinguish this checkout's prior publication from a foreign edit. It is never committed.

Commit subjects come from local Ollama model `gemma3:4b` using the semantic manifest rather than a noisy JSON diff. If Ollama is unavailable, missing the model, or slow, a deterministic subject is used; subject generation must never block publication. `gemma3:1b` was rejected because it hallucinated page names. Do not change the model without re-benchmarking.

After any change to content-publish plumbing, run:

```sh
$HOME/.bun/bin/bun run test:publish
```

## Colour-token Save and Publish styles

Colour-token editing on `/styles` is the only app-mediated engine exception. The editable source is `tokens/design-tokens.json`; saving regenerates `src/styles/global.css`.

**Save** writes both files and commits only those token paths on the current branch so disk, `HEAD`, and the publish status agree. On a non-main branch, **Publish styles** then sends only those two files to `main` with the same scratch-index and stale-file protections as content publishing, without switching the checkout or staging unrelated engine work. This stays separate from **Save & Publish**, which is content-only.

**Known main-branch limitation:** Save has already committed the token files, but `publishStylesInPlace()` currently looks for a staged change and reports “No style changes to publish” instead of pushing that commit. Do not claim a main-branch style edit is published until remote `main` actually contains it. Fixing that publisher is separate engine work.

The dev server must be restarted by its operator to mount newly pulled style-token or commit middleware. Agents do not restart Anto's primary session.

## Project documents and routes

Modern projects live in `src/content/projects/{slug}.json`, use `stack: "modern"`, and render through `src/pages/[slug].astro`. Documents contain `sections`, `outline`, `listings`, and `status`.

The production-gallery column below assumes the document has a `listings[grid]` entry for a gallery reachable from Home; status alone does not create a card. A Public page ships only when visitors can reach it through rendered internal navigation, including ordinary text links. Disconnected groups of pages do not publish each other. Dev mode also exposes Draft cards for authoring.

| Status | Production gallery | Production `/slug` | Dev `/slug` |
| --- | --- | --- | --- |
| `published` (UI: **Public**) | Visible and linked | Only when navigation-reachable | Yes |
| `teaser` | Visible but unlinked, with teaser treatment | No | Yes |
| `draft` | Hidden | No | Yes |
| `image` | Visible as a gallery-only image card | No | No |

Dev mode can create and author Public, Teaser, and Draft slugs without a server restart. `[slug].astro` prerenders only in production, and the create/settings/rename APIs send `astro:content-changed` to clear the dev route cache. `image` deliberately has no project route.

Home, Work, and Play listing cards come from each project's `listings`. Dev-mode grid management is handled by `DevProjectGridEditor.astro`, including New page and project settings.

## Key implementation files

- `src/components/DevTextEditor.astro` — text/spacing Save bar, section changes, pending media batches, content/style publish UI
- `src/components/DevModeController.astro` — dev-mode lifecycle
- `src/components/project/ProjectImage*Tuner.astro` — crop, grid, carousel, and caption pending edits
- `src/lib/projects.ts` — project visibility, grid listings, and build-route rules
- `src/pages/[slug].astro` — modern project route
- `astro.config.mjs` — registration for dev-only writers and colour-token generation
- `scripts/dev-api-plugins.mjs` — document reads/writes and project authoring APIs
- `scripts/dev-publish.mjs` — content status, branch gate, scratch-index publisher, and revert
- `scripts/dev-commit-engine.mjs` — colour-token commit and Publish styles
- `scripts/content-hmr-gate.mjs` — calm HMR and suppression window
- `scripts/collect-shipped-assets.mjs` — reachable-asset collection into `dist/images`
- `scripts/public-site-output.mjs` — navigation reachability and removal of unlinked production pages/generated assets

## Text save caveat

Body-text fields read `<p>` children first. If the browser places typed text outside `<p>` after a field is cleared, `readParagraphsValue` also reads other block children and inline field content at Save time. It does not rewrite the DOM while the user types.
