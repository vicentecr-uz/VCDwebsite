# 0003. Calm dev HMR

Status: Accepted (2026-11-22, recorded from code comments)

## Context

Vite and Astro default to "when in doubt, full-reload". In this site a full reload drops Edit mode (`is-dev-mode`) and the save bar, and branch sync or a Save can write files at any moment, so the default reloads pages out from under someone mid-edit.

## Decision

- Full browser reloads are manual. `contentHmrGate` drops every `full-reload` WebSocket payload, skips hot-update for content JSON and media (they are read outside the module graph), and still lets ordinary HMR `update` through for `.astro`, CSS and TS. Server restarts (config or `package.json` changes) restart the process and are unaffected.
- Vite's reconnect path calls `location.reload()` directly, bypassing the WebSocket filter, so the client is rewritten to dispatch `vcd:dev-reconnect` instead.
- The watcher ignores content and media entirely, and agent worktrees nested under `.claude/worktrees/` (their config files would otherwise restart the primary server); the ignore is anchored to this root so a worktree's own server still watches itself. `MEDIA_ROOT` is anchored to the repo root so `node_modules/**/media/` never matches.
- Every client dependency is listed in `optimizeDeps`. A dependency discovered on first load makes Vite re-optimise and send a full reload, which the gate drops, leaving the tab on stale dep URLs until its next navigation 504s under a stuck veil.
- After writes whose result the editor already shows (colour-token Saves to `global.css`), `suppressContentHmr` skips HMR invalidation briefly. Writers leave unchanged files alone so a save that changes nothing does not reload (`videoPageMaxHeight.json`).
- Staged edits are written in one batch per document (`contentBatchDevWriter`) so an HMR update from the first write cannot wipe later ones.
- HTML is served `no-store` from a pre-middleware so Back after Create is a real GET rather than a bfcache copy of the old Home (seen in Zen/Firefox). It must be a pre-middleware because Vite ends the HTML response itself.
- New project routes: static output makes `prerender = false` a no-op in dev, so a new slug is routable only once Astro's `getStaticPaths` RouteCache is cleared. The create/settings/rename APIs call `invalidateAstroRouteCache`, and `projectRouteWatcher` watches the projects folder itself (Vite ignores it) to bust the cache when a file appears or disappears another way (an agent, a pull, a content Update).

## Consequences

New content needs a manual refresh. That is the intended trade.

## Where

`scripts/content-hmr-gate.mjs` → `contentHmrGate`, `suppressContentHmr`, `MEDIA_ROOT`; `astro.config.mjs` → `optimizeDeps`, `server.watch.ignored`, `contentBatchDevWriter`, `styleTokenDevWriter`; `scripts/dev-api-plugins.mjs` → `invalidateAstroRouteCache`, `projectRouteWatcher`; `src/pages/[slug].astro` → `prerender`
