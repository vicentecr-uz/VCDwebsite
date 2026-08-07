# Remaining gallery work — handoff to Cursor

**Written:** 2026-08-07, after #174/#175/#176/#182 shipped. `main` is at `aeb55e1`.
**Audience:** a Cursor session acting as **manager** in the manager/worker split.

---

## What is already done

| Issue | State |
| --- | --- |
| #174 chips reveal on hover only | ✅ merged (PR #180) |
| #175 hover/cover swap chip | ✅ merged (PR #180) |
| #176 drop onto a placeholder cover | ✅ merged (PR #180) |
| #182 hover-cover title legibility | ✅ merged (PR #186) |
| #168 second dev mode | ⏸ deliberately untouched — needs design thinking first, see the issue comment |
| #172 runtime adaptive contrast | ⏸ deferred to v2 |

Also landed on PR #186, beyond #182's scope: a **card-settings chip** (`⋮`, bottom-right, replaces the "Card settings" button that used to live inside the crop tuner), and **chip contrast that follows the hovered image** — the interim for #172.

## What is left, in order

1. **#171 — Play cards** → spec at `docs/handoffs/260807-play-card-parity.md`
2. **#167 — Gallery Manager card parity** → spec at `docs/handoffs/260807-gallery-manager-card-parity.md`

Both specs are builder-ready and were written after reading the code. **Do them in that order** — they touch the same files and #167's whole job is to mirror `ProjectGrid.astro`'s dev markup, so doing it first guarantees mirroring a version that no longer exists.

Lower priority, specced only as issues: **#185** (drop covers from the asset manager), **#181** (one interaction at a time).

---

## ⚠️ Read this before using those two specs

**They predate PR #186 and #180.** The approach and the traps still hold, but `ProjectGrid.astro` and `DevProjectGridEditor.astro` have changed materially since. Specifically:

- **Every line anchor in both specs is stale.** Re-locate by symbol name, not line number.
- `ProjectGrid.astro` now emits `--title-ink` / `--subtitle-ink` / `--title-ink-hover` / `--subtitle-ink-hover` / `--title-ink-on-page` / `--subtitle-ink-on-page` on `.project-grid__meta`, and title colours come from CSS, **not** inline `style="color"`. #167's `buildGridCard` has to reproduce that or new cards render uncoloured.
- Chip palettes are now tokens: `--chip-{ink,fill,ring,press}-on-{light,dark}`, selected per item and swapped on hover. #167's cloned cards inherit this for free **if** they carry `data-dev-dark` / `data-dev-hover-dark`.
- There is now a **third** chip rail, `.project-grid__chips--end-bottom` (the `⋮` card-settings chip). #167's parity list predates it.
- `listings.*.hoverDark` is a new field. It has to survive #171's and #167's changes — see the allowlist trap below.
- The hover image `<img>` now renders for **every editable card**, `hidden` when empty.

**Do not hand a worker a spec without telling it the anchors are stale.** That is the single most likely way this goes wrong.

---

## Traps worth carrying forward

These cost real time on the last two branches. Put them in every worker prompt.

1. **`listingCardForGrid` (`scripts/dev-api-plugins.mjs`) is an allowlist, not a merge.** It rebuilds each listing from a fixed key set, so any new field silently vanishes on the *second* save — the first save looks fine. Fields need a `previous.*` fallback (see how `hoverImage`, `variants`, `hoverDark` do it). Test by saving twice, not once.

2. **A new field has to be threaded through six places, not five.** Client payload → server allowlist → server GET → client `ensureLoaded` → `src/lib/projects.ts` (type + `toGridListing`) → **and the page mappers** (`src/pages/index.astro`, `work.astro`, `play.astro`), which build `ProjectGridItem` field-by-field. The page mappers were missed on #182 and produced a bug that looked exactly like "works before reload, reverts after".

3. **Astro `<script type="module">` is NOT bundled.** It stays inline and the browser resolves relative imports against the *page* URL, so the module 404s and never runs. Use a plain `<script>`. This silently disabled #182's whole measurement path.

4. **Astro scoped styles do not reach JS-created nodes.** Anything `buildGridCard` or `ensureSubtitleHost` creates has no `data-astro-cid-*`, so scoped rules miss it. That is why the chip rails, drop chrome, and now the title ink rules are `:global` / in the `is:global` block. Directly relevant to #167.

5. **Stale Vite transforms.** See the new note in `CLAUDE.md` → *In-page editor flow*. If a CSS change appears only partially, restart the session before debugging the CSS.

6. **Never let a fallback be silent.** #182's measurement fell back to a value identical to the correct-looking one, so a completely broken code path looked like it worked. Fallbacks in dev tooling should `console.warn`.

---

## Verification protocol

**Anto tests; agents do not self-verify in a browser.** Finish the work, hand him a numbered script with exact steps and exact expected results, and stop. A green `bun run build` proves compilation only — say so explicitly rather than reporting it as verification.

Every test script should start with whether a **dev-session restart** is needed: it is, if `scripts/*.mjs` changed (Vite mounts dev middleware only at server start). Otherwise a hard reload.

---

## Housekeeping

- The working tree has **untracked content**: `src/content/projects/test-card.json` (a scratch project from testing #176) and some Tapico / conic-collection draft media. `commit:engine` correctly refuses to stage those. Delete or publish them — they will otherwise render as a draft card in dev.
- `conic-collection.json` has unpublished content edits (a hover image + measured `hoverDark`). Publish from the save bar when ready.

---

## Running manager/worker in Cursor

Anto's first time with this split in Cursor. The convention is in `CLAUDE.md` → *Manager / worker split* and mirrored at `.cursor/rules/agent-delegation.mdc`. **Cursor worker default: Composer 2.5 Fast** (not Sonnet — that was Claude Code's mid-tier). Auto is fine too.

The shape that worked here:

1. **The expensive model is the manager.** It reads the code itself, diagnoses, writes the spec, and reviews the diff. It does **not** delegate exploration — a warm picture of the codebase is what makes the second and third diagnosis cheap.
2. **Delegate the typing, not the decisions.** The worker applies a change list.
3. **Always `git diff main...<branch>` before merging.** Worker reports are claims. On both branches here the report said "matches spec" and the diff had real defects — one silent-data-loss path, one CSS regression.
4. **Ask the worker to make its report auditable**: not "done", but "here is each claim the spec asked me to verify by reading, and what I actually found". Contradictions are the most valuable thing it can return.
5. **Spell out landmines every time** — workers inherit no context. Minimum: Bun is at `$HOME/.bun/bin/bun` and not on `PATH`; do **not** start a dev server (port 4321 is owned, so it cannot verify in-browser); commit only via `bun run commit:engine "msg" <explicit paths>`; never stage `src/content/**` or `public/images/**`.

**Cursor-specific:** it has no `Agent` tool with git-worktree isolation the way Claude Code does. Use Cursor's own background/parallel agents if available, or simply run the worker as a separate chat on a branch you cut yourself (`git switch -c feat/…`). The isolation matters less than the discipline: one branch per spec, manager reviews the diff, Anto tests.
