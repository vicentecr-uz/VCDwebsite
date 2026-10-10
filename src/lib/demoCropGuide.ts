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
}

type Point = { x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const gestureEase = CustomEase.create('demoCropGesture', '0.4,0,0.2,1');
const repositionEase = CustomEase.create('demoCropReposition', '0.32,0.72,0,1');

export function createDemoCropGuide({ root, host, trigger, fingers, crop, onFinish }: DemoCropGuideOptions) {
  const document = root.ownerDocument;
  const win = document.defaultView!;
  const lifecycle = new win.AbortController();
  const { signal } = lifecycle;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = document.createElement('div');
  overlay.className = 'hint demo-crop-guide';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:visible;';
  fingers.forEach((finger) => { finger.classList.add('hint-pointer'); finger.setAttribute('aria-hidden', 'true'); overlay.append(finger); });
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
  const hide = () => { overlay.hidden = true; overlay.classList.remove('is-visible'); fingers.forEach((finger) => { finger.style.opacity = '0'; finger.style.willChange = ''; }); };
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
  const framePoint = (): Point => { const rect = host.getBoundingClientRect(); return { x: rect.left + rect.width * 0.34, y: rect.top + rect.height * 0.34 }; };
  const stop = () => {
    if (!active) return;
    active = false; generation += 1; clearMotion(); hide();
  };
  const play = () => {
    if (destroyed || reducedMotion.matches) return;
    stop(); active = true; const token = ++generation;
    overlay.hidden = false; overlay.classList.add('is-visible'); fingers.forEach((finger) => { finger.style.willChange = 'transform, opacity'; });
    void (async () => {
      if (!await wait(200, token)) return;
      const start = framePoint();
      paint(fingers[0], start, 0);
      if (!await animate(280, (t) => paint(fingers[0], start, gestureEase(t)), token)) return;
      if (!await wait(160, token)) return;
      if (!await animate(120, (t) => paint(fingers[0], start, 1, 1 - 0.12 * gestureEase(t)), token)) return;
      if (!await wait(120, token)) return;
      const frameRect = host.getBoundingClientRect();
      let previous = { x: 0, y: 0 };
      let panEnd = start;
      if (!await animate(900, (t) => {
        const p = gestureEase(t); const bow = Math.sin(Math.PI * p) * 0.018;
        const dx = 0.08 * p + bow; const dy = 0.045 * p - bow;
        crop.panBy(dx - previous.x, dy - previous.y); previous = { x: dx, y: dy };
        panEnd = { x: start.x + frameRect.width * dx, y: start.y + frameRect.height * dy };
        paint(fingers[0], panEnd, 1, 0.88);
      }, token)) return;
      if (!await animate(120, (t) => paint(fingers[0], panEnd, 1, 0.88 + 0.12 * gestureEase(t)), token)) return;
      if (!await wait(180, token)) return;
      const midpoint = panEnd;
      const pinchOffset = 28;
      const rightAnchor = { x: midpoint.x + pinchOffset, y: midpoint.y };
      paint(fingers[1], rightAnchor, 0);
      if (!await animate(160, (t) => paint(fingers[0], { x: panEnd.x - pinchOffset * gestureEase(t), y: panEnd.y }, 1), token)) return;
      if (!await animate(200, (t) => paint(fingers[1], rightAnchor, gestureEase(t)), token)) return;
      const centerX = clamp((midpoint.x - frameRect.left) / frameRect.width, 0, 1);
      const centerY = clamp((midpoint.y - frameRect.top) / frameRect.height, 0, 1);
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
  return { play, stop, destroy() { if (destroyed) return; destroyed = true; stop(); lifecycle.abort(); overlay.remove(); } };
}
