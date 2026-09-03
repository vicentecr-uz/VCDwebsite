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
const INTRO_AIR_CLASS = 'project-intro-air';
const INTRO_AIR_START_CLASS = 'project-intro-air--start';
const INTRO_AIR_END_CLASS = 'project-intro-air--end';
const INTRO_RUN_START_ATTR = 'data-intro-run-start';
const INTRO_AFTER_RUN_ATTR = 'data-intro-after-run';
const INTRO_OUTER_AIR_PROP = '--intro-outer-air';
const LEGACY_INTRO_AIR_PROP = '--intro-air-slot';
const REORDER_CHROME = new Set([
  'dev-section-drop-indicator',
  'dev-section-reorder-spacer',
  INTRO_AIR_CLASS,
]);

const BOUND_FLAG = '__vcdSafeVhBound';
let safeViewportHeight = 0;

type SafeVhWindow = Window & { [BOUND_FLAG]?: boolean };

const isReorderChrome = (element: Element) =>
  [...REORDER_CHROME].some((name) => element.classList.contains(name));

const nextLogicalSibling = (element: Element): HTMLElement | null => {
  let sibling = element.nextElementSibling;
  while (sibling && isReorderChrome(sibling)) sibling = sibling.nextElementSibling;
  return sibling instanceof HTMLElement ? sibling : null;
};

/** Write `--vh-safe` = 1% of the current inner height, in px. */
export function setSafeVh(root: HTMLElement = document.documentElement): void {
  safeViewportHeight = window.innerHeight;
  root.style.setProperty(SAFE_VH_PROP, `${safeViewportHeight * 0.01}px`);
}

/** Keep an Intro's percentage endpoint relative to the page fold, not its own top. */
export function setIntroFoldOffsets(root: ParentNode = document): void {
  const scrollTop = window.scrollY;
  const intros = [...root.querySelectorAll<HTMLElement>(INTRO_SELECTOR)];
  const spacers = [...root.querySelectorAll<HTMLElement>(`.${INTRO_AIR_CLASS}`)];
  const usedSpacers = new Set<HTMLElement>();

  spacers.forEach((spacer) => { spacer.style.height = '0px'; });
  root.querySelectorAll<HTMLElement>(`[${INTRO_RUN_START_ATTR}], [${INTRO_AFTER_RUN_ATTR}]`).forEach((element) => {
    element.removeAttribute(INTRO_RUN_START_ATTR);
    element.removeAttribute(INTRO_AFTER_RUN_ATTR);
    element.style.removeProperty(INTRO_OUTER_AIR_PROP);
  });
  intros.forEach((intro) => {
    intro.style.removeProperty(LEGACY_INTRO_AIR_PROP);
    intro.style.removeProperty('padding-bottom');
  });

  const airSpacer = (
    anchor: HTMLElement,
    position: 'before' | 'after',
    modifier: string,
  ) => {
    const adjacent = position === 'before'
      ? anchor.previousElementSibling
      : anchor.nextElementSibling;
    let spacer = adjacent instanceof HTMLElement && adjacent.classList.contains(modifier)
      ? adjacent
      : spacers.find((candidate) => !usedSpacers.has(candidate) && candidate.classList.contains(modifier));
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = `${INTRO_AIR_CLASS} ${modifier}`;
      spacer.setAttribute('aria-hidden', 'true');
    }
    if (position === 'before' && anchor.previousElementSibling !== spacer) anchor.before(spacer);
    if (position === 'after' && anchor.nextElementSibling !== spacer) anchor.after(spacer);
    usedSpacers.add(spacer);
    return spacer;
  };

  for (let index = 0; index < intros.length;) {
    const run = [intros[index]];
    while (index + run.length < intros.length) {
      const previous = run.at(-1)!;
      const next = intros[index + run.length];
      if (next.parentElement !== previous.parentElement) break;
      if (nextLogicalSibling(previous) !== next) break;
      run.push(next);
    }
    index += run.length;
    const first = run[0];
    const last = run.at(-1)!;
    const height = Number(first.dataset.devIntroHeightValue) || 75;
    const startSpacer = airSpacer(first, 'before', INTRO_AIR_START_CLASS);
    const endSpacer = airSpacer(last, 'after', INTRO_AIR_END_CLASS);
    const next = nextLogicalSibling(last);

    first.setAttribute(INTRO_RUN_START_ATTR, '');
    next?.setAttribute(INTRO_AFTER_RUN_ATTR, '');
    const naturalDocumentBottom = next
      ? next.getBoundingClientRect().top + scrollTop
      : last.getBoundingClientRect().bottom + scrollTop;
    const layout = introLayout(height, safeViewportHeight || window.innerHeight, naturalDocumentBottom);
    const outerAir = `${layout.outerGapPx}px`;
    startSpacer.style.height = outerAir;
    endSpacer.style.height = outerAir;
    first.style.setProperty(INTRO_OUTER_AIR_PROP, outerAir);
    next?.style.setProperty(INTRO_OUTER_AIR_PROP, outerAir);
  }

  spacers.forEach((spacer) => {
    if (!usedSpacers.has(spacer)) spacer.remove();
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
