# Repo history snapshot — 2026-08-04

Commit-history analysis run on 2026-08-04, covering the full repo from initial commit to that point.

**299 commits, 22 active days, 126 calendar days (31 Mar → 4 Aug 2026).**
Authors: Vicente Cruz 283, Claude 17, Cursor Agent 3. 19 merge commits, 15 named feature branches.

## Phases

**1. Foundation — 31 Mar (11 commits, 8h)**
Astro + Bun + Tailwind scaffold, header sticky positioning, fluid `padding-inline` max-width, About rebuilt against the Webflow reference. Two Claude PRs (header, deployment research). Site skeleton exists by end of day.

**2. Dormant — 19 Apr to 6 Jun (25 commits across 6 scattered days)**
Roadmap scoping, then 18 May (8 commits): hover nav header, Tapico/Rams/Conic/ParentPal rebuilt for Webflow parity. 30 May (7 commits): nav rebuilt as content-driven, Decap block sections, project routes moved to root. 6 Jun: `dev-session` script + all project pages migrated to a data-driven `ProjectSections` renderer. Slow period, but the content model was seeded here.

**3. CMS + deploy — 28 Jun (20 commits, 16:26 → 23:48)**
Swapped Decap for Sveltia with PKCE, hit a white screen, fixed with `is:inline`, moved auth to a Cloudflare Worker proxy — then restored Decap locally same night. Net result is the dual setup still in use (Decap local / Sveltia prod). Also: style guide component catalog, wordmark per-letter blur hover.

**4. The dev editor sprint — 17 Jul to 27 Jul (147 commits, 9 active days)**
The project's real centre of mass.
1. **17 Jul** (29 commits) — crop tuner born, image grid, `ProjectBodyText` inline editing, spacing picker, Alt-D toggle, DevOverlay traffic lights
2. **20 Jul** (31 commits) — caption tuner, section insert/delete, press quote ticker, Reddit comment masonry board, Section Editor with outline ranges
3. **22 Jul** (41 commits, +10,775/−4,086) — core rebuild: unified `src/content/projects`, dynamic routes, project CRUD, draft-image auto-publish. Three PRs merged in ~2 hours
4. **23 Jul** (42 commits, 01:01 → 23:55) — drag-and-drop section reorder, refined seven times over the day
5. **25 Jul** (15 commits) — `--space-unit` token, mobile header scaling, `--color-bg` unification

**5. Carousel + assets — 3 Aug (50 commits, 15:45 → 4 Aug 00:29)**
Highest single-day commit count in the repo. Placeholder drag-to-fill, header logo cap-line sizing, then the full image carousel block from scratch: settings tuner, dot placement, per-image height caps, scroll-linked caption crossfades, iOS snap fix. Cursor-built asset manager merged at 00:21.

## Most impactful days (by churn + downstream effect)

| Day | Commits | Churn | Why |
|---|---|---|---|
| 22 Jul | 41 | +10,775/−4,086 | Content model rebuild — everything downstream depends on it |
| 23 Jul | 42 | +9,117/−4,040 | Drag-and-drop reorder, 23-hour span |
| 3 Aug | 50 | +7,549/−1,943 | Carousel block start-to-finish in one sitting |
| 20 Jul | 31 | +8,750/−1,822 | Ticker, Reddit board, Section Editor |
| 17 Jul | 29 | +8,266/−1,008 | Dev mode itself came into existence |

22 July stands out as the single most consequential day — highest churn, most deletions, and the one change every later feature depended on.

## Longest-running work

1. **Header / wordmark** — 6 separate sessions over 4 months (31 Mar, 18 May, 30 May, 28 Jun, 25 Jul, 3 Aug). Kerning, hover blur, cap-line alignment, mobile scaling — always a return visit, never one push.
2. **Section drag-and-drop reorder** — 28 commits, 6 calendar days (22–27 Jul), 7 PRs. FLIP snapping, scroll anchoring, drop indicator matching, elastic settle, interruptible drops. Most re-worked feature in the repo.
3. **Image crop tuner** — 17–24 Jul, evolved through aspect ratios, freeform frames, width/height constrain, source-anchored crops, then a full on-page pan/zoom surface.
4. **Image carousel** — ~33 commits in one 7-hour sitting (3 Aug). Fastest large feature — idea to merged PR same day.
5. **Tapico content** — touched on nearly every active day since 18 May. Not a feature so much as the thing every feature was built to serve.

## Dead ends

- **Employer views** — lived 4.5 hours on 22 Jul (added 14:21, removed 19:00)
- **Sveltia vs Decap** — flip-flopped twice on 28 Jun before settling on dev-Decap/prod-Sveltia
- **Keyboard grab** for section reorder — built and dropped same night (23 Jul, 01:48)

All three were cheap to kill — isolated changes, clean single-commit reverts.
