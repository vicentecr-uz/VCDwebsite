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
  const first = rows[0]?.top ?? 0;
  const last = rows.at(-1)?.top ?? first;
  for (const row of rows) row.delay = last === first ? 0 : HOME_REVEAL_STAGGER * (row.top - first) / (last - first);
  return rows;
}

const isVisible = (element: HTMLElement, home: HTMLElement, viewportHeight: number) => {
  if (element.hidden) return false;
  let ancestor = element.parentElement;
  while (ancestor) {
    if (ancestor !== home && (ancestor.hidden || ancestor.hasAttribute('inert'))) return false;
    ancestor = ancestor.parentElement;
  }
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < viewportHeight && rect.width > 0 && rect.height > 0;
};
function collectUnits(home: HTMLElement, viewportHeight: number): HomeRevealUnit[] {
  const units: HomeRevealUnit[] = [];
  const add = (element: HTMLElement, kind: string) => {
    if (!isVisible(element, home, viewportHeight)) return;
    const rect = element.getBoundingClientRect();
    units.push({ element, kind, top: rect.top, left: rect.left });
  };
  home.querySelectorAll<HTMLElement>('.site-header-slot').forEach((el) => add(el, 'header'));
  home.querySelectorAll<HTMLElement>('.project-block--text p, .project-section-title').forEach((el) => add(el, 'text'));
  const media = '.project-grid__cover, .project-image, .project-image-grid, .project-image-carousel';
  home.querySelectorAll<HTMLElement>(media).forEach((el) => { if (!el.parentElement?.closest(media)) add(el, 'media'); });
  return units;
}

type AnimationLike = { cancel: () => void; finished?: Promise<unknown> };
type SavedStyle = { opacity: string; visibility: string; transform: string; filter: string };
type SplitResult = { lines?: HTMLElement[] };
export function makeHomeRevealCloneVisible(clone: HTMLElement) {
  clone.style.visibility = 'visible';
  return clone;
}
const waitForFonts = async () => {
  const fonts = document.fonts;
  if (!fonts?.ready) return;
  await Promise.race([fonts.ready, new Promise<void>((resolve) => setTimeout(resolve, 120))]);
};

export function createHomeRevealController(home: HTMLElement, win: Window = window) {
  let armed = false;
  let disposed = false;
  let running = false;
  let dismissPending = false;
  let preparation: Promise<void> | null = null;
  let animations: AnimationLike[] = [];
  let units: HomeRevealUnit[] = [];
  const original = new Map<HTMLElement, SavedStyle>();
  const clones: HTMLElement[] = [];
  const remember = (el: HTMLElement) => { if (!original.has(el)) original.set(el, { opacity: el.style.opacity, visibility: el.style.visibility, transform: el.style.transform, filter: el.style.filter }); };
  const reduceMotion = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const cleanup = () => {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    clones.splice(0).forEach((clone) => clone.remove());
    original.forEach((style, el) => Object.assign(el.style, style));
    original.clear(); units = []; running = false;
  };
  const cancel = () => { armed = false; dismissPending = false; cleanup(); };
  const runNow = () => {
    if (disposed || !armed || running) return;
    running = true;
    const reduce = reduceMotion();
    try {
      groupHomeRevealRows(units).forEach((row) => row.units.forEach((unit) => {
        const keyframes = reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, filter: 'blur(12px)', transform: 'translateY(10px) scale(1.07)' }, { opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' }];
        animations.push(unit.element!.animate(keyframes, { duration: HOME_REVEAL_DURATION, delay: reduce ? 0 : row.delay, easing: HOME_REVEAL_EASING, fill: 'both' }));
      }));
      Promise.all(animations.map((animation) => animation.finished ?? Promise.resolve())).then(() => { if (!disposed) cleanup(); }).catch(cancel);
    } catch { cancel(); }
  };
  const prepare = () => {
    if (disposed || armed) return preparation;
    armed = true;
    const reduce = reduceMotion();
    units = collectUnits(home, win.innerHeight || document.documentElement.clientHeight);
    units.forEach((unit) => {
      const source = unit.element!; remember(source); source.style.opacity = '0';
      if (unit.kind === 'text') source.style.visibility = 'hidden';
      if (!reduce && unit.kind !== 'text') { source.style.transform = 'translateY(10px) scale(1.07)'; source.style.filter = 'blur(12px)'; }
      if (unit.kind === 'media') source.querySelectorAll<HTMLImageElement>('img').forEach((image) => { void image.decode?.().catch(() => undefined); });
    });
    preparation = (async () => {
      await waitForFonts();
      if (disposed || !armed) return;
      for (const unit of [...units].filter((item) => item.kind === 'text')) {
        const source = unit.element!;
        const clone = source.cloneNode(true) as HTMLElement;
        clone.setAttribute('aria-hidden', 'true'); clone.setAttribute('inert', '');
        const rect = source.getBoundingClientRect();
        // cloneNode carries the source's pre-hide visibility. The clone must
        // stay visible so opacity/WAAPI can reveal it while the semantic source
        // remains hidden until cleanup.
        makeHomeRevealCloneVisible(clone);
        Object.assign(clone.style, { position: 'fixed', margin: '0', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, pointerEvents: 'none' });
        home.append(clone); clones.push(clone);
        let lines: HTMLElement[] | undefined;
        try {
          const module = await import('gsap/SplitText');
          const SplitText = (module as unknown as { SplitText?: { create: (target: HTMLElement, vars: { type: string }) => SplitResult } }).SplitText;
          lines = SplitText?.create(clone, { type: 'lines' }).lines;
        } catch { lines = undefined; }
        const index = units.indexOf(unit);
        if (lines?.length) {
          const lineUnits = lines.map((line) => { const lineRect = line.getBoundingClientRect(); remember(line); line.style.opacity = '0'; if (!reduce) { line.style.transform = 'translateY(10px) scale(1.07)'; line.style.filter = 'blur(12px)'; } return { element: line, kind: 'text-line', top: lineRect.top, left: lineRect.left }; });
          if (index >= 0) units.splice(index, 1, ...lineUnits);
        } else if (index >= 0) {
          const cloneRect = clone.getBoundingClientRect(); units[index] = { element: clone, kind: 'text-line', top: cloneRect.top, left: cloneRect.left }; remember(clone); clone.style.opacity = '0';
          if (!reduce) { clone.style.transform = 'translateY(10px) scale(1.07)'; clone.style.filter = 'blur(12px)'; }
        }
      }
      if (dismissPending) runNow();
    })().catch(() => { if (!disposed) cancel(); });
    return preparation;
  };
  const onDismissed = () => { dismissPending = true; void (preparation ?? Promise.resolve()).then(() => { if (dismissPending) runNow(); }); };
  const onModeChange = (event: Event) => { if ((event as CustomEvent<{ active?: boolean }>).detail?.active) cancel(); };
  const onResize = () => cancel();
  const onOrientationChange = () => cancel();
  const onPageHide = () => cancel();
  win.addEventListener('vcd:home-intro-dismissed', onDismissed); win.addEventListener('vcd:dev-mode-change', onModeChange); win.addEventListener('resize', onResize); win.addEventListener('orientationchange', onOrientationChange); win.addEventListener('pagehide', onPageHide);
  prepare();
  const destroy = () => { if (disposed) return; disposed = true; cancel(); win.removeEventListener('vcd:home-intro-dismissed', onDismissed); win.removeEventListener('vcd:dev-mode-change', onModeChange); win.removeEventListener('resize', onResize); win.removeEventListener('orientationchange', onOrientationChange); win.removeEventListener('pagehide', onPageHide); };
  return { prepare, run: () => { dismissPending = true; void (preparation ?? Promise.resolve()).then(() => { if (dismissPending) runNow(); }); }, cancel, isArmed: () => armed, isRunning: () => running, cleanup: destroy, destroy };
}

const controllerKey = '__vcdHomeRevealController';
export function bindHomeReveal() {
  const home = document.querySelector<HTMLElement>('[data-home-page]'); if (!home) return null;
  const scope = window as Window & Record<string, unknown>;
  (scope[controllerKey] as ReturnType<typeof createHomeRevealController> | undefined)?.destroy();
  const controller = createHomeRevealController(home); scope[controllerKey] = controller; import.meta.hot?.dispose(controller.destroy); return controller;
}
