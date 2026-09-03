/**
 * Stable `1vh` unit for height constraints that must not track iOS/Edge
 * toolbar show/hide (raw `svh`/`vh` drifts mid-scroll on those browsers).
 *
 * Sets `--vh-safe` on `:root` once on load; recomputes only when the viewport
 * *width* changes (rotation / real resize). Keep `svh` as the CSS fallback:
 * `calc(var(--vh-safe, 1svh) * N)`.
 *
 * Bind from the site layout (or any early client script). Multiple callers are
 * safe — listeners bind once.
 *
 * @see https://github.com/vcruzdesigns/VCDwebsite/issues/96
 * @see https://github.com/vcruzdesigns/VCDwebsite/issues/97
 */

export const SAFE_VH_PROP = '--vh-safe';
import { introLayout } from './projectIntro';
const INTRO_SELECTOR = '.project-block--intro';
const INTRO_AIR_PROP = '--intro-air-slot';
const REORDER_CHROME = new Set(['dev-section-drop-indicator', 'dev-section-reorder-spacer']);

const BOUND_FLAG = '__vcdSafeVhBound';
let safeViewportHeight = 0;

type SafeVhWindow = Window & { [BOUND_FLAG]?: boolean };

/** Write `--vh-safe` = 1% of the current inner height, in px. */
export function setSafeVh(root: HTMLElement = document.documentElement): void {
  safeViewportHeight = window.innerHeight;
  root.style.setProperty(SAFE_VH_PROP, `${safeViewportHeight * 0.01}px`);
}

/** Keep an Intro's percentage endpoint relative to the page fold, not its own top. */
export function setIntroFoldOffsets(root: ParentNode = document): void {
  if (document.documentElement.classList.contains('is-section-reorder-dragging')) return;
  const scrollTop = window.scrollY;
  const intros = [...root.querySelectorAll<HTMLElement>(INTRO_SELECTOR)];
  intros.forEach((intro) => {
    intro.style.removeProperty(INTRO_AIR_PROP);
    intro.style.removeProperty('padding-bottom');
  });
  for (let index = 0; index < intros.length;) {
    const run = [intros[index]];
    while (index + run.length < intros.length) {
      const previous = run.at(-1)!;
      const next = intros[index + run.length];
      if (next.parentElement !== previous.parentElement) break;
      let sibling = previous.nextElementSibling;
      while (sibling && [...REORDER_CHROME].some((name) => sibling!.classList.contains(name))) {
        sibling = sibling.nextElementSibling;
      }
      if (sibling !== next) break;
      run.push(next);
    }
    index += run.length;
    const first = run[0];
    const last = run.at(-1)!;
    const height = Number(first.dataset.devIntroHeightValue) || 75;
    const naturalDocumentBottom = last.getBoundingClientRect().bottom + scrollTop;
    const layout = introLayout(height, safeViewportHeight || window.innerHeight, naturalDocumentBottom, run.length);
    const slot = layout.slotPx;
    run.forEach((intro) => intro.style.setProperty(INTRO_AIR_PROP, `${slot}px`));
    last.style.paddingBottom = `calc(${getComputedStyle(last).paddingBottom} + ${slot}px)`;
  }
}

/**
 * Capture safe vh and bind resize / orientation listeners once.
 * Idempotent — later calls are no-ops after the first bind.
 */
export function bindSafeVh(): void {
  const w = window as SafeVhWindow;
  if (w[BOUND_FLAG]) return;
  w[BOUND_FLAG] = true;

  let lastWidth = window.innerWidth;
  setSafeVh();
  setIntroFoldOffsets();

  let introSyncFrame = 0;
  const scheduleIntroSync = () => {
    cancelAnimationFrame(introSyncFrame);
    introSyncFrame = requestAnimationFrame(() => setIntroFoldOffsets());
  };

  new MutationObserver(scheduleIntroSync).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.fonts.ready.then(scheduleIntroSync);
  window.addEventListener('vcd:intro-layout-sync', scheduleIntroSync);

  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    setSafeVh();
    scheduleIntroSync();
  });
  window.addEventListener('orientationchange', () => {
    setSafeVh();
    scheduleIntroSync();
  });
}
