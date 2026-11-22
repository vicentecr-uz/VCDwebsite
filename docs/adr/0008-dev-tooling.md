# 0008. Dev tooling degrades cleanly

Status: Accepted (2026-11-22, recorded from code comments)

## Decision

**Lapse is optional.** It installs from a private registry that needs a machine-local token, so CI, cloud agents and fresh contributors cannot install it and it is an optional dependency. Astro bundles every `<script>` it finds (the `showDevTools` guard gates rendering, not bundling), so a missing package hard-fails `astro build` and puts an error overlay on every dev page. `stubLapseWhenUnavailable` therefore always stubs it in production builds (which also drops an ~800 KB orphan chunk) and stubs it in dev only when the package is absent. The stub exports the same shape `lapseDev.ts` imports so the never-rendered script is inert. `scripts/test/inspector-hoist-contract.test.ts` fails if a Lapse or Agentation update renames the internals `src/lib/canvasChrome.ts` relies on to float their bars above the canvas.

**Inspector bars float above the canvas.** `canvasChrome.ts` hoists the Lapse and Agentation chrome out of the device frame into the shell. Nodes React creates inside hoisted chrome belong to the shell's realm and hoisted nodes to the frame's, so each window's DOM classes accept the other's instances while hoisted. Inspector viewport reads are recognised by package function names; a rename fails safe to the real viewport (issue #279 tracks a sturdier integration). Base UI's React-owned portals are moved only while open, since React removes them from `body` on unmount. Lapse is imported from `@aiforui/lapse/panel`, not the React entry, because the project has no React peer for it; its panel is hidden rather than unmounted, because unmounting resets speed to 1× and drops the take.

**LAN access.** The dev server binds `0.0.0.0` through Astro's top-level `server.host` (Vite's alone is not enough) with `allowedHosts: true`, so phones on the LAN can reach it. `dev-session.sh` also passes `--host`, so a bare restart still binds if the config is temporarily broken.

**Review previews** (`dev-worktree-preview.sh`) run detached so they survive the agent that started them; they never touch port 4321.

**Issue filing from the page** (`dev-issue.mjs`) reads labels from GitHub on each load rather than a hardcoded list, splitting only "page" labels from the rest for the form's two menus. Attachments are committed to the orphan `issue-assets` branch through a scratch `GIT_INDEX_FILE`; the real index is never touched (never run `read-tree` without the scratch index).

**Debug recorder** (`dev-debug-record.mjs`, client in `src/lib/debugRecord.ts`): `/dev/record/on?to=/page&topic=slug` sets the `vcd-record` cookie, `/dev/record/off` clears it, and `POST /api/dev-record` appends a batch to `.debug-records/<topic>.jsonl`, so a bug that reproduces only in the owner's browser reaches an agent without console work. The production boundary replaces `debugRecord` with a no-op; calls are temporary and are removed before committing.

**Panel measurement** (`scripts/dev-measure.ts`) is browser-only and served by path: `(await import('/scripts/dev-measure.ts')).report(selector)`. Insets run from the panel's inner border edge to painted boxes and to text; `box` measures text at its line boxes (what padding sets), `ink` from cap line to baseline (as `docs/interface/spacing.md` measures gaps).

**Remote editor.** Public pages may finish loading `/_astro/` assets after the login cookie changes, so those stay reachable.

**Tests run in Happy DOM.** Where it differs from browsers the tests patch around it, never the product: dispatch goes through the public `composedPath()`, `::slotted` cannot be parsed, and media setters emit no `volumechange`. The dev-chrome source scanners are regex-level by design; each guard test includes a "catches a sample" case so a scanner regression shows.

## Where

`astro.config.mjs` → `stubLapseWhenUnavailable`, `server`; `scripts/dev-session.sh`; `scripts/dev-worktree-preview.sh`; `scripts/dev-issue.mjs` → `listMeta`, `pushIssueAssets`; `scripts/dev-debug-record.mjs`; `scripts/dev-measure.ts`; `scripts/remote-editor-server.mjs`; `scripts/test/lib/devChromeSource.ts`; `src/lib/canvasChrome.ts`; `src/lib/lapseDev.ts`; `src/lib/debugRecord.ts`
