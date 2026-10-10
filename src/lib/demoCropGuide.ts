import type { createDemoImageCrop } from './demoImageCrop';
import { CustomEase } from 'gsap/CustomEase';
import gsap from 'gsap';

gsap.registerPlugin(CustomEase);

interface DemoCropGuideOptions {
  root: HTMLElement;
  host: HTMLElement;
  trigger: HTMLElement;
  fingers: [HTMLElement, HTMLElement];
  crop: Pick<ReturnType<typeof createDemoImageCrop>, 'panBy' | 'zoomBy'>;
  onFinish: () => void;
  iframe?: HTMLIFrameElement;
  cursor?: HTMLElement;
}

type Point = { x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const gestureEase = CustomEase.create('demoCropGesture', '0.4,0,0.2,1');
const repositionEase = CustomEase.create('demoCropReposition', '0.32,0.72,0,1');

export function createDemoCropGuide({ root, host, trigger, fingers, crop, onFinish, iframe, cursor }: DemoCropGuideOptions) {
  const document = root.ownerDocument;
  const win = document.defaultView!;
  const lifecycle = new win.AbortController();
  const { signal } = lifecycle;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const childDocument = iframe?.contentDocument;
  const childWindow = iframe?.contentWindow;
  const toParent = (point: Point): Point => {
    if (!iframe || !childWindow) return point;
    const box = iframe.getBoundingClientRect();
    return { x: box.left + point.x * box.width / Math.max(1, iframe.offsetWidth), y: box.top + point.y * box.height / Math.max(1, iframe.offsetHeight) };
  };
  const overlay = document.createElement('div');
  overlay.className = 'hint demo-crop-guide';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:visible;';
  fingers.forEach((finger) => { finger.classList.add('hint-pointer'); finger.setAttribute('aria-hidden', 'true'); overlay.append(finger); });
  cursor?.setAttribute('aria-hidden', 'true');
  if (cursor) overlay.append(cursor);
  document.body.append(overlay);

  let generation = 0;
  let frame: number | null = null;
  let timer: ReturnType<typeof win.setTimeout> | undefined;
  let pendingResolve: ((value: boolean) => void) | undefined;
  let active = false;
  let destroyed = false;
  const alive = (token: number) => !destroyed && active && token === generation && !signal.aborted && root.isConnected;
  const clearMotion = () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    pendingResolve?.(false);
    pendingResolve = undefined;
  };
  const paint = (finger: HTMLElement, point: Point, opacity: number, scale = 1) => {
    finger.style.opacity = String(opacity);
    finger.style.transform = `translate(${point.x}px, ${point.y}px) scale(${scale})`;
  };
  const hide = () => { overlay.hidden = true; overlay.classList.remove('is-visible'); fingers.forEach((finger) => { finger.style.opacity = '0'; finger.style.willChange = ''; }); if (cursor) cursor.style.opacity = '0'; };
  const paintCursor = (point: Point, opacity: number, scale = 1) => { if (!cursor) return; cursor.style.opacity = String(opacity); cursor.style.transform = `translate(${point.x}px, ${point.y}px) scale(${scale})`; };
  const wait = (ms: number, token: number) => new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    timer = win.setTimeout(() => { timer = undefined; pendingResolve = undefined; resolve(alive(token)); }, ms);
  });
  const animate = (duration: number, update: (progress: number) => void, token: number) => new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    const started = win.performance.now();
    const tick = (now: number) => {
      if (!alive(token)) { pendingResolve = undefined; resolve(false); return; }
      const progress = Math.min(1, (now - started) / duration);
      update(progress);
      if (progress < 1) frame = win.requestAnimationFrame(tick);
      else { frame = null; pendingResolve = undefined; resolve(true); }
    };
    frame = win.requestAnimationFrame(tick);
  });
  const pointFor = (element: Element): Point => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; };
  const framePoint = (): Point => { const rect = host.getBoundingClientRect(); return toParent({ x: rect.left + rect.width * 0.34, y: rect.top + rect.height * 0.34 }); };
  const stop = () => {
    if (!active) return;
    active = false; generation += 1; clearMotion(); hide();
  };
  const play = () => {
    if (destroyed || reducedMotion.matches) return;
    stop(); active = true; const token = ++generation;
    overlay.hidden = false; overlay.classList.add('is-visible'); fingers.forEach((finger) => { finger.style.willChange = 'transform, opacity'; });
    void (async () => {
      const coarse = win.matchMedia('(pointer: coarse)').matches;
      if (!await wait(200, token)) return;
      const start = framePoint();
      const panLeft = (point: Point) => coarse ? point : { x: point.x - 36, y: point.y + 6 };
      if (cursor && !coarse) {
        cursor.dataset.cursorState = 'arrow';
        const box = root.getBoundingClientRect();
        paintCursor({ x: Math.max(12, box.left - 40), y: start.y }, 0, 1.15);
        const entryDuration = clamp(700 + Math.hypot(start.x - box.left, start.y - box.top) * 0.3, 700, 1000);
        if (!await animate(entryDuration, (t) => {
          const p = repositionEase(t); const bow = Math.sin(Math.PI * p) * 12;
          const entryX = Math.max(12, box.left - 40);
          paintCursor({ x: entryX + (start.x - entryX) * p, y: start.y + bow }, gestureEase(Math.min(1, t * entryDuration / 160)), 1.15);
        }, token)) return;
        paintCursor(start, 1, 1.15);
      }
      paint(fingers[0], panLeft(start), 0);
      if (!coarse) paint(fingers[1], { x: start.x + 36, y: start.y - 6 }, 0);
      if (!await animate(280, (t) => {
        const opacity = gestureEase(t);
        paint(fingers[0], panLeft(start), opacity);
        if (!coarse) paint(fingers[1], { x: start.x + 36, y: start.y - 6 }, opacity);
        if (cursor && !coarse) paintCursor(start, 1 - opacity, 1.15);
      }, token)) return;
      if (!await wait(160, token)) return;
      if (!await animate(120, (t) => {
        const scale = 1 - 0.12 * gestureEase(t);
        paint(fingers[0], panLeft(start), 1, scale);
        if (!coarse) paint(fingers[1], { x: start.x + 36, y: start.y - 6 }, 1, scale);
      }, token)) return;
      if (!await wait(120, token)) return;
      const frameRect = host.getBoundingClientRect();
      const parentFrameRect = toParent({ x: frameRect.left + frameRect.width, y: frameRect.top + frameRect.height });
      const parentStart = toParent({ x: frameRect.left, y: frameRect.top });
      const displayWidth = parentFrameRect.x - parentStart.x;
      const displayHeight = parentFrameRect.y - parentStart.y;
      let previous = { x: 0, y: 0 };
      let panEnd = start;
      if (!await animate(900, (t) => {
        const p = gestureEase(t); const bow = Math.sin(Math.PI * p) * 0.018;
        const dx = 0.08 * p + bow; const dy = 0.045 * p - bow;
        crop.panBy(dx - previous.x, dy - previous.y); previous = { x: dx, y: dy };
        panEnd = { x: start.x + displayWidth * dx, y: start.y + displayHeight * dy };
        paint(fingers[0], panLeft(panEnd), 1, 0.88);
        if (!coarse) paint(fingers[1], { x: panEnd.x + 36, y: panEnd.y - 6 }, 1, 0.88);
      }, token)) return;
      if (!await animate(120, (t) => {
        const scale = 0.88 + 0.12 * gestureEase(t);
        paint(fingers[0], panLeft(panEnd), 1, scale);
        if (!coarse) paint(fingers[1], { x: panEnd.x + 36, y: panEnd.y - 6 }, 1, scale);
      }, token)) return;
      if (!await wait(180, token)) return;
      const midpoint = panEnd;
      const pinchOffset = 56;
      const rightAnchor = { x: midpoint.x + pinchOffset, y: midpoint.y };
      paint(fingers[1], coarse ? rightAnchor : { x: panEnd.x + 36, y: panEnd.y - 6 }, coarse ? 0 : 1);
      if (!await animate(160, (t) => {
        const p = gestureEase(t);
        paint(fingers[0], { x: panEnd.x - (coarse ? pinchOffset * p : 36 + (pinchOffset - 36) * p), y: panEnd.y + (coarse ? 0 : 6 * (1 - p)) }, 1);
        if (!coarse) paint(fingers[1], { x: panEnd.x + 36 + (pinchOffset - 36) * p, y: panEnd.y - 6 + 6 * p }, 1);
      }, token)) return;
      if (coarse && !await animate(200, (t) => paint(fingers[1], rightAnchor, gestureEase(t)), token)) return;
      const centerX = clamp((midpoint.x - parentStart.x) / displayWidth, 0, 1);
      const centerY = clamp((midpoint.y - parentStart.y) / displayHeight, 0, 1);
      let previousScale = 1;
      if (!await animate(800, (t) => {
        const scale = 1 + 0.12 * gestureEase(t); const factor = scale / previousScale; previousScale = scale;
        crop.zoomBy(factor, centerX, centerY);
        paint(fingers[0], { x: midpoint.x - pinchOffset * scale, y: midpoint.y }, 1);
        paint(fingers[1], { x: midpoint.x + pinchOffset * scale, y: midpoint.y }, 1);
      }, token)) return;
      if (!await wait(200, token)) return;
      const pinchEnd = { x: midpoint.x - pinchOffset * 1.12, y: midpoint.y };
      const rightEnd = { x: midpoint.x + pinchOffset * 1.12, y: midpoint.y };
      if (cursor && !coarse) {
        const target = pointFor(trigger); const distance = Math.hypot(target.x - pinchEnd.x, target.y - pinchEnd.y);
        if (!await animate(200, (t) => { const p = gestureEase(t); paint(fingers[0], pinchEnd, 1 - p); paint(fingers[1], rightEnd, 1 - p); paintCursor(pinchEnd, p, 1.15); }, token)) return;
        if (!await animate(clamp(850 + distance * 0.45, 850, 1250), (t) => {
          const p = t * t * t * (t * (t * 6 - 15) + 10); const bow = Math.sin(Math.PI * p) * Math.min(18, distance * 0.04);
          paintCursor({ x: pinchEnd.x + (target.x - pinchEnd.x) * p - (target.y - pinchEnd.y) / Math.max(1, distance) * bow, y: pinchEnd.y + (target.y - pinchEnd.y) * p + (target.x - pinchEnd.x) / Math.max(1, distance) * bow }, 1, 1.15);
        }, token)) return;
        cursor.dataset.cursorState = 'pointer';
        if (!await wait(180, token)) return;
        if (!await animate(120, (t) => paintCursor(target, 1, 1.15 - 0.2 * gestureEase(t)), token)) return;
        onFinish();
        if (!await wait(120, token)) return;
        await animate(220, (t) => paintCursor(target, 1 - gestureEase(t), 0.95 + 0.2 * gestureEase(t)), token);
        if (alive(token)) { active = false; hide(); }
        return;
      }
      if (!await animate(200, (t) => paint(fingers[1], rightEnd, 1 - gestureEase(t)), token)) return;
      const target = pointFor(trigger); const from = pinchEnd; const distance = Math.hypot(target.x - from.x, target.y - from.y);
      if (!await animate(clamp(700 + distance * 0.35, 700, 1000), (t) => { const p = repositionEase(t); const bow = Math.sin(Math.PI * p) * Math.min(18, distance * 0.04); paint(fingers[0], { x: from.x + (target.x - from.x) * p - (target.y - from.y) / Math.max(1, distance) * bow, y: from.y + (target.y - from.y) * p + (target.x - from.x) / Math.max(1, distance) * bow }, 1); }, token)) return;
      if (!await wait(180, token)) return;
      if (!await animate(120, (t) => paint(fingers[0], target, 1, 1 - 0.12 * gestureEase(t)), token)) return;
      onFinish();
      if (!await wait(120, token)) return;
      await animate(220, (t) => {
        const release = gestureEase(Math.min(1, t / (120 / 220)));
        paint(fingers[0], target, 1 - gestureEase(t), 0.88 + 0.12 * release);
      }, token);
      if (alive(token)) { active = false; hide(); }
    })();
  };
  const interrupt = (event: Event) => { if (active && (event as Event & { isTrusted?: boolean }).isTrusted) stop(); };
  document.addEventListener('pointerdown', interrupt, { signal, capture: true });
  document.addEventListener('wheel', interrupt, { signal, capture: true, passive: true });
  document.addEventListener('scroll', () => stop(), { signal, capture: true, passive: true });
  document.addEventListener('keydown', interrupt, { signal, capture: true });
  win.addEventListener('resize', () => stop(), { signal });
  win.addEventListener('pagehide', () => stop(), { signal });
  reducedMotion.addEventListener?.('change', stop, { signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); }, { signal });
  if (childDocument && childWindow) {
    childDocument.addEventListener('pointerdown', interrupt, { signal, capture: true });
    childDocument.addEventListener('wheel', interrupt, { signal, capture: true, passive: true });
    childDocument.addEventListener('keydown', interrupt, { signal, capture: true });
    childDocument.addEventListener('scroll', () => stop(), { signal, capture: true, passive: true });
    childWindow.addEventListener('resize', () => stop(), { signal });
    childWindow.addEventListener('pagehide', () => stop(), { signal });
    childDocument.addEventListener('visibilitychange', () => { if (childDocument.visibilityState === 'hidden') stop(); }, { signal });
  }
  return { play, stop, destroy() { if (destroyed) return; destroyed = true; stop(); lifecycle.abort(); overlay.remove(); } };
}
