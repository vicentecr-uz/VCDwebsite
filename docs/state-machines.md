# Runtime state machines

The public site has several state machines. Most of them are implicit: their state is spread across flags, classes, data attributes and timers. The bugs come from transitions nobody planned for, such as interrupts, superseded navigations, sticky hover, or input arriving mid-animation. Read the relevant section before changing one of these machines, and update it in the same PR when its states, events or invariants change.

Functions and events are named instead of line numbers, so `rg` finds them. Last audited 2026-11-06 (PR #219).

## Navigation contract

Astro's ClientRouter swaps pages, but the shell (`#site-wrapper`, the header slot, the menu backdrop and `#transition-overlay`) persists across swaps. Three scripts coordinate through events:

| Order | Event | Dispatched by | Listeners |
|---|---|---|---|
| 1 | `astro:before-preparation` | Astro | `installPersistentNavigation` (`src/scripts/persistentNavigation.ts`): records the navigation and may call `hooks.cover()` |
| 2 | `header:navigation-start` | `announceTitle` (persistentNavigation) | Header menu, wordmark and scroll mode: lock the menu, start the title bridge, dock a partly visible header |
| 3 | `astro:before-swap` | Astro | persistentNavigation replaces `event.swap` with `swapPageContent`; `onPageLoad` unmounts page controllers |
| 4 | `header:navigation-commit` | the custom swap | Header: install the incoming title and links, reset the story notes |
| 5 | `astro:page-load` | Astro | persistentNavigation calls `hooks.reveal()` only if this navigation swapped; `onPageLoad` mounts controllers |
| 6 | `header:navigation-reveal` | `revealPage` (`src/layouts/Layout.astro`) | Header menu: unlock, then reopen if hovered or focused, otherwise close |
| — | `header:navigation-cancel` | `clearHeaderNavigationState` (Layout) | Header: release every navigation lock |
| — | `header:force-close` | `forceCloseMenus` (Header) | Header menu and wordmark: close instantly, used for the tap-mode media-query change and for pagehide/pageshow |

Invariants:

- **The newest navigation owns the veil.** A superseded navigation never calls `cancel()`, because its abort microtask checks `navigation === event`.
- **Every `navigation-start` ends** in exactly one `navigation-reveal` or `navigation-cancel`. Otherwise the header menu stays locked (`navigationClosing`/`navigationOutgoing`).
- **`history.state` belongs to the router.** Astro ignores `popstate` for entries with a null state, so any `replaceState` must pass `history.state` through.
- **The header is document-lifetime.** Page controllers mount per `#main-content` through `onPageLoad` and `createPageScope` (`src/lib/pageLifecycle.ts`), and anything they start must be owned by that scope.

## Page veil

Lives in `src/layouts/Layout.astro` and is explicit. A `generation` counter plus `invalidate()` kills the tween, the reveal animation, the readiness wait and the watchdog in one place.

- **States:** Hidden → Covering (GSAP) → Covered → WaitingReadiness (fonts, in-viewport images, `[data-page-reveal-ready]` roots) → Fading → Hidden. There is also Locked (legacy full-page link with a 4 s watchdog) and Suspended (after pagehide).
- **Invariant:** every async continuation re-checks `current !== generation || suspended`.
- **Deliberate:** stalled media keeps the veil up with no timeout. This is tested in `page-transition.test.ts`, and a `[data-page-reveal-ready]` root that never flips to `true` will hold it forever.
- **Testing:** the cover tween needs animation frames, so a hidden or background browser tab stalls navigation. Use a visible tab, a headless browser, or `?dev-transition=visible`. The dev server loads full pages because editor islands opt out of the persistent swap, so test ClientRouter behaviour against a production build.

## Header menu

Each `.header-trigger` in `src/components/Header.astro` has a menu with two state carriers:

- **Logical:** `data-menu-open` (`isOpen()`).
- **Layout:** `.is-menu-open`, which keeps the closing menu laid out under the pointer. It is also what the scroll machine reads.

| State | `data-menu-open` | `.is-menu-open` | Note |
|---|---|---|---|
| Closed | – | – | |
| Open | ✓ | ✓ | |
| Closing | – | ✓ | `closeTimer` pending (about 212 ms) |
| ClosedHeld | – | ✓ | hover (desktop) or keyboard focus still holds it |
| NavLocked | any | any | between `navigation-start` and reveal/cancel |

**Invariant:** only `releaseOpenClass()` removes the class. It runs from the close timer, `mouseleave` and `focusout`, so ClosedHeld always exits once hover and focus leave. Tap mode never holds the class, because sticky `:hover` and focus-on-tap are incidental. If the class sticks, the scroll machine sees an open menu forever.

## Header scroll mode

Uses `mode ∈ flow | docked | riding` in Header.astro.

- **Freeze rule:** the mode stops changing while the header is engaged (tap mode, hover, or focus inside) and the menu is open or was scroll-closed (`menuScrollClosed`). A downward scroll then dispatches `header:request-close` once.
- **Transitions:** docked → riding on scroll down. riding → docked when it comes back into view. riding → flow once it's off screen for 350 ms. Up-scroll past 4 px while fully off screen → docked with a fade. `astro:after-swap` → flow.
- **Narrow widths:** at 767 px and below the header is always docked.

## Header wordmark and title swap

Every run takes a `wordmarkRunToken`. `data-header-title-pending` is the lock `openMenu` respects. It is set on `navigation-start` and released when the commit's bridge finishes, on cancel, or on force-close.

**Open edge:** if a bridge animation is cancelled externally (`finish(false)`), the lock stays until the next navigation. No public path does this today.

## Section sidebar

Lives in `src/components/SectionSidebarNav.astro`, desktop only.

- **Scrollspy** drives the active link, except during AutoScrolling (the click tween, 480–900 ms) or before `manualLockUntil`.
- **Click:** `setActiveLink`, then `replaceState(history.state, …)` (see the navigation contract), then the tween.
- **User input wins.** Wheel, touchstart, pointerdown or a scroll key (`cancelAutoScroll`) stops the tween and clears the lock.

## Project video visibility

`bindVideoVisibility` in `src/lib/projectVideoControls.ts`:

- A playing video that leaves the viewport fades over 300 ms and then pauses. A muted one pauses immediately.
- An autoplay loop (`data-autoplay`) paused this way is flagged `pausedByVisibility`, stays observed, and resumes on return.
- A video the viewer started or paused stays paused.
- The poster gate (`bindVideoPoster`) is generation-guarded, and `emptied`/`error` restore it.

## Newsletter signup

- **Client** (`ProjectSignup.astro`): Editing → Submitting → Celebrating, or Error/Invalid. `submitting` blocks double submits, and `scope.signal` aborts the request on navigation.
- **Server** (`src/lib/signup-handler.ts`): rate-limits 8 requests per IP per window, keyed on `cf-connecting-ip`. `X-Forwarded-For` is only a fallback outside Cloudflare, because a client can prefix it.

## Machines with their own guards

- **Image lightbox** (`ImageLightbox.astro`): a `session` token rises on open and dismiss, so stale loaders, timers and demo ticks are ignored. Gesture is `drag | pan | pinch | rotate | blocked | null`. Pagehide, opener removal and swaps all dismiss. Tests: `image-lightbox.test.ts`.
- **Image preview upgrade** (`imagePreviewUpgrade.ts`): runs per image as Bound → Fetching → Loaded → Revealing → Upgraded, with 3 attempts and 1 s/2 s backoff. It is gated on the veil reveal.
- **Home intro** (`homeIntro.ts`): explicit `pending | active | editing | dismissing | dismissed`. Copy this pattern for new machines.
- **Carousel drag** (`projectImageCarousel.ts`): Idle → Pressed → Dragging → Settling. `endDrag` handles every pointer exit, and `settleGeneration` guards momentum.
- **Press-quote ticker** (`ProjectPressQuoteTicker.astro`): Cruising, HoverPaused, Dragging, Coasting, Parked. A 1 s watchdog re-initialises any host whose beat is older than 1.6 s.

## Known open holes

These were judged too low-impact to fix in PR #219. Re-check them before building on these areas.

- **Ticker under reduced motion:** the ticker never writes its beat, so the watchdog re-initialises it every second. There's no visible effect.
- **Scroll finale spacer:** `layoutSpacer` collapses the spacer to 0 to measure it, which can move the scroll position near the page bottom. This is plausible on mobile but unconfirmed.
- **Scroll finale sidebar opacity:** the finale's inline sidebar opacity beats the "hide sidebar while menu is open" rule. Cosmetic.
- **Signup rate counter:** it isn't atomic, and each allowed request restarts the window.
- **Listmonk duplicates:** a 409 from listmonk is reported as success without adding the address to the list, so returning subscribers may not be re-added.
