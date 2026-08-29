# VCDwebsite — Codex Instructions

> This file is the single source of truth for project context. All memory is kept here, in the repo.

> **You are not the only agent working in this repo.** Cursor agents work here too, and they do **not** read `AGENTS.md` — they read `.cursor/rules/*.mdc`. Claude Code agents read `CLAUDE.md`. Atlas `standards.md` is canonical for cross-project standards, and every standard there lists its **Surfaces**.
>
> So: **when you change a convention, update every surface it names, not just the file you happened to be editing.** For agent workflow that means Atlas `standards.md`, `CLAUDE.md`, this file, and `.cursor/rules/agent-delegation.mdc`. A rule written in one place is a rule the next agent silently won't follow, and Anto ends up re-explaining it by hand. Docs/standards commits get their own branch straight to `main` (see below) — never bundled into feature work.

## Project
Astro + Bun + Tailwind CSS v4 + GSAP portfolio site for Vicente Cruz (industrial designer, London). Rebuilding vcruzdesigns.com as an independent site.

Vicente Cruz is a UAL: CSM graduate, currently Junior Industrial Designer at Kingfisher. He references the live Webflow site frequently for design decisions and has a strong design eye — precise aesthetic calls on font weight, letter spacing, spacing systems, and transitions.

## Key conventions
- **Git branches:** New features and fixes start on a **new branch off latest `main`** (`git switch -c feat/…`). **Do not implement on `main`** unless Anto explicitly says to. Branch before the first edit — do not wait to be told. **Put Anto on the right checkout** for this chat’s work (including before a QA test script) — do not leave “checkout `feat/…`” as homework; prefer zero Terminal for him, and if a paste is unavoidable give the exact command plus one line on what it does. After a PR merges, switch back to `main` and **delete the feature branch** (remote + local) so old branches do not pile up — see `.cursor/rules/git-workflow.mdc` and Atlas `standards.md` → *Git — Delete merged feature branches* / *Git — VCDwebsite feature branches*.
- Spacing unit: `var(--space-unit)` consistently across header, grid, footer, gaps — `1rem` at every breakpoint, stepping down to `0.75rem` below `40em` (phones). Defined in `global.css`; use it rather than a literal `1em`. Use inline `style=` not Tailwind arbitrary values for guaranteed rendering
- Mobile breakpoint: `40em` (640px) — where `--space-unit` tightens and the header (wordmark, menu links, logo) steps down via `--header-wordmark-size` / `--header-menu-link-size` / `--header-logo-size`
- Font: Hanken Grotesk (Google Fonts, weights 300–900)
- Background: `--color-bg` (`#ffffff`). Every surface meant to read as "the page" — page background, header background (`.site-header__bg`), nav menu panel background and its menu backdrop — must reference this one token, never a literal white. They are stacked and expected to blend seamlessly, so when dark mode lands they have to move together.
- **Viewport height units:** Never use raw `svh` (or `vh`) for a height constraint that matters visually — Microsoft Edge on iOS doesn't reliably honor `svh`, letting it track the address bar's show/hide mid-scroll and shove blocks below it up/down (see issue #96). Use the shared helper `src/lib/safeVh.ts` (`bindSafeVh()` in `Layout.astro`), which sets a JS-computed `--vh-safe` custom property once on load and only recomputes it on a genuine width change (never on the height-only resize an iOS toolbar toggle fires). Keep `svh` only as the pre-JS/no-JS fallback: `calc(var(--vh-safe, 1svh) * N)`. Do not re-implement this per component.
- **Light/dark variants are named for the ground, not the ink:** `on-dark` is the *white-icon* set, because it sits on a dark ground (Material's `onSurface` convention). The `dark` and `hoverDark` flags in listing JSON likewise describe the cover, not the text. Chip palettes live in `ProjectGrid.astro` as `--chip-{ink,fill,ring,press}-on-{light,dark}`; the ring is always a step **darker** than the fill it edges, on both grounds.
- **Gallery ink luma threshold (title/meta colour flip on covers):** one knob — `HOVER_LUMA_THRESHOLD` in `src/scripts/coverLuminance.ts`. Do not hunt in CSS or `ProjectGrid`. Higher = dark ink longer over mid-tones; lower = light ink sooner. Used by `adaptiveMediaInk` / `bindGalleryMediaInk`.
- **Dashed = editable (dev layer):** a dashed hairline is the one signal that says "you can edit this", and nothing else in the dev chrome may use one. Text fields carry it while `contenteditable`; media frames (gallery covers) fade one in while an image is dragged over them — **inset from the frame edge and rounded**, so it reads as the slot the image will land in rather than as the frame's own border. Solid rules and fills mean **state** — selected, lifted, span frame, dropping — not affordance. Use `--dev-edit-dash` / `--dev-edit-dash-color` from `global.css`, never a fresh `color-mix` (there are ~10 legacy hand-rolled values at 28–70%; converge them when you touch them, don't sweep). Respect `prefers-reduced-motion`.
- **Labels only — no explanatory copy on screen:** every surface here (the site and the dev layer alike) ships with **labels only**. A control names itself and stops; it has to read from how it looks and how it behaves, not from prose next to it. No sub-titles restating a heading, no helper text under a field or toggle, no "what this panel does" intro, no parenthetical hints, no tooltip added on your own initiative to explain a control. Still fine: the label; a unit shown inline (`px`, `%`) as part of the value; error text saying what broke and what to do; the site's actual editorial content (About, case studies) — this governs **chrome**, not copy; and **accessible names** (`aria-label`, `title` on icon-only controls), which are invisible to sighted users and required — never strip one to satisfy this. Put the explanation in a source comment, this file, or `docs/`. **The test:** if a control needs a sentence, the control is wrong — fix the label, grouping, or interaction instead of annotating it. **When Anto asks for tooltips or an onboarding pass, build them properly** — this bans explanation you volunteer, not explanation he commissions; don't hedge a requested help layer down to a bare label. Canonical: Atlas `standards.md` → *Design — Labels only in a UI*; also `.cursor/rules/coding-conventions.mdc`.
- **Appear / disappear motion:** Dev chrome should not pop. Standalone panels (`DevOverlay`) fade in with a slight rise (mirrored on exit). Covering veils over an existing surface fade only.
- **`prefers-reduced-motion` suppresses movement, not fades.** Reduced motion does **not** mean "no animation" — a fade keeps its easing, and only travel/resize is removed. The reference is iOS: with Reduce Motion on, app switching still animates, it just crossfades instead of sliding. Per property: `opacity` keeps its transition unchanged; a `translate`/rise drops the **offset** (set it to `0`), never the duration; `scale`, `width`/`height` and layout shifts get suppressed or crossfaded. Never put `transition: none` on a rule that only fades, and never zero a shared duration variable a fade also reads. **This applies to JS timing, which is where it hides** — a `prefersReducedMotion()` check returning a `0` duration, skipping the enter/exit class dance, or calling the "finish" path in the same frame makes the UI snap however correct the CSS is (three #205 bugs were exactly this: `chromeFadeMs()` in `DevModeController.astro`, and `DevOverlay.astro` setting `hidden` immediately). Grep script blocks, not just styles. Genuine movement keeps its override — the section-lift `scale(1.02)`, drop-indicator height, and crop-stage transforms.
- Bun path: `$HOME/.bun/bin/bun` (not on PATH)
- Dev server: port 4321
- **Dev session:** `bun run dev:session` starts Astro (port 4321) and **branch sync**; `dev:session:stop` / `dev:session:status`. One local session — reuse servers across chats (Cursor or Codex), don't start duplicates.
- **Branch sync (auto-pull):** While the dev session runs, a background poll (every 60s) pulls the **currently checked-out branch** from its upstream. Pull-only — no auto-commit or push; local dirty files survive via `--autostash` when a rebase is needed. Switching branches is picked up on the next poll. **Agents (Cursor and Codex): do not run `git pull` manually** when sync is running — check `bun run dev:session:status` or `bun run branch:sync:status`; use `bun run branch:sync:once` if you need an immediate pull. Manual: `branch:sync`, `branch:sync:stop`, `branch:sync:status`, `branch:sync:once`. Log: `.dev-session/branch-sync.log`. Cursor also has `.cursor/rules/dev-session.mdc`.
- **Local authoring:** In-page Edit (dev mode) writes content JSON on disk via the Save bar. No separate `/admin` CMS — Decap/Sveltia were removed.
- **Deployment:** Cloudflare Pages auto-deploys on every push to `main` — live at `wip.vcruzdesigns.com` within ~30s. No manual deploy step needed.
- Page transitions: GSAP fades `#transition-overlay` (starts opaque; fades out once viewport-visible images + fonts are ready, min 0.5s hold / max 4s wait; fades in on navigation). CSS 5s safety-net reveal if JS fails.
- Max page width: fluid gutter via `#site-wrapper { padding-inline: max(1em, calc((100% - 60em) / 2)) }` — gutter holds at 1em until viewport exceeds 62em, then grows to keep content at 60em max

## Dev authoring (local only)

Content edits go through the **in-page editor** (dev mode). It writes JSON under `src/content/` (and images under `public/images/`) via the Save bar — same files the site renders from.

### In-page editor flow

1. **Turn on dev mode** — `DevModeController` adds `is-dev-mode` to `<html>`; edit controls appear.
2. **Edit in the browser DOM** — text fields become `contenteditable`; image/grid/caption tuners preview changes live. Components carry `data-dev-*` attributes mapping DOM nodes to JSON paths (e.g. `sections[12].paragraphs` in `tapico.json`).
3. **Dirty / pending state** — `DevTextEditor.astro` tracks unsaved text, spacing, and media edits. Image tuners queue changes via `vcd:dev-pending-upsert` until Save.
4. **Save** — POST to dev-only API routes in `astro.config.mjs` (`/api/content-text`, `/api/content-spacing`, `/api/content-batch`, `/api/content-section`, etc.). Handlers call `writeDevDocument()` in `scripts/dev-api-plugins.mjs`, which patches the JSON file on disk.
5. **No flash on Save** — `contentHmrGate` (`scripts/content-hmr-gate.mjs`) drops all Vite `full-reload` WS messages in dev, and ignores `src/content/**` + `public/images/**` in the file watcher. Component/CSS edits still HMR via `update`. `suppressContentHmr()` additionally skips module invalidation for colour-token Saves (~2.5s) where the live preview already matches. Save only persists to disk. `vcd:dev-pending-committed` syncs client “saved” state in tuners. **Do not assume Save or branch sync triggers a page reload.**
6. **Reload without Save** — unsaved DOM edits are lost (warning shown if dirty).

**Stale transforms whenever the git ref moves under a running session.** Because the gate drops every `full-reload`, Vite can keep serving a **stale transform** of a component's style block after a `git pull`, `git switch`, or a merge landing on the checked-out branch — a hard reload does not clear it. The tell is a change appearing *partially* (one `<style>` block updates, another does not, or new markup appears with old CSS). This has recurred (2026-08-07) on a pull, a branch switch, and a same-branch merge — **restart the session after any of the three**, don't wait for a symptom. Verify what is actually served, not what is on disk, before concluding the CSS is wrong:

```bash
curl -s "http://localhost:4321/src/components/Thing.astro?astro&type=style&index=0&lang.css" | grep -o 'your-selector' | wc -l
```

`index=0` is the first `<style>`, `index=1` the next (e.g. `is:global`). Count with `grep -o … | wc -l` — served CSS is one long line, so `grep -c` always returns 1 and will mislead you.

### Lifecycle

- **Unsaved** = DOM only (what you see while editing)
- **Saved** = JSON on disk (survives reload)
- **Committed/pushed to `main`** = production deploy

No auto-save. **Save** never commits; **Save & Publish** does — see below.

### Save vs Save & Publish

The save bar has two buttons:

- **Save** — disk only, unchanged behaviour. Use when the edit should sit locally until it's committed by hand.
- **Save & Publish** — saves, then commits the content surface to `main` and pushes. Cloudflare deploys ~30s later.

Content always lands on `main`, but **you don't have to be standing there**. From a feature branch the commit is built against `main` and pushed; your checkout, your index, and your branch are untouched.

What gates Publish is whether the branch changes **content-rendering code**, not which branch you're on:

- No rendering changes → Publish works, from any branch.
- Rendering changes present → the bar shows an amber ⚠ naming the files, Publish steps down to an outline, and clicking it asks you to confirm before going ahead.

The reason for the gate: content and the engine that renders it are versioned separately, and only the engine travels through the branch. A content edit that depends on an unmerged feature breaks the live site **silently** — there's no schema, and `ProjectSections.astro` dispatches on `section.type` through an `if` chain ending in `return null`, so an unknown section type just vanishes and an unknown field is ignored.

The check is deliberately **branch-level**, not field-level. A per-field check (feature manifest, static analysis of `main`'s renderer) fails **open** — one unregistered field silently permits a breaking publish. This fails closed, and the override covers the false positives, because you know whether you just used a new toggle and the check can't. **Don't re-litigate this without a new reason.**

Implementation is `scripts/dev-publish.mjs` (`publishDevWriter()`, registered in `astro.config.mjs`):

- `RENDERING_PATHS` is the gate's path list. A stale list fails **open**, so err towards adding a path when you add a component.
- `GET /api/publish` → `{ branch, files, canPublish, onPublishBranch, rendersContent, renderingFiles }`; the save bar polls it on load and on dev-mode entry.
- `files` means **unpublished**, `behind` means **`main` moved and this branch hasn't picked it up**. Both differ from `main`; only the first is yours to publish. A file you haven't touched since you last published or branched is `behind` — offering to publish it would revert whatever landed on `main`. `behind` shows in the branch-label tooltip, not the change count.
- `.git/vcd-last-publish.json` records `path → blob sha` for everything this checkout has published. It's what lets the staleness guard tell **our own** last publish from a foreign one — without it, publishing twice from the same branch fails the second time, because `main` carries a commit the branch's merge base predates. Local, never committed.
- `POST /api/publish` (`{ manifest, force }`) → on `main`, stages **only** `src/content` + `public/images` and commits in place; it refuses if anything outside that surface is already staged. Off `main`, it builds the commit with plumbing against a scratch index (`read-tree` from `origin/main` → swap in content blobs → `commit-tree` → push the bare SHA), so nothing is ever staged in your checkout. It refuses if `main` has newer edits to the files being published **that didn't come from here**.
- **Publishing off-branch leaves your branch one commit behind `main` — that's the design, not a fault.** The commit lands on `main`; your branch never moves. It resolves when the branch merges or rebases.
- `bun run test:publish` exercises both paths against throwaway repos. **Run it after any change here** — the off-branch path is plumbing, and a subtle mistake shows up as a bad commit on `main`.
- The commit subject is written by a **local model** — `gemma3:4b` via Ollama on `localhost:11434` — given the save bar's **change manifest** (semantic counts like `3 crops`, `2 text fields`), not the JSON diff, which is mostly reordering noise. No API key, no cost, no network.
- Ollama runs as a login service (`brew services start ollama`, ~34MB idle). If it's down, missing the model, or slow, publishing still succeeds with a deterministic message built from the same manifest (`content: update tapico (5 changes)`). **Message generation must never block a publish.**
- `gemma3:1b` was tried and rejected — it hallucinated page names, which is disqualifying for text landing in git history unattended. Don't swap the model without re-benchmarking. Two things in `SYSTEM_PROMPT` are load-bearing at this model size: naming the banned verb forms explicitly, and **no few-shot example** (an example block makes it echo the manifest back verbatim). Field paths are deliberately kept out of the prompt — the model copies them into the subject instead of describing the edit.

### Content vs engine

`src/content/**` and `public/images/**` are the **content surface**. Everything else is **engine**.

- Content publishes to `main` from the save bar, from whatever branch you're on. Never stage it in a feature commit.
- Engine work goes on a feature branch. Commit it with:

 ```bash
 bun run commit:engine "your message" src/components/Thing.astro scripts/thing.mjs
 ```

 **Pass the paths you changed.** Agents: this is the required form — only list files you edited in this session. The script refuses content paths outright.

 The no-paths form (`bun run commit:engine "msg"`) sweeps *every* dirty engine file, which cannot distinguish your edits from another agent's in-flight work. It prints a warning when it does this. Use it only when you know the tree is otherwise clean.

- **Colour tokens on `/styles`:** edits stage as unsaved pending (like crops), **Save** writes `src/styles/global.css` and commits it on the current branch (`suppressContentHmr` skips CSS HMR so the save bar stays up), then **Publish styles** pushes that file to `main` from any branch — same scratch-index path as content, without folding CSS into Save & Publish (content-only). Vite only mounts the style-token / commit middleware when the dev server starts — after pulling this branch, restart the session (`dev:session:stop` / `dev:session`) or Save/Publish styles can 404 as HTML.

Exception: schema migrations that require touching content JSON alongside the code change — commit them together and say so in the message.

### Key files (agents: read these for editor bugs)

- `src/components/DevTextEditor.astro` — text/spacing save bar, section insert/delete, pending media batch
- `src/components/DevModeController.astro` — dev mode toggle
- `src/components/project/ProjectImage*Tuner.astro` — crop, grid, caption pending edits
- `scripts/dev-api-plugins.mjs` — `readDevDocument` / `writeDevDocument`, `suppressContentHmr` on every write
- `scripts/dev-publish.mjs` — `/api/publish` (branch gate, content-only staging, commit message generation)
- `scripts/content-hmr-gate.mjs` — calm HMR: always drops `full-reload` WS; skips hot-update for content/draft media; `suppressContentHmr` skips colour-token CSS invalidation after API writes

### Text save caveat

Body-text fields read `<p>` children first; if the browser puts typed text outside `<p>` (e.g. after clearing a field), `readParagraphsValue` also checks other block children and inline content in the field — **only at Save time**, without rewriting the DOM while typing.

## North star (not a build queue)

Long-horizon product intent — **View vs Edit**, online Edit with **full parity** to local Edit, **WYSIWYG** / hands-on in-page controls, eventual open-source + bring-your-own hosting — lives in [`docs/product-vision.md`](docs/product-vision.md). Do not treat it as current-sprint work.

## Scope
What belongs in this repo: work that is **the site itself** — IA, global layout, deploy, nav, and integration of other work (routes, embeds, links, how a tool sits inside vcruzdesigns.com). What does **not** belong here: tasks inside another repo's product (calculator logic, chart bugs, Stoozing HTML layout, AutoSpeedTest features) — those stay in that project's own notes. Gray line: if the issue is the site shell (iframe sizing, Astro page grid, site chrome breaking mobile), it's here; if it's Stoozing's own layout/CSS in `stoozing-playground.html`, it's Stoozing Playground.

Open tasks are tracked in [GitHub Issues](https://github.com/vcruzdesigns/VCDwebsite/issues).

**When opening a GitHub issue:** always assign a relevant label and milestone. If it's unclear which label or milestone applies, ask Anto before filing.

**When committing and pushing:** only stage and commit changes made within the current chat session. Do not bundle in unrelated unstaged changes from other sessions — leave those untouched for Anto to handle separately.

## Implementation notes

### Signed-off components
Use **only** components and patterns listed on `/styles` (Component library). When copying content from old project pages or Webflow, do not reach for legacy case-study markup in `src/components/project/legacy/`.

**Tapico** (`/tapico`) — case-study components (build each as a reusable primitive for future projects):
- `ProjectLayout`, `ProjectImage`, `ProjectImageGrid`, `ProjectBodyText`, `ProjectSectionTitle`
- `ProjectPressQuoteTicker`, `ProjectRedditCommentCarousel`

**Home / Work / Play** — `ProjectGrid` (`src/components/ProjectGrid.astro`):
- Cover-card listing grid; project cards from `listings` on each `src/content/projects/{slug}.json`
- Play also includes non-project links from `src/content/play/*.json`
- `variant`: `home` | `work` | `play` (breakpoint and featured-row presets)
- Dev mode: grid management via `DevProjectGrid` (+ New page, ⋯ settings) — see project `status` field

**Project pages** — dynamic route `src/pages/[slug].astro` for `stack: "modern"` projects:
- Content in `src/content/projects/{slug}.json` (`sections[]`, `outline`, `listings`, `status`)
- `status`: `published` (UI: **Public**) | `draft` | `teaser` — Public alone is built/served at `/slug` in production. Teaser shows an unclickable gallery card but **no** public route (same non-discovery as draft). Draft is edit-only (hidden on public galleries). Dev still routes all three for authoring.
- Draft images: `draft:{slug}/file.jpg` in JSON → `src/content/drafts/media/` (dev); auto-promoted to `public/images/` when project settings are saved as `published` or `teaser`
- Dev mode: drag-and-drop images (`DevImageDrop`), text/spacing editors, crop/grid tuners
- **New project slugs in dev:** `[slug].astro` uses `prerender = import.meta.env.PROD`, so `astro dev` on-demand-renders any Public/Teaser/Draft slug you create in the same session — no restart needed. **Image** status still has no `/slug` route. Checking out a branch that adds a slug may still need a session restart if the page module itself is stale.

**Legacy (do not copy):** `src/components/project/legacy/` holds Webflow-migration components (`LegacyProjectGrid`, `LegacyProjectProse`, etc.) used only by old routes. `LegacyProjectGrid` is case-study media clusters — not the same as site `ProjectGrid` listings.

**Button Base hitbox:** any interactive element built from Button Base (or its variants) needs a tappable/clickable area extending `space/hit-inset` (8px, Figma Primitives collection) beyond the element's visual bounds on all sides. This is documented on the component in Figma but deliberately **not modeled as Figma geometry** — Figma has no primitive for "sibling size = parent size + N," so a literal overlay frame would just go stale every time content changes. Implement it in code instead: `inset: -8px` on a `::before`/`::after` pseudo-element (recalculates live against the parent box), or an equivalently padded interactive wrapper. Don't hardcode `8px` — reference it as a token if/when `space/hit-inset` gets exported to CSS custom properties.

**Figma — build from components, not ad-hoc nodes:** when an agent creates or adjusts anything in a Figma file, compose it from the design system's existing components — elements → atom variants → atoms → particle components — rather than creating a plain node and hand-applying the right properties to it. A text sample in a mockup is an instance of the text-style particle component, not a `createText()` node styled by hand. If the needed component doesn't exist yet, create it properly first, or ask Anto if the right structure is unclear — don't substitute a raw node because it's faster right now. Building from components forces proper thinking and surfaces the components that need to exist before a mockup can be completed; it slows things down temporarily but over time produces a system that lets us one-shot things with much greater accuracy. A raw node that merely looks right hides the gap — building from instances surfaces the missing component immediately, which is the point. Canonical: Atlas `standards.md` → *Design System — Figma: build from components, not ad-hoc nodes*; also `CLAUDE.md` and `.cursor/rules/coding-conventions.mdc`.

**Figma links, not bare names:** when a response references a Figma node — a component, frame, or mockup — link it to that node's canonical URL (`https://www.figma.com/design/:fileKey?node-id=:id`, id as `123-456`), not just its name in prose. Applies in chat replies, PR descriptions, and rotation docs alike, and to every harness (Claude Code, Cursor, Codex) — not just this one. Reason: a bare name forces Anto to search Figma by hand for something the agent already had the exact node ID for; the link is one click. Canonical: Atlas `standards.md` → *Design System — Figma links, not bare names*; also `CLAUDE.md` and `.cursor/rules/coding-conventions.mdc`.

Ask before introducing anything not on `/styles`.

## Plans & implementation handoffs

When planning is done and a **fresh chat** should implement (often with a mid-tier model), write a **builder-ready** spec — not a loose diagnosis.

**Canonical shape:** Atlas `AGENT-GUIDE.md` → *Implementation handoff (builder-ready)*. Minimum sections:

| Section | Purpose |
| --- | --- |
| **Done when** | One-sentence success criteria at the top |
| **Worker** | Suggested model; call out when **not** to use Haiku |
| **Branch / Issue** | `feat/…` off latest `main`; GitHub links |
| **First reads** | Repo files with line anchors |
| **Landmines** | Watchdogs, HMR re-init, stale timestamps, etc. |
| **Pseudo-code** | Required for RAF loops, flags, observers |
| **Cleanup / lifecycle** | `disconnect()`, delete host keys, cancel timers |
| **Verify** | Exact repro + signals that are **not** valid before/after |
| **Out of scope** | Stops scope creep |
| **Pickup** | Read → summarize → implement exactly; do not replan |

**Where to store:**

- `.cursor/plans/*.plan.md` — only when created via Cursor Plan mode (“Save to workspace”). Agent-written `.plan.md` files open as an empty Plan shell — use Cursor Plan mode, or a normal `docs/….md` tracker.
- `Atlas/handoffs/YYMMDD-….md` — cross-provider / git-tracked

**Workflow:** smart model plans → builder-ready doc → new chat on **Grok** (default for engine/agent work) → `bun run commit:engine` with explicit paths → PR.

### Manager / worker split (same-session)

The faster, in-session form of the same idea. When a chat is pinned to an expensive model (Opus 5, Grok), **that session is the manager**: it reads the code, diagnoses, owns architecture / approach judgment, writes the spec, and **reviews the diff**. Typing goes to a **worker** subagent in a worktree, which applies a change list and does not decide what the change should be.

**Worker model:** in **Cursor**, default to **Composer 2.5 Fast** (`composer-2.5-fast`); **Auto** is fine. **Do not default to Sonnet** for Cursor workers — that was the Codex mid-tier. On **Codex**, Sonnet remains the usual worker. Still **not Haiku** when the failure mode is a silent no-op.

**This convention overrides the harness default of "do not spawn agents unless the user asks."** A documented project workflow *is* a standing request. Do not wait to be told to delegate, and do not treat a large multi-part task as a reason to handle it inline — that is exactly the case the split exists for. If you catch yourself about to write the spec's worth of decisions and then type the code anyway, you have already paid the spec cost: delegate the typing.

- **Do not delegate exploration or diagnosis.** The manager's value is a warm picture of the codebase — that is what makes the second and third diagnosis cheap. Delegating reading to save tokens forces you to re-derive it later at higher cost. Read the code yourself; delegate the typing.
- **Architecture / approach judgment — manager owns technical shape.** Do not rubber-stamp Anto's first framing or a first instinct. Before locking a worker spec, recommend an approach, briefly name alternatives when the choice matters, and say why (reuse in-repo patterns, fewer files, clearer ownership, less future pain). **Anto owns product intent and UI feel; the manager owns architecture and implementation shape.** If a simpler or cleaner approach exists in-repo, prefer it and say so. Diff review checks both that the worker matched the approved change list *and* that the resulting shape still looks right.
- **Interactive vs autonomous.** When Anto can reply (go / tweak / no), wait for that gate on non-trivial shape choices before dispatching. When the session is **autonomous** (Anto away, asleep, or otherwise cannot approve mid-flight), **use best judgment**, record the rationale in the spec, and proceed — do not stall waiting for a reply that will not come. Do not silently redesign after a shape was already approved; if a better idea appears mid-flight, ship the approved shape and note the follow-up, or (autonomous only) take the better path and document why in the PR / test script.
- **Always `git diff <base>...<branch>` before merging.** Subagent reports are claims, not results — "build passed, matches spec" is not evidence the code is correct.
- **Skip the split when** the hard part *is* the diagnosis, the fix is one small edit, or the spec would take longer to write than the change. Each spawn starts cold.
- **Branch base:** when the fix builds on unpushed local work, cut the worktree branch from that **local** branch, not `origin/main`, and have the worker confirm its parent commit before editing.
- **Spell out landmines** in every spec — worktree agents inherit no session context. At minimum: Bun is not on `PATH` (`$HOME/.bun/bin/bun`); **do not start a dev server** (one already owns port 4321, so the agent cannot verify in-browser — verification happens after merge); commit only via `commit:engine` with explicit paths; never stage content paths; name the files other parallel agents are touching as off-limits.
- **A green build is not evidence.** Worker reports say "build passed, matches spec" whether or not the code is right. For dev-tooling and UI work a build proves compilation only — correctness comes from the diff review plus Anto running it.
- **Anto is the verification step** — see *Verification* below. Hand him a numbered test script; don't self-verify in a browser.
- **Say which branch the checkout is on whenever it changes** — testing the wrong branch has cost a full round already.
- **Tear down the worktree once you've reviewed the diff.** A worktree holds its branch **exclusively**, so a leftover one makes `git switch <branch>` fail when Anto goes to QA — which is exactly when he needs it. The harness only auto-cleans an *unchanged* worktree, and a worker that committed is never unchanged. Sequence: review → push → `git worktree remove` → open the PR. **Before handing over a test script, `git worktree list` must show only the main checkout.** It also reclaims a full second copy of the repo plus `node_modules` and `dist`.
- **Never merge another branch into a feature branch just to test them together.** Use a throwaway integration branch, or merge to `main` once approved; separating it afterwards costs a reset and cherry-picks.
- **Docs / standards commits get their own branch** straight to `main` — never bundled into feature work.
- **Switch the manager's own model tier by phase, not for the whole session.** Model switching is mid-conversation and keeps context — `/model` in Codex, the per-message picker in Cursor — so there's no reason to run the expensive model through the cheap parts.
  - **Cheap tier:** talking with Anto, filing issues, writing PR descriptions, worktree cleanup — anything that doesn't need reading code to understand *why*.
  - **Switch up for one continuous block:** reading the code, diagnosing, writing the spec, dispatching the worker, and **reviewing the diff**. Don't let the review slip back to the cheap tier — it's the same warm context from the diagnosis that catches what a fresh read would miss. On the #201/#185/#197/#181 run, two of four review-caught defects depended on that continuity (a promotion rewrite missing `hoverImage`/`coverImage`; a caret-fade rule silently contradicting a decision made earlier in the same session).
  - **Drop back down** once fixes from review are applied — test script, PR, next item.
  - The trigger is "I'm about to read code to understand why," not "this is issue-shaped." Filing an issue can need a few reads without needing deep reasoning about them yet.
  - Whether the manager can run the *whole* loop at a mid-tier model, not just the worker, is still an open question — worth testing deliberately, not assumed from one run.

Canonical: Atlas `standards.md` → *Agents — Manager / worker split*. Cursor mirror: `.cursor/rules/agent-delegation.mdc`.

**QA rotation:** the live queue on top of this split. Canonical: `qa-rotation` skill (`~/.claude/skills/qa-rotation`, `~/.cursor/skills/qa-rotation`, `~/.codex/skills/qa-rotation`). Repo pointer: `docs/workflow-qa-rotation.md`. Trigger: "let's work with the QA rotation workflow" (or "rotation"). If he says it to you, you are the manager.

### Verification — Anto tests, agents don't self-verify

**Default: finish the work, hand Anto a numbered test script (exact steps, exact expected results), and stop.** Do not open a browser to satisfy yourself that your own work behaves correctly. He would rather run it himself — it is faster, cheaper, and how he catches what a diff review misses.

- **Browser use is for settling a specific factual question**, not for checking your work: reading a computed style, asserting a DOM node or attribute exists, inspecting an API response, confirming what a token resolves to. One or two calls, and it ends an argument.
- **Hard stop at ~2 calls.** If a check hasn't answered the question by then, stop and ask Anto to look. Iterating in a browser to hunt a bug is the expensive failure mode.
- **Never** drive interactive UI headlessly — drag, pointer capture, hover, focus, animation timing. Synthetic `PointerEvent`s can't take pointer capture and harness drag helpers emit no intermediate `pointermove`, so you get false negatives. Ask.
- Applies to managers and workers alike. A green build is not verification; it proves compilation only.

Canonical: Atlas `standards.md` → *Agents — Anto tests the work*.

### About page
Three-state responsive layout (CSS only — no Flip / no resize tween):
- **Wide (≥50em):** photo 3/4 (17em col) left, Contact+About+Experience stacked in right col
- **Medium (40–50em):** photo 1:1 (17em) + Contact top row; About+Experience span full width below
- **Narrow (<40em):** single column, photo 1:1 full-width → Contact → About → Experience
- Photo `object-position: 50% 35%` in square crop for headroom; `50% 50%` in portrait
- Bio `max-width: 38em`
