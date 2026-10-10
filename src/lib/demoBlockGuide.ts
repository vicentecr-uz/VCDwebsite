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
  const restingScale = 1.15;
  const pressedScale = 0.95;
  let generation = 0;
  let frame: number | null = null;
  let timer: ReturnType<typeof win.setTimeout> | undefined;
  let lifting = false;
  let dropStarted = false;
  let active = false;
  let destroyed = false;
  let autoStarted = false;
  let pendingResolve: ((value: boolean) => void) | undefined;
  let cursorState: CursorState = { x: 0, y: 0, scale: restingScale, opacity: 0 };

  cursor.setAttribute('aria-hidden', 'true');

  const cursorMode = (point: Point): 'arrow' | 'pointer' | 'grab' | 'grabbing' => {
    if (lifting && !dropStarted) return 'grabbing';
    const hit = document.elementFromPoint?.(point.x, point.y);
    if (!hit || !win.getComputedStyle) return 'arrow';
    const cssCursor = win.getComputedStyle(hit).cursor;
    if (cssCursor === 'pointer') return 'pointer';
    if (cssCursor === 'grab') return 'grab';
    if (cssCursor === 'grabbing') return 'grabbing';
    return 'arrow';
  };
  const paint = () => {
    cursor.style.opacity = String(cursorState.opacity);
    const mode = cursorMode(cursorState);
    cursor.dataset.cursorState = mode;
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
  const gutterEntry = (gap: Point): Point => {
    const box = viewport();
    const image = imageBlock.getBoundingClientRect();
    return {
      x: Math.min(box.right - 16, Math.max(box.left + 16, (box.left + image.left) / 2)),
      y: Math.min(box.bottom - 64, Math.max(box.top + 64, gap.y + 64)),
    };
  };
  const smootherstep = (progress: number) => {
    const t = Math.min(1, Math.max(0, progress));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const animate = (to: Partial<CursorState>, duration: number, token: number) => new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    const from = { ...cursorState };
    const started = win.performance.now();
    const tick = (now: number) => {
      if (!alive(token)) { pendingResolve = undefined; resolve(false); return; }
      const progress = Math.min(1, (now - started) / duration);
      const eased = smootherstep(progress);
      for (const key of ['x', 'y', 'scale', 'opacity'] as const) {
        if (to[key] !== undefined) cursorState[key] = from[key] + (to[key]! - from[key]) * eased;
      }
      paint();
      if (progress < 1) frame = win.requestAnimationFrame(tick);
      else { frame = null; pendingResolve = undefined; resolve(true); }
    };
    frame = win.requestAnimationFrame(tick);
  });
  const move = (point: Point, token: number, opacity?: number) => new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    const from = { ...cursorState };
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (distance < 1) { pendingResolve = undefined; resolve(true); return; }
    const duration = Math.min(1200, Math.max(500, 400 + distance * 0.9));
    const started = win.performance.now();
    const magnitude = Math.min(18, Math.max(4, distance * 0.04));
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const length = Math.max(1, distance);
    const control = { x: (from.x + point.x) / 2 - (dy / length) * magnitude, y: (from.y + point.y) / 2 + (dx / length) * magnitude };
    const overshoot = distance > 80 ? Math.min(12, Math.max(4, distance * 0.025)) : 0;
    const tick = (now: number) => {
      if (!alive(token)) { pendingResolve = undefined; resolve(false); return; }
      const progress = Math.min(1, (now - started) / duration);
      const pathProgress = overshoot > 0
        ? progress < 0.8
          ? (1 + overshoot / distance) * smootherstep(progress / 0.8)
          : 1 + (overshoot / distance) * (1 - smootherstep((progress - 0.8) / 0.2))
        : smootherstep(progress);
      const inverse = 1 - pathProgress;
      cursorState.x = inverse * inverse * from.x + 2 * inverse * pathProgress * control.x + pathProgress * pathProgress * point.x;
      cursorState.y = inverse * inverse * from.y + 2 * inverse * pathProgress * control.y + pathProgress * pathProgress * point.y;
      if (opacity !== undefined) cursorState.opacity = from.opacity + (opacity - from.opacity) * smootherstep(progress);
      paint();
      if (progress < 1) frame = win.requestAnimationFrame(tick);
      else { frame = null; pendingResolve = undefined; resolve(true); }
    };
    frame = win.requestAnimationFrame(tick);
  });
  const tap = async (point: Point, action: () => void, token: number, dwell: number) => {
    if (!await move(point, token) || !await wait(dwell, token)) return false;
    if (!await animate({ scale: pressedScale }, 90, token)) return false;
    action();
    if (!await wait(120, token)) return false;
    return animate({ scale: restingScale }, 120, token);
  };
  const gapPill = () => imageBlock.querySelector<HTMLElement>('.dev-gap-toolbar__pill');
  const gapChoice = () => imageBlock.querySelector<HTMLButtonElement>('[data-dev-spacing-option="group"]')
    ?? imageBlock.querySelector<HTMLButtonElement>('[data-dev-spacing-option]');

  const stop = () => {
    if (!active) return;
    active = false;
    pendingResolve?.(false);
    pendingResolve = undefined;
    generation += 1;
    stopFrame();
    stopTimer();
    if (lifting) reorder.cancel();
    lifting = false;
    dropStarted = false;
    gaps.hide();
    imageBlock.classList.remove('is-dev-section-controls-visible');
    cursorState.opacity = 0;
    paint();
  };

  const run = () => {
    if (destroyed) return;
    autoStarted = true;
    if (active) stop();
    active = true;
    const token = ++generation;
    void (async () => {
      const image = imageBlock.querySelector<HTMLImageElement>('img');
      await image?.decode?.().catch(() => {});
      await document.fonts?.ready;
      if (!alive(token)) return;
      const pill = gapPill();
      if (!pill) return;
      const start = center(pill);
      cursorState = { ...start, scale: restingScale, opacity: 0 };
      paint();
      if (reducedMotion.matches) {
        if (!await animate({ opacity: 1 }, 280, token)) return;
        if (!await wait(700, token)) return;
        if (await animate({ opacity: 0 }, 250, token)) active = false;
        return;
      }
      if (!await wait(600, token)) return;
      const startOffset = gutterEntry(start);
      cursorState = { ...startOffset, scale: restingScale, opacity: 0 };
      paint();
      if (!await move(center(pill), token, 1)) return;
      gaps.reveal(imageBlock);
      if (!await wait(250, token)) return;
      const choice = gapChoice();
      if (!choice || !await tap(center(choice), () => choice.click(), token, 110)) return;
      if (!await wait(350, token)) return;
      gaps.hide();
      imageBlock.classList.add('is-dev-section-controls-visible');
      const handle = imageBlock.querySelector<HTMLElement>('[data-reorder-demo-handle], .dev-section-drag-handle');
      if (!handle || !await move(center(handle), token)) return;
      const grab = center(handle);
      if (!await animate({ scale: pressedScale }, 90, token)) return;
      const imageRect = imageBlock.getBoundingClientRect();
      const marginTop = Number.parseFloat(win.getComputedStyle(imageBlock).marginTop);
      const grabOffset = Math.max(0, grab.y - imageRect.top);
      const clearance = Math.max(96, grabOffset + (Number.isFinite(marginTop) ? marginTop : 0));
      if (!reorder.guideLift(imageBlock, grab.x, grab.y)) return;
      lifting = true;
      const started = win.performance.now();
      let previous = started;
      let current = { ...grab };
      const drag = (now: number): void => {
        if (!alive(token)) return;
        const text = textBlock.getBoundingClientRect();
        const elapsed = now - started;
        const travel = Math.min(1, elapsed / 1800);
        const target = clampToViewport({ x: grab.x, y: text.bottom + clearance });
        const destination = clampToViewport({ x: grab.x + (target.x - grab.x) * travel, y: grab.y + (target.y - grab.y) * smootherstep(travel) });
        const blend = 1 - Math.exp(-Math.max(0, now - previous) / 80);
        current = { x: current.x + (destination.x - current.x) * blend, y: current.y + (destination.y - current.y) * blend };
        const point = current;
        previous = now;
        reorder.guideMove(point.x, point.y);
        cursorState.x = point.x; cursorState.y = point.y; paint();
        if (elapsed >= 1800 && Math.hypot(point.x - target.x, point.y - target.y) <= 3 && point.y >= text.bottom + Math.min(96, clearance) - 3) {
          frame = null;
          void (async () => { if (await wait(180, token)) await finishDrag(token); })();
          return;
        }
        if (elapsed >= 4000) { stop(); return; }
        frame = win.requestAnimationFrame(drag);
      };
      frame = win.requestAnimationFrame(drag);
    })();
  };
  const play = () => run();

  const finishDrag = async (token: number) => {
    if (!alive(token)) return;
    dropStarted = true;
    const [released] = await Promise.all([
      animate({ scale: restingScale }, 120, token),
      reorder.guideDrop(),
    ]);
    if (!alive(token) || !released) return;
    lifting = false;
    dropStarted = false;
    imageBlock.classList.remove('is-dev-section-controls-visible');
    if (!await wait(300, token)) return;
    if (!await tap(center(revertButton), () => revertButton.click(), token, 160)) return;
    if (!await wait(500, token)) return;
    if (await animate({ opacity: 0 }, 250, token)) active = false;
  };

  const interrupt = (event: Event) => { if (active && (event as Event & { isTrusted?: boolean }).isTrusted) { autoStarted = true; stop(); } };
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
