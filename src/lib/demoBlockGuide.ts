import type { DemoBlockReorderHandle } from './demoBlockReorder';
import type { createDemoGapSpacing } from './demoGapSpacing';

type Point = { x: number; y: number };
type CursorState = Point & { scale: number; opacity: number };

interface DemoBlockGuideOptions {
  root: HTMLElement;
  cursor: HTMLElement;
  imageBlock: HTMLElement;
  textBlock: HTMLElement;
  gaps: ReturnType<typeof createDemoGapSpacing>;
  reorder: DemoBlockReorderHandle;
  revertButton: HTMLButtonElement;
}

export function createDemoBlockGuide({ root, cursor, imageBlock, textBlock, gaps, reorder, revertButton }: DemoBlockGuideOptions) {
  const document = root.ownerDocument;
  const win = document.defaultView!;
  const lifecycle = new win.AbortController();
  const { signal } = lifecycle;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let generation = 0;
  let frame: number | null = null;
  let timer: ReturnType<typeof win.setTimeout> | undefined;
  let lifting = false;
  let destroyed = false;
  let autoStarted = false;
  let pendingResolve: ((value: boolean) => void) | undefined;
  let cursorState: CursorState = { x: 0, y: 0, scale: 1, opacity: 0 };

  cursor.setAttribute('aria-hidden', 'true');

  const paint = () => {
    cursor.style.opacity = String(cursorState.opacity);
    cursor.style.transform = `translate(${cursorState.x}px, ${cursorState.y}px) scale(${cursorState.scale})`;
  };
  const stopFrame = () => { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; };
  const stopTimer = () => { if (timer !== undefined) win.clearTimeout(timer); timer = undefined; };
  const alive = (token: number) => !destroyed && token === generation && !signal.aborted;
  const wait = (ms: number, token: number) => new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    timer = win.setTimeout(() => { timer = undefined; pendingResolve = undefined; resolve(alive(token)); }, ms);
  });
  const center = (element: Element): Point => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const viewport = (): DOMRect => {
    const pageViewport = root.closest<HTMLElement>('[data-page-viewport]');
    return pageViewport?.getBoundingClientRect() ?? new win.DOMRect(0, 0, win.innerWidth, win.innerHeight);
  };
  const clampToViewport = (point: Point): Point => {
    const box = viewport();
    return { x: Math.min(box.right - 24, Math.max(box.left + 8, point.x)), y: Math.min(box.bottom - 64, Math.max(box.top + 64, point.y)) };
  };
  const animate = (to: Partial<CursorState>, duration: number, token: number) => new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    const from = { ...cursorState };
    const started = win.performance.now();
    const tick = (now: number) => {
      if (!alive(token)) { pendingResolve = undefined; resolve(false); return; }
      const progress = Math.min(1, (now - started) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      for (const key of ['x', 'y', 'scale', 'opacity'] as const) {
        if (to[key] !== undefined) cursorState[key] = from[key] + (to[key]! - from[key]) * eased;
      }
      paint();
      if (progress < 1) frame = win.requestAnimationFrame(tick);
      else { frame = null; pendingResolve = undefined; resolve(true); }
    };
    frame = win.requestAnimationFrame(tick);
  });
  const move = (point: Point, duration: number, token: number) => animate({ ...point }, duration, token);
  const tap = async (point: Point, action: () => void, token: number) => {
    if (!await move(point, 320, token) || !await wait(100, token)) return false;
    if (!await animate({ scale: 0.88 }, 120, token)) return false;
    action();
    if (!await wait(120, token)) return false;
    return animate({ scale: 1 }, 120, token);
  };
  const gapPill = () => imageBlock.querySelector<HTMLElement>('.dev-gap-toolbar__pill');
  const gapChoice = () => imageBlock.querySelector<HTMLButtonElement>('[data-dev-spacing-option="group"]')
    ?? imageBlock.querySelector<HTMLButtonElement>('[data-dev-spacing-option]');

  const stop = () => {
    pendingResolve?.(false);
    pendingResolve = undefined;
    generation += 1;
    stopFrame();
    stopTimer();
    if (lifting) reorder.cancel();
    lifting = false;
    gaps.hide();
    imageBlock.classList.remove('is-dev-section-controls-visible');
    cursorState.opacity = 0;
    paint();
  };

  const run = () => {
    if (destroyed) return;
    autoStarted = true;
    stop();
    const token = ++generation;
    void (async () => {
      const image = imageBlock.querySelector<HTMLImageElement>('img');
      await image?.decode?.().catch(() => {});
      await document.fonts?.ready;
      if (!alive(token)) return;
      const pill = gapPill();
      if (!pill) return;
      const start = center(pill);
      cursorState = { ...start, scale: 1, opacity: 0 };
      paint();
      if (reducedMotion.matches) {
        if (!await animate({ opacity: 1 }, 280, token)) return;
        if (!await wait(700, token)) return;
        await animate({ opacity: 0 }, 250, token);
        return;
      }
      if (!await wait(600, token)) return;
      const startOffset = { x: start.x + 24, y: start.y - 24 };
      cursorState = { ...startOffset, scale: 1, opacity: 0 };
      paint();
      if (!await animate({ ...center(pill), opacity: 1 }, 420, token)) return;
      gaps.reveal(imageBlock);
      if (!await wait(250, token)) return;
      const choice = gapChoice();
      if (!choice || !await tap(center(choice), () => choice.click(), token)) return;
      if (!await wait(350, token)) return;
      gaps.hide();
      imageBlock.classList.add('is-dev-section-controls-visible');
      const handle = imageBlock.querySelector<HTMLElement>('[data-reorder-demo-handle], .dev-section-drag-handle');
      if (!handle || !await move(center(handle), 400, token)) return;
      const grab = center(handle);
      if (!await animate({ scale: 0.88 }, 120, token)) return;
      if (!reorder.guideLift(imageBlock, grab.x, grab.y)) return;
      lifting = true;
      const started = win.performance.now();
      const drag = (now: number): void => {
        if (!alive(token)) return;
        const text = textBlock.getBoundingClientRect();
        const elapsed = now - started;
        const travel = Math.min(1, elapsed / 1000);
        const target = clampToViewport({ x: grab.x, y: text.bottom + 24 });
        const point = clampToViewport({ x: grab.x + (target.x - grab.x) * travel, y: grab.y + (target.y - grab.y) * (travel * travel * (3 - 2 * travel)) });
        reorder.guideMove(point.x, point.y);
        cursorState.x = point.x; cursorState.y = point.y; paint();
        if (elapsed >= 1000 && text.bottom + 12 <= point.y) { frame = null; void finishDrag(token); return; }
        if (elapsed >= 4000) { stop(); return; }
        frame = win.requestAnimationFrame(drag);
      };
      frame = win.requestAnimationFrame(drag);
    })();
  };
  const play = () => run();

  const finishDrag = async (token: number) => {
    if (!alive(token)) return;
    await reorder.guideDrop();
    lifting = false;
    if (!alive(token)) return;
    if (!await animate({ scale: 1 }, 120, token)) return;
    imageBlock.classList.remove('is-dev-section-controls-visible');
    if (!await tap(center(revertButton), () => revertButton.click(), token)) return;
    if (!await wait(500, token)) return;
    await animate({ opacity: 0 }, 250, token);
  };

  const interrupt = (event: Event) => { if ((event as Event & { isTrusted?: boolean }).isTrusted) { autoStarted = true; stop(); } };
  document.addEventListener('pointermove', interrupt, { signal, capture: true });
  document.addEventListener('pointerdown', interrupt, { signal, capture: true });
  document.addEventListener('wheel', interrupt, { signal, capture: true, passive: true });
  document.addEventListener('keydown', interrupt, { signal, capture: true });
  root.addEventListener('pointerleave', interrupt, { signal });
  win.addEventListener('resize', interrupt, { signal });
  win.addEventListener('pagehide', interrupt, { signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); }, { signal });

  const observer = win.IntersectionObserver ? new win.IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && !autoStarted) run();
    if (entries.some((entry) => !entry.isIntersecting)) stop();
  }, { threshold: 0.1 }) : undefined;
  observer?.observe(root.closest<HTMLElement>('[data-page-viewport]') ?? root);
  reducedMotion.addEventListener?.('change', stop, { signal });

  return {
    play,
    stop,
    destroy() { if (destroyed) return; destroyed = true; stop(); observer?.disconnect(); lifecycle.abort(); cursorState.opacity = 0; paint(); },
  };
}
