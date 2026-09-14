import defaultConfig from './homeRevealConfig.json';
export const HOME_REVEAL_DURATION = defaultConfig.entrance.durationMs;
export const HOME_REVEAL_STAGGER = defaultConfig.entrance.totalStaggerMs;
export const HOME_REVEAL_EASING = defaultConfig.entrance.easing;
export type HomeRevealConfig = typeof defaultConfig;

export interface HomeRevealUnit { element?: HTMLElement; top: number; left: number; kind?: string; }
export interface HomeRevealRow { units: HomeRevealUnit[]; top: number; delay: number; }
export function groupHomeRevealRows(units: HomeRevealUnit[], tolerance = 4, config: HomeRevealConfig = defaultConfig): HomeRevealRow[] {
  const ordered = [...units].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: HomeRevealRow[] = [];
  for (const unit of ordered) {
    const row = rows.at(-1);
    if (!row || Math.abs(unit.top - row.top) > tolerance) rows.push({ units: [unit], top: unit.top, delay: 0 });
    else row.units.push(unit);
  }
  const first = rows[0]?.top ?? 0;
  const last = rows.at(-1)?.top ?? first;
  const hasHeader = rows.some((row) => row.units.every((unit) => unit.kind === 'header'));
  const nonHeader = rows.filter((row) => !row.units.every((unit) => unit.kind === 'header'));
  const firstContent = nonHeader[0]?.top ?? first;
  const lastContent = nonHeader.at(-1)?.top ?? firstContent;
  for (const row of rows) {
    if (row.units.every((unit) => unit.kind === 'header')) row.delay = 0;
    else if (!hasHeader) row.delay = lastContent === firstContent ? 0 : config.entrance.totalStaggerMs * (row.top - firstContent) / (lastContent - firstContent);
    else row.delay = lastContent === firstContent ? config.entrance.headerLeadMs : config.entrance.headerLeadMs + (config.entrance.totalStaggerMs - config.entrance.headerLeadMs) * (row.top - firstContent) / (lastContent - firstContent);
  }
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
  home.querySelectorAll<HTMLElement>('.project-body-text, .project-section-title').forEach((el) => add(el, 'text'));
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

export interface HomeRevealControllerOptions { reducedMotion?: boolean; }
export function createHomeRevealController(home: HTMLElement, win: Window = window, config: HomeRevealConfig = defaultConfig, options: HomeRevealControllerOptions = {}) {
  let armed = false;
  let disposed = false;
  let running = false;
  let dismissPending = false;
  let preparation: Promise<void> | null = null;
  let generation = 0;
  let animations: AnimationLike[] = [];
  let units: HomeRevealUnit[] = [];
  const original = new Map<HTMLElement, SavedStyle>();
  const clones: HTMLElement[] = [];
  const isIntroDismissed = () => home.ownerDocument?.querySelector<HTMLElement>('[data-home-intro-surface]')?.dataset.state === 'dismissed';
  const remember = (el: HTMLElement) => { if (!original.has(el)) original.set(el, { opacity: el.style.opacity, visibility: el.style.visibility, transform: el.style.transform, filter: el.style.filter }); };
  const reduceMotion = () => options.reducedMotion ?? (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const cleanup = () => {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    clones.splice(0).forEach((clone) => clone.remove());
    original.forEach((style, el) => Object.assign(el.style, style));
    original.clear(); units = []; running = false;
  };
  const cancel = () => { generation += 1; armed = false; dismissPending = false; preparation = null; cleanup(); };
  const runNow = () => {
    if (disposed || !armed || running) return;
    running = true;
    const reduce = reduceMotion();
    try {
      groupHomeRevealRows(units, 4, config).forEach((row) => row.units.forEach((unit) => {
        const keyframes = reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, filter: `blur(${config.entrance.blurPx}px)`, transform: `translateY(${config.entrance.translateYPx}px) scale(${config.entrance.scale})` }, { opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' }];
        // Reduced motion keeps the spatial opacity wave; only movement and
        // blur are removed from its visual variant.
        animations.push(unit.element!.animate(keyframes, { duration: config.entrance.durationMs, delay: row.delay, easing: config.entrance.easing, fill: 'both' }));
      }));
      Promise.all(animations.map((animation) => animation.finished ?? Promise.resolve())).then(() => { if (!disposed) cleanup(); }).catch(cancel);
    } catch { cancel(); }
  };
  const prepare = () => {
    if (disposed || armed || isIntroDismissed()) return preparation;
    armed = true;
    const preparationGeneration = generation;
    const reduce = reduceMotion();
    units = collectUnits(home, win.innerHeight || document.documentElement.clientHeight);
    units.forEach((unit) => {
      const source = unit.element!; remember(source); source.style.opacity = '0';
      if (unit.kind === 'text') source.style.visibility = 'hidden';
      if (!reduce && unit.kind !== 'text') { source.style.transform = `translateY(${config.entrance.translateYPx}px) scale(${config.entrance.scale})`; source.style.filter = `blur(${config.entrance.blurPx}px)`; }
      if (unit.kind === 'media') source.querySelectorAll<HTMLImageElement>('img').forEach((image) => { void image.decode?.().catch(() => undefined); });
    });
    preparation = (async () => {
      await waitForFonts();
      if (disposed || !armed || preparationGeneration !== generation) return;
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
          if (disposed || !armed || preparationGeneration !== generation) { clone.remove(); return; }
          const SplitText = (module as unknown as { SplitText?: { create: (target: HTMLElement, vars: { type: string }) => SplitResult } }).SplitText;
          lines = SplitText?.create(clone, { type: 'lines' }).lines;
        } catch { lines = undefined; }
        const index = units.indexOf(unit);
        if (lines?.length) {
          const lineUnits = lines.map((line) => { const lineRect = line.getBoundingClientRect(); remember(line); line.style.opacity = '0'; if (!reduce) { line.style.transform = `translateY(${config.entrance.translateYPx}px) scale(${config.entrance.scale})`; line.style.filter = `blur(${config.entrance.blurPx}px)`; } return { element: line, kind: 'text-line', top: lineRect.top, left: lineRect.left }; });
          if (index >= 0) units.splice(index, 1, ...lineUnits);
        } else if (index >= 0) {
          const cloneRect = clone.getBoundingClientRect(); units[index] = { element: clone, kind: 'text-line', top: cloneRect.top, left: cloneRect.left }; remember(clone); clone.style.opacity = '0';
          if (!reduce) { clone.style.transform = `translateY(${config.entrance.translateYPx}px) scale(${config.entrance.scale})`; clone.style.filter = `blur(${config.entrance.blurPx}px)`; }
        }
      }
      if (dismissPending) runNow();
    })().catch(() => { if (!disposed && preparationGeneration === generation) cancel(); });
    return preparation;
  };
  const onDismissed = () => { dismissPending = true; void (preparation ?? Promise.resolve()).then(() => { if (dismissPending) runNow(); }); };
  const onModeChange = (event: Event) => { if ((event as CustomEvent<{ active?: boolean }>).detail?.active) cancel(); };
  const rebuildBeforeDismissal = () => {
    if (!armed) return;
    if (running || dismissPending) { cancel(); return; }
    cancel();
    const rebuildGeneration = generation;
    void Promise.resolve().then(() => { if (!disposed && rebuildGeneration === generation) prepare(); });
  };
  const onResize = rebuildBeforeDismissal;
  const onOrientationChange = rebuildBeforeDismissal;
  const onPageHide = () => cancel();
  const onPageShow = (event: PageTransitionEvent) => { if (!event.persisted) return; cancel(); void Promise.resolve().then(() => { if (!disposed) prepare(); }); };
  win.addEventListener('vcd:home-intro-dismissed', onDismissed); win.addEventListener('vcd:dev-mode-change', onModeChange); win.addEventListener('resize', onResize); win.addEventListener('orientationchange', onOrientationChange); win.addEventListener('pagehide', onPageHide); win.addEventListener('pageshow', onPageShow);
  prepare();
  const destroy = () => { if (disposed) return; disposed = true; cancel(); win.removeEventListener('vcd:home-intro-dismissed', onDismissed); win.removeEventListener('vcd:dev-mode-change', onModeChange); win.removeEventListener('resize', onResize); win.removeEventListener('orientationchange', onOrientationChange); win.removeEventListener('pagehide', onPageHide); win.removeEventListener('pageshow', onPageShow); };
  return { prepare, run: () => { dismissPending = true; void (preparation ?? Promise.resolve()).then(() => { if (dismissPending) runNow(); }); }, cancel, isArmed: () => armed, isRunning: () => running, cleanup: destroy, destroy };
}

const controllerKey = '__vcdHomeRevealController';
export function bindHomeReveal(config: HomeRevealConfig = defaultConfig, options: HomeRevealControllerOptions = {}) {
  const home = document.querySelector<HTMLElement>('[data-home-page]'); if (!home) return null;
  const scope = window as Window & Record<string, unknown>;
  (scope[controllerKey] as ReturnType<typeof createHomeRevealController> | undefined)?.destroy();
  const controller = createHomeRevealController(home, window, config, options); scope[controllerKey] = controller; import.meta.hot?.dispose(controller.destroy); return controller;
}
