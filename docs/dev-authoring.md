# Dev authoring and publishing

This documents local in-page Edit, the content/media model, project visibility, and the app-mediated publishers. Root [`AGENTS.md`](../AGENTS.md) decides who may use each delivery lane.

## Ownership and boundaries

The owner controls routine authoring. In-page Edit writes the same files the site renders; there is no separate `/admin` CMS.

The content surface is:

- `src/content/**` — JSON documents;
- `media/**` — source media managed by authoring and the reachable-asset build.

Everything outside those paths is engine, except for the narrowly scoped colour-token publisher described below. Content paths belong to the private content repository and are never staged in a public engine feature commit. The engine repository carries the renderer and fixtures; the private content repository carries authored JSON and media. Schema changes use coordinated engine and private-content branches/PRs with an expand → migrate → contract sequence: make the renderer accept the new shape, migrate private documents, then remove compatibility only after the private content build and checks pass. The current content schema is version 1.

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

On the primary `main` checkout, the branch-sync service fetches the engine repository's `origin/main` every minute. The private content repository is kept alongside it through `.content.git`; Update coordinates both repositories and preserves local content edits before installing dependencies and restarting the session. Updates remain deferred while any browser is in Edit mode. When `main` is behind its remote, Edit mode shows **Update available** alongside any Save/Publish actions. Saved, unpublished files and local commits do not hide it. With pending browser edits, the action becomes **Save & Update** and saves locally first; a failed or cancelled save stops the update. Neither action publishes content.

**Update** leaves Edit mode, releases the authoring lease, and wakes the existing sync service. The service preserves local files, replays local commits onto the fetched remote revision, restores the files, and completes dependency installation and the required server restart before reporting success. The browser reloads at the preserved scroll position only after that request succeeds. A Git conflict cancels the update and restores the previous revision and drafts; a recovery failure retains the backup and reports an error. Updates remain unavailable on feature branches or during an unresolved Git operation.

For the owner's primary session, its operator must restart after the Git ref moves; agents never restart that session. Before blaming source CSS, inspect the served transform:

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
- **Published:** the app has committed the content surface to the private content repository's `main` and pushed it; Cloudflare deploys shortly afterward.

There is no general content auto-save; only the direct-write exceptions above persist before Save.

- **Save** writes content to disk only.
- **Save & Publish** performs Save, then calls the dev-only content publisher. This is the only routine content path to the private repository's `main`.

Content can publish while the checkout is on any branch. What gates publication is whether that branch changes content-rendering code:

- no rendering changes: publishing proceeds;
- rendering changes: the bar shows an amber warning naming the files, reduces the Publish action's emphasis, and requires the owner to confirm the override.

The gate is deliberately branch-level. The schema rejects unknown sections and unsupported `schemaVersion` values, but it cannot prove compatibility with a renderer that has not yet merged. A per-field allowlist would fail open. `RENDERING_PATHS` in `scripts/dev-publish.mjs` therefore errs toward including any path that can change how JSON becomes pixels. A stale path list fails open too, so add every new content-rendering component or helper when it is introduced.

### Publisher internals

In the current architecture, `.content.git` tracks the separate private content repository in the same working directory. It must be on `main` to publish; content commits and pushes target that private repository only. The engine rendering gate still checks the engine repository. Review worktrees use copied fixture or private content without `.content.git`; local edits are possible, but publishing is disabled. A private-content push triggers the content deployment workflow, which asks Cloudflare Pages to rebuild the engine with that content.

`GET /api/publish` reports the branch, `files`, `behind`, `canPublish`, `onPublishBranch`, `rendersContent`, `renderingFiles`, and `publishBranch`.

- `files` are local versions this checkout changed and can publish.
- `behind` means `main` has a newer version that this checkout did not edit. It is shown as branch context, never offered for publication, because doing so would revert someone else's work.

`POST /api/publish` accepts the Save bar's semantic change `manifest` and an optional confirmed `force` override.

When `.content.git` is absent, the following legacy single-repository behavior remains for compatibility. Never use it to commit private content into this public engine repository:

- On `main`, it refuses any staged engine file, stages only `src/content/**` and `media/**`, commits, and pushes.
- Off `main`, it fetches `origin/main`, seeds a scratch index from that tree, swaps in only the changed content blobs, creates a commit on top of `origin/main`, and pushes the bare commit SHA to `main`. It never stages or moves the current checkout, index, or branch.
- It refuses if `main` contains a newer edit to a file being published that did not come from this checkout. It also relies on the push itself being rejected if `main` moves after the fetch.

Publishing off-branch intentionally leaves that branch behind `main`; the branch resolves this when it later merges or rebases. The checkout-local Git record `vcd-last-publish.json` stores `path -> blob SHA` so a second publish can distinguish this checkout's prior publication from a foreign edit. It is never committed.

Commit subjects are generated by an on-demand worker through a configured SSH helper. It receives the semantic change manifest and up to 24,000 characters of the exact staged content diff (binary media is not uploaded). The worker uses `gpt-6-luna` through its existing ChatGPT login, with MiniMax as fallback. SSH or provider failures, invalid output, and the 20-second deadline all retain the deterministic subject so publication can proceed.

Automatic image descriptions use the same worker with the verified public image resized to a JPEG of at most 768 × 768 pixels. Luna handles vision; MiniMax-M3 is the fallback. Existing public-source matching, cache, review and save guards still apply. A failed worker request leaves the description marked failed for retry or manual entry. Neither task loads repository guidance, agent tools, conversation history, or a persistent model.

The private worker helper is not part of this public engine repository. Configure the SSH helper with noninteractive access to the worker host; keep its deployment path, interpreter/runtime details, and credentials in the private operations environment. Run the subject and image smoke checks before retiring a provider or runtime.

After any change to content-publish plumbing, run:

```sh
bun run test:publish
```

## Colour-token Save and Publish styles

Colour-token editing on `/styles` is the only app-mediated engine exception. The editable source is `tokens/design-tokens.json`; saving regenerates `src/styles/global.css`.

**Save** writes both files and commits only those token paths on the current branch so disk, `HEAD`, and the publish status agree. On a non-main branch, **Publish styles** then sends only those two files to `main` with the same scratch-index and stale-file protections as content publishing, without switching the checkout or staging unrelated engine work. This stays separate from **Save & Publish**, which is content-only.

On `main`, **Publish styles** pushes the saved token commit (and any newly saved token files) after checking that every unpublished commit contains only the two style-token paths. If the remote `main` moved, update this checkout first. If local unpublished history contains another engine path, resolve those commits and return to a styles-only `main` before publishing. A failed push can be retried from the saved local commit.

The dev server must be restarted by its operator to mount newly pulled style-token or commit middleware. Agents do not restart the owner's primary session.

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

### Pretty referral links and reserved project slugs

These links all go to the homepage with `utm_medium=social&utm_campaign=profile`. Umami reports the `utm_source` value in UTM / Campaigns; same-site redirects do not appear as Referrers.

| Link | Source |
| --- | --- |
| [https://vicentecr.uz/linkedin](https://vicentecr.uz/linkedin) | `linkedin` |
| [https://vicentecr.uz/ig](https://vicentecr.uz/ig) | `instagram` |
| [https://vicentecr.uz/instagram](https://vicentecr.uz/instagram) (alias) | `instagram` |
| [https://vicentecr.uz/x](https://vicentecr.uz/x) | `x` |
| [https://vicentecr.uz/threads](https://vicentecr.uz/threads) | `threads` |
| [https://vicentecr.uz/yc](https://vicentecr.uz/yc) | `ycombinator` |

Both trailing-slash variants are reserved for each referral link, so these slugs cannot be used for project pages. Other existing page and project routes remain unavailable: New page and rename already reject an existing `src/pages/{slug}.astro` file or project JSON. The source of truth is `public/_redirects` plus the fallback pages in `src/pages`; update this table whenever a referral is added, renamed, or removed.

## Analytics opt-out page

`/analytics` is an owner-only tool used to exclude the owner's own browsers from Umami by setting `localStorage['umami.disabled']`, so testing visits do not count in the stats. It is not for public visitors: do not link it from navigation, menus, the footer, or any content, and do not list it in a sitemap. `src/components/Analytics.astro` marks it `noindex,nofollow` and skips tracking on it.

Production output prunes pages that no link reaches, so `UNLINKED_ROUTES` in `scripts/public-site-output.mjs` keeps it shipping. Keep it unlinked; never add a public link to make it reachable.

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
