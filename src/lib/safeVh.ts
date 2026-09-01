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
const INTRO_FOLD_OFFSET_PROP = '--intro-fold-offset';
const INTRO_SELECTOR = '.project-block--intro';

const BOUND_FLAG = '__vcdSafeVhBound';

type SafeVhWindow = Window & { [BOUND_FLAG]?: boolean };

/** Write `--vh-safe` = 1% of the current inner height, in px. */
export function setSafeVh(root: HTMLElement = document.documentElement): void {
  root.style.setProperty(SAFE_VH_PROP, `${window.innerHeight * 0.01}px`);
}

/** Keep an Intro's percentage endpoint relative to the page fold, not its own top. */
export function setIntroFoldOffsets(root: ParentNode = document): void {
  const scrollTop = window.scrollY;
  root.querySelectorAll<HTMLElement>(INTRO_SELECTOR).forEach((intro) => {
    const pageTop = intro.getBoundingClientRect().top + scrollTop;
    intro.style.setProperty(INTRO_FOLD_OFFSET_PROP, `${Math.max(0, pageTop)}px`);
  });
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
  });

  document.fonts.ready.then(scheduleIntroSync);

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
