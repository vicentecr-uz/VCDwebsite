export const HOME_REVEAL_DURATION = 449.28;
export const HOME_REVEAL_STAGGER = 550.72;
export const HOME_REVEAL_EASING = 'linear(0 0%, 0.006234 1%, 0.023295 2%, 0.04897 3%, 0.081353 4%, 0.118809 5%, 0.159948 6%, 0.20359 7%, 0.248745 8%, 0.294589 9%, 0.34044 10%, 0.385746 11%, 0.43006 12%, 0.473032 13%, 0.514392 14%, 0.553942 15%, 0.591539 16%, 0.627092 17%, 0.660552 18%, 0.691902 19%, 0.721157 20%, 0.748351 21%, 0.773538 22%, 0.796788 23%, 0.818178 24%, 0.837796 25%, 0.855733 26%, 0.872085 27%, 0.886949 28%, 0.90042 29%, 0.912596 30%, 0.923568 31%, 0.933428 32%, 0.942263 33%, 0.950157 34%, 0.957188 35%, 0.963433 36%, 0.968961 37%, 0.973838 38%, 0.978127 39%, 0.981885 40%, 0.985164 41%, 0.988015 42%, 0.990482 43%, 0.992606 44%, 0.994426 45%, 0.995975 46%, 0.997286 47%, 0.998387 48%, 0.999303 49%, 1.000058 50%)';

export interface HomeRevealUnit { element?: HTMLElement; top: number; left: number; kind?: string; }
export interface HomeRevealRow { units: HomeRevealUnit[]; top: number; delay: number; }

export function groupHomeRevealRows(units: HomeRevealUnit[], tolerance = 4): HomeRevealRow[] {
  const ordered = [...units].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: HomeRevealRow[] = [];
  for (const unit of ordered) {
    const row = rows.at(-1);
    if (!row || Math.abs(unit.top - row.top) > tolerance) rows.push({ units: [unit], top: unit.top, delay: 0 });
    else row.units.push(unit);
  }
  const last = rows.at(-1)?.top ?? 0;
  for (const row of rows) row.delay = rows.length < 2 ? 0 : HOME_REVEAL_STAGGER * (row.top - rows[0].top) / (last - rows[0].top);
  return rows;
}

const isVisible = (element: HTMLElement, viewportHeight: number) => {
  if (element.hidden || element.closest('[hidden], [inert]')) return false;
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < viewportHeight && rect.width > 0 && rect.height > 0;
};

function collectUnits(home: HTMLElement, viewportHeight: number): HomeRevealUnit[] {
  const units: HomeRevealUnit[] = [];
  const add = (element: HTMLElement, kind: string) => {
    if (!isVisible(element, viewportHeight)) return;
    const rect = element.getBoundingClientRect();
    units.push({ element, kind, top: rect.top, left: rect.left });
  };
  home.querySelectorAll<HTMLElement>('.site-header-slot').forEach((el) => add(el, 'header'));
  home.querySelectorAll<HTMLElement>('.project-block--text p, .project-section-title').forEach((el) => add(el, 'text'));
  const media = '.project-grid__cover, .project-image, .project-image-grid, .project-image-carousel';
  home.querySelectorAll<HTMLElement>(media).forEach((el) => {
    if (!el.parentElement?.closest(media)) add(el, 'media');
  });
  return units;
}

type AnimationLike = { cancel: () => void; finished?: Promise<unknown> };

export function createHomeRevealController(home: HTMLElement, win: Window = window) {
  let armed = false;
  let disposed = false;
  let running = false;
  let animations: AnimationLike[] = [];
  const original = new Map<HTMLElement, { opacity: string; visibility: string; transform: string; filter: string }>();
  const clones: HTMLElement[] = [];
  const targets = new Map<HTMLElement, HTMLElement>();
  const remember = (el: HTMLElement) => {
    if (!original.has(el)) original.set(el, { opacity: el.style.opacity, visibility: el.style.visibility, transform: el.style.transform, filter: el.style.filter });
  };
  const cleanup = () => {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    clones.splice(0).forEach((clone) => clone.remove());
    targets.clear();
    original.forEach((style, el) => Object.assign(el.style, style));
    original.clear();
    running = false;
  };
  const prepare = () => {
    if (disposed || armed) return;
    armed = true;
    const units = collectUnits(home, win.innerHeight || document.documentElement.clientHeight);
    const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    for (const unit of units) {
      const el = unit.element!;
      remember(el);
      let target = el;
      // Text remains the semantic source. A transient visual copy means line
      // measurement/animation never rewrites editable or assistive DOM.
      if (unit.kind === 'text') {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('inert', '');
        const rect = el.getBoundingClientRect();
        Object.assign(clone.style, { position: 'fixed', margin: '0', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: 'none' });
        home.append(clone);
        clones.push(clone);
        targets.set(el, clone);
        target = clone;
        el.style.visibility = 'hidden';
      }
      remember(target);
      target.style.opacity = '0';
      if (reduce) {
        target.style.transform = '';
        target.style.filter = '';
      } else {
        target.style.transform = 'translateY(10px) scale(1.07)';
        target.style.filter = 'blur(12px)';
      }
    }
  };
  const run = () => {
    if (disposed || !armed || running) return;
    running = true;
    const units = collectUnits(home, win.innerHeight || document.documentElement.clientHeight);
    const rows = groupHomeRevealRows(units);
    const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    try {
      rows.forEach((row) => row.units.forEach((unit) => {
        const el = targets.get(unit.element!) ?? unit.element!;
        const keyframes = reduce
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ opacity: 0, filter: 'blur(12px)', transform: 'translateY(10px) scale(1.07)' }, { opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' }];
        const animation = el.animate(keyframes, { duration: HOME_REVEAL_DURATION, delay: reduce ? 0 : row.delay, easing: HOME_REVEAL_EASING, fill: 'both' });
        animations.push(animation);
      }));
      Promise.all(animations.map((animation) => animation.finished ?? Promise.resolve())).then(() => { if (!disposed) cleanup(); }).catch(cleanup);
    } catch { cleanup(); }
  };
  const cancel = () => { armed = false; cleanup(); };
  const onDismissed = () => run();
  const onCancel = () => cancel();
  win.addEventListener('vcd:home-intro-dismissed', onDismissed);
  win.addEventListener('vcd:dev-mode-change', (event) => { if ((event as CustomEvent<{ active?: boolean }>).detail?.active) onCancel(); });
  win.addEventListener('resize', onCancel);
  win.addEventListener('orientationchange', onCancel);
  win.addEventListener('pagehide', onCancel);
  prepare();
  return { prepare, run, cancel, isArmed: () => armed, isRunning: () => running, cleanup: () => { disposed = true; cancel(); win.removeEventListener('vcd:home-intro-dismissed', onDismissed); } };
}

export function bindHomeReveal() {
  const home = document.querySelector<HTMLElement>('[data-home-page]');
  if (!home) return null;
  return createHomeRevealController(home);
}
