import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/CropFrameDemo.astro', import.meta.url), 'utf8')
  .split('<script>')[1].split('</script>')[0]
  .replaceAll('import.meta.env.DEV', 'false')
  .replace(/^\s*import .*?;\s*$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};

function setup(options: { imageComplete?: boolean; imageDecodePending?: boolean; imageError?: boolean; missingHost?: boolean } = {}) {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<div id="transition-overlay" data-vcd-initial-reveal="running"></div><vcd-crop-frame-demo>
    <div class="crop-frame-demo__layout"><div class="crop-frame-demo__panel"><div data-crop-panel class="dev-overlay is-dev-overlay-open">
      <header data-drag-handle><button data-drag-ignore data-minimize-toggle aria-expanded="true"></button><button data-drag-ignore data-hide-toggle></button></header>
      <div data-overlay-body><button>Crop control</button><button data-crop-replace-assets>Asset manager</button><button data-demo-author-reset>Reset</button><button data-demo-author-revert>Revert</button></div>
    </div></div>
    <button data-crop-viewport="desktop" aria-pressed="false"></button><button data-crop-viewport="tablet" aria-pressed="false"></button><button data-crop-viewport="mobile" aria-pressed="false"></button>
    <div class="crop-frame-demo__preview-column"><div class="crop-frame-demo__preview-shell"><iframe></iframe></div></div></div>
    ${options.missingHost ? '' : '<div class="project-image"><img src="/source.jpg"></div>'}
    <div data-demo-asset-picker hidden></div>
  </vcd-crop-frame-demo>`;
  const frame = document.querySelector('iframe') as HTMLIFrameElement;
  const overlay = document.getElementById('transition-overlay') as HTMLElement;
  const frameHost = document.querySelector('.project-image') as HTMLElement | null;
  if (frameHost) frame.contentDocument!.body.append(frameHost);
  const parentFonts = deferred();
  const childFonts = deferred();
  Object.defineProperty(document, 'fonts', { value: { ready: parentFonts.promise, [Symbol.iterator]: function* () {} }, configurable: true });
  if (frame.contentDocument) Object.defineProperty(frame.contentDocument, 'fonts', { value: { ready: childFonts.promise, [Symbol.iterator]: function* () {} }, configurable: true });
  const demoButtons = [...document.querySelectorAll<HTMLElement>('[data-crop-viewport]')];
  const media = { matches: true, listeners: [] as Array<() => void>, addEventListener(_: string, listener: () => void) { this.listeners.push(listener); }, removeEventListener() {} };
  win.matchMedia = (() => media) as typeof win.matchMedia;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  win.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay !== 2000) throw new Error(`unexpected timer delay: ${delay}`);
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof win.clearTimeout;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  win.requestAnimationFrame = ((callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; }) as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = ((id: number) => { frames.delete(id); }) as typeof win.cancelAnimationFrame;
  const cropImages = deferred<void>();
  let imageDecodeCalls = 0;
  let cropActive = true;
  let cropReset = 0;
  let cropDestroyed = 0;
  let replacementReset = 0;
  let replacementDestroyed = 0;
  let cropCreated = 0;
  const errors: ErrorEvent[] = [];
  win.addEventListener('error', (event) => errors.push(event));
  let selectedViewport = 'desktop';
  let dragCreated = 0;
  let dragCleaned = 0;
  let collapseDestroyed = 0;
  const collapseSets: Array<[boolean, boolean | undefined]> = [];
  const resizeCallbacks: Array<() => void> = [];
  let resizeDisconnects = 0;
  const intersections: Array<{ callback: (entries: Array<{ isIntersecting: boolean }>) => void; observed: Element | undefined }> = [];
  let guidePlay = 0;
  let guideStop = 0;
  let guideDestroy = 0;
  let guideFinish: (() => void) | undefined;
  let guideOptions: { iframe?: HTMLIFrameElement; trigger?: Element } | undefined;
  let cropImage: HTMLImageElement | undefined;
  let ghostImage: HTMLImageElement | undefined;
  let revertClicks = 0;
  const setupOptions = options;
  const env = {
    HTMLElement: win.HTMLElement,
    customElements: win.customElements,
    document,
    window: win,
    Event: win.Event,
    AbortController: win.AbortController,
    IntersectionObserver: class {
      callback: (entries: Array<{ isIntersecting: boolean }>) => void;
      observed: Element | undefined;
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { this.callback = callback; intersections.push(this); }
      observe(element: Element) { this.observed = element; }
      disconnect() {}
    },
    ResizeObserver: class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} unobserve() {} disconnect() { resizeDisconnects += 1; } },
    createDemoImageCrop: (cropOptions: { host: HTMLElement }) => { cropCreated += 1;
      const image = cropOptions.host.querySelector<HTMLImageElement>('.project-crop-clip img') ?? document.createElement('img');
      cropImage = image;
      Object.defineProperty(image, 'complete', { configurable: true, value: setupOptions.imageComplete ?? true });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: setupOptions.imageError ? 0 : 300 });
      image.decode = () => { imageDecodeCalls += 1; return setupOptions.imageDecodePending ? cropImages.promise : Promise.resolve(); };
      const ghost = document.createElement('div'); ghost.className = 'dev-crop-ghost'; const nextGhostImage = document.createElement('img');
      ghostImage = nextGhostImage;
      Object.defineProperty(nextGhostImage, 'complete', { configurable: true, value: setupOptions.imageComplete ?? true }); Object.defineProperty(nextGhostImage, 'naturalWidth', { configurable: true, value: setupOptions.imageError ? 0 : 300 });
      nextGhostImage.decode = () => { imageDecodeCalls += 1; return setupOptions.imageDecodePending ? cropImages.promise : Promise.resolve(); }; ghost.append(nextGhostImage); cropOptions.host.append(ghost);
      if (!image.parentElement) { const clip = document.createElement('div'); clip.className = 'project-crop-clip'; clip.append(image); cropOptions.host.append(clip); }
      if (!setupOptions.imageDecodePending) cropImages.resolve();
      return ({
      reset() { cropReset += 1; },
      getState() { return { source: { src: '/source.jpg', width: 1, height: 1, alt: '' }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true }; },
      restore() { return true; },
      setViewport(value: string) { selectedViewport = value; },
      getViewport() { return selectedViewport; },
      setActive(value: boolean) { cropActive = value; },
      whenReady() { return Promise.resolve(true); },
      destroy() { cropDestroyed += 1; },
    }); },
    createDemoImageReplacement: () => ({
      reset() { replacementReset += 1; },
      destroy() { replacementDestroyed += 1; },
    }),
    createDemoAssetPicker: () => ({ open: async () => undefined, destroy() {} }),
    createDemoImageViewport: () => ({ setViewport(value: string) { selectedViewport = value; demoButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cropViewport === value))); }, getViewport() { return selectedViewport; }, destroy() {} }),
    createDevPanelDrag: () => { dragCreated += 1; return () => { dragCleaned += 1; }; },
    createDemoCropGuide: (options: { onFinish: () => void; iframe?: HTMLIFrameElement; trigger?: Element }) => { guideOptions = options; return ({ play() { guidePlay += 1; guideFinish = options.onFinish; }, stop() { guideStop += 1; }, destroy() { guideDestroy += 1; } }); },
    createDevPanelCollapse: (panel: HTMLElement) => ({
      set(value: boolean, animate?: boolean) {
        collapseSets.push([value, animate]);
        panel.classList.toggle('is-minimized', value);
        panel.querySelector('[data-minimize-toggle]')?.setAttribute('aria-expanded', String(!value));
      },
      destroy() { collapseDestroyed += 1; },
    }),
  };
  new Function('env', `with (env) { ${compiled} }`)(env);
  frame.dispatchEvent(new win.Event('load'));
  const demo = document.querySelector('vcd-crop-frame-demo') as HTMLElement;
  const panel = demo.querySelector('[data-crop-panel]') as HTMLElement;
  const hide = panel.querySelector('[data-hide-toggle]') as HTMLButtonElement;
  const minimize = panel.querySelector('[data-minimize-toggle]') as HTMLButtonElement;
  const reset = demo.querySelector('[data-demo-author-reset]') as HTMLButtonElement;
  const revert = panel.querySelector('[data-demo-author-revert]') as HTMLButtonElement;
  revert.addEventListener('click', () => { revertClicks += 1; });
  return { win, document, overlay, demo, panel, frame, layout: demo.querySelector('.crop-frame-demo__layout') as HTMLElement, previewColumn: demo.querySelector('.crop-frame-demo__preview-column') as HTMLElement, frameHost, media, resizeCallbacks, intersections, frames, parentFonts, childFonts, cropImages, get cropImage() { return cropImage; }, get ghostImage() { return ghostImage; }, get imageDecodeCalls() { return imageDecodeCalls; }, get revertClicks() { return revertClicks; }, get guideOptions() { return guideOptions; }, get resizeDisconnects() { return resizeDisconnects; }, hide, minimize, reset, timers, flushTimer: (id: number) => timers.get(id)?.(), driveFrames: async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); await Promise.resolve(); await Promise.resolve(); }, fireGuideFinish: () => guideFinish?.(), get guidePlay() { return guidePlay; }, get guideStop() { return guideStop; }, get guideDestroy() { return guideDestroy; }, errors, get dragCreated() { return dragCreated; }, get dragCleaned() { return dragCleaned; }, get cropCreated() { return cropCreated; }, get cropActive() { return cropActive; }, get cropReset() { return cropReset; }, get cropDestroyed() { return cropDestroyed; }, get replacementReset() { return replacementReset; }, get replacementDestroyed() { return replacementDestroyed; }, get collapseDestroyed() { return collapseDestroyed; }, get selectedViewport() { return selectedViewport; }, collapseSets };
}

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

async function finishResources(h: ReturnType<typeof setup>) {
  await flush();
  h.parentFonts.resolve(); h.childFonts.resolve();
  await flush(); await h.driveFrames(); await flush(); await h.driveFrames(); await flush(); await h.driveFrames(); await flush();
}

test('minimize light toggles the real collapse controller', () => {
  const h = setup();
  h.minimize.click();
  expect(h.panel.classList.contains('is-minimized')).toBe(true);
  expect(h.collapseSets.at(-1)).toEqual([true, undefined]);
  h.minimize.click();
  expect(h.panel.classList.contains('is-minimized')).toBe(false);
  expect(h.collapseSets.at(-1)).toEqual([false, undefined]);
});

test('hide makes the panel inert and reopens exactly after 2000ms', () => {
  const h = setup();
  h.minimize.click();
  h.hide.click();
  expect(h.panel.inert).toBe(true);
  expect(h.panel.classList.contains('is-dev-overlay-open')).toBe(false);
  expect(h.cropActive).toBe(false);
  expect(h.timers.size).toBe(1);
  const timer = [...h.timers.keys()][0];
  h.flushTimer(timer);
  expect(h.panel.inert).toBe(false);
  expect(h.panel.classList.contains('is-dev-overlay-open')).toBe(true);
  expect(h.panel.classList.contains('is-minimized')).toBe(false);
  expect(h.cropActive).toBe(true);
  expect(h.collapseSets.at(-1)).toEqual([false, false]);
});

test('reset cancels a scheduled reopen and expands panel alongside the action controller', () => {
  const h = setup();
  h.hide.click();
  expect(h.timers.size).toBe(1);
  h.reset.click();
  expect(h.timers.size).toBe(0);
  expect(h.replacementReset).toBe(0);
  expect(h.panel.inert).toBe(false);
  expect(h.panel.classList.contains('is-dev-overlay-open')).toBe(true);
  expect(h.cropActive).toBe(true);
  expect(h.collapseSets.at(-1)).toEqual([false, undefined]);
});

test('disconnect aborts handlers, clears timers, and destroys all controllers', () => {
  const h = setup();
  h.hide.click();
  expect(h.timers.size).toBe(1);
  h.demo.remove();
  expect(h.timers.size).toBe(0);
  expect(h.collapseDestroyed).toBe(1);
  expect(h.replacementDestroyed).toBe(1);
  expect(h.cropDestroyed).toBe(1);
  expect(h.errors).toEqual([]);
  const before = h.replacementReset;
  h.reset.click();
  expect(h.replacementReset).toBe(before);
});

test('viewport selector forwards choices and keeps one active state', () => {
  const h = setup();
  const tablet = h.demo.querySelector('[data-crop-viewport="tablet"]') as HTMLButtonElement;
  tablet.click();
  expect(h.selectedViewport).toBe('tablet');
  expect(tablet.getAttribute('aria-pressed')).toBe('true');
});

test('repeated iframe readiness does not recreate the same host crop', () => {
  const h = setup();
  expect(h.cropCreated).toBe(1);
  h.frame.dispatchEvent(new h.win.Event('load'));
  expect(h.cropCreated).toBe(1);
  expect(h.errors).toEqual([]);
});

test('desktop and narrow mode changes clean up and recreate panel dragging', () => {
  const h = setup();
  expect(h.dragCreated).toBe(1);
  h.media.matches = false;
  h.media.listeners.forEach((listener) => listener());
  expect(h.dragCleaned).toBe(1);
  expect(h.panel.style.position).toBe('relative');
  expect(h.panel.style.left).toBe('0px');
  h.media.matches = true;
  h.media.listeners.forEach((listener) => listener());
  expect(h.dragCreated).toBe(2);
  expect(h.panel.style.position).toBe('absolute');
  h.demo.remove();
  expect(h.dragCleaned).toBe(2);
});

test('panel alignment follows iframe image geometry until a real header drag', () => {
  const h = setup();
  const pointer = (clientX: number, clientY: number) => { const event = new h.win.Event('pointerdown', { bubbles: true, cancelable: true }) as PointerEvent; Object.defineProperties(event, { button: { value: 0 }, isPrimary: { value: true }, pointerId: { value: 2 }, clientX: { value: clientX }, clientY: { value: clientY } }); return event; };
  const header = h.panel.querySelector('[data-drag-handle]') as HTMLElement;
  const traffic = h.panel.querySelector('[data-drag-ignore]') as HTMLButtonElement;
  const frame = h.frame;
  Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: 1000 });
  frame.getBoundingClientRect = () => ({ top: 100, left: 0, width: 500, height: 450 } as DOMRect);
  h.layout.getBoundingClientRect = () => ({ top: 100, left: 0, width: 800, height: 900 } as DOMRect);
  h.frameHost.getBoundingClientRect = () => ({ top: 200, left: 0, width: 300, height: 300 } as DOMRect);
  h.panel.getBoundingClientRect = () => ({ top: 150, left: 0, width: 320, height: 200 } as DOMRect);
  header.getBoundingClientRect = () => ({ top: 150, bottom: 190, left: 0, width: 320, height: 40 } as DOMRect);
  h.resizeCallbacks.at(-1)?.();
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('60px');
  h.frameHost.getBoundingClientRect = () => ({ top: 240, left: 0, width: 300, height: 300 } as DOMRect);
  h.resizeCallbacks.at(-1)?.();
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('80px');
  traffic.dispatchEvent(pointer(10, 10));
  h.frameHost.getBoundingClientRect = () => ({ top: 320, left: 0, width: 300, height: 300 } as DOMRect);
  h.resizeCallbacks.at(-1)?.();
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('120px');
  header.dispatchEvent(pointer(10, 10));
  h.frameHost.getBoundingClientRect = () => ({ top: 360, left: 0, width: 300, height: 300 } as DOMRect);
  h.resizeCallbacks.at(-1)?.();
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('120px');
  h.media.matches = false;
  h.media.listeners.forEach((listener) => listener());
  h.media.matches = true;
  h.media.listeners.forEach((listener) => listener());
  h.frameHost.getBoundingClientRect = () => ({ top: 300, left: 0, width: 300, height: 300 } as DOMRect);
  h.resizeCallbacks.at(-1)?.();
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('110px');
  h.demo.remove();
  expect(h.resizeDisconnects).toBeGreaterThan(0);
});

test('readiness waits for visible crop and ghost images, decode, fonts, and two paint frames', async () => {
  const h = setup({ imageComplete: false, imageDecodePending: true });
  expect(h.demo.dataset.pageRevealReady).toBe('false');
  await flush();
  h.parentFonts.resolve(); h.childFonts.resolve();
  h.cropImage?.dispatchEvent(new h.win.Event('load'));
  h.ghostImage?.dispatchEvent(new h.win.Event('load'));
  await flush();
  expect(h.demo.dataset.pageRevealReady).toBe('false');
  expect(h.frames.size).toBe(0);
  h.cropImages.resolve(); await flush();
  expect(h.frames.size).toBeGreaterThan(0);
  await h.driveFrames();
  expect(h.demo.dataset.pageRevealReady).toBe('false');
  await h.driveFrames();
  expect(h.demo.dataset.pageRevealReady).toBe('true');
  expect(h.intersections.length).toBe(1);
  expect(h.imageDecodeCalls).toBe(2);
});

test('already-loaded crop images still wait for decode and measure geometry before readiness', async () => {
  const h = setup({ imageDecodePending: true });
  await flush();
  h.frame.getBoundingClientRect = () => ({ top: 100, left: 0, width: 500, height: 450 } as DOMRect);
  Object.defineProperty(h.frame, 'offsetWidth', { configurable: true, value: 1000 });
  h.layout.getBoundingClientRect = () => ({ top: 100, left: 0, width: 800, height: 900 } as DOMRect);
  h.frameHost!.getBoundingClientRect = () => ({ top: 200, left: 0, width: 300, height: 300 } as DOMRect);
  h.panel.getBoundingClientRect = () => ({ top: 150, left: 0, width: 320, height: 200 } as DOMRect);
  h.panel.querySelector('[data-drag-handle]')!.getBoundingClientRect = () => ({ top: 150, bottom: 190, left: 0, width: 320, height: 40 } as DOMRect);
  h.parentFonts.resolve(); h.childFonts.resolve(); await flush();
  expect(h.demo.dataset.pageRevealReady).toBe('false');
  expect(h.imageDecodeCalls).toBe(2);
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('');
  h.cropImages.resolve(); await flush(); await h.driveFrames(); await h.driveFrames();
  expect(h.demo.dataset.pageRevealReady).toBe('true');
  expect(h.intersections.length).toBe(1);
  expect(h.layout.style.getPropertyValue('--crop-panel-top')).toBe('60px');
});

test('abort before image readiness never publishes or creates a guide', async () => {
  const h = setup({ imageComplete: false, imageDecodePending: true }); await flush();
  h.demo.remove(); h.cropImages.resolve(); h.parentFonts.resolve(); h.childFonts.resolve(); await flush();
  expect(h.demo.dataset.pageRevealReady).toBe('false');
  expect(h.guidePlay).toBe(0);
});

test('abort between the two paint frames never publishes or creates a guide', async () => {
  const h = setup(); await flush(); h.parentFonts.resolve(); h.childFonts.resolve(); await flush();
  await h.driveFrames(); h.demo.remove(); await h.driveFrames(); await flush();
  expect(h.demo.dataset.pageRevealReady).toBe('false');
  expect(h.guidePlay).toBe(0);
});

test('image errors and missing iframe hosts release the veil without stranding the panel', async () => {
  const failed = setup({ imageError: true }); failed.parentFonts.resolve(); failed.childFonts.resolve(); await flush();
  expect(failed.demo.dataset.pageRevealReady).toBe('true');
  const missing = setup({ missingHost: true }); await flush();
  expect(missing.demo.dataset.pageRevealReady).toBe('true');
});

test('autoplay waits for resources, reveal completion, and one intersection', async () => {
  const h = setup(); await finishResources(h);
  expect(h.demo.dataset.pageRevealReady).toBe('true');
  expect(h.guidePlay).toBe(0);
  h.overlay.dataset.vcdInitialReveal = 'complete';
  h.overlay.hidden = true;
  h.win.dispatchEvent(new h.win.Event('vcd:initial-reveal-complete'));
  h.intersections.at(-1)?.callback([{ isIntersecting: true }]);
  expect(h.guidePlay).toBe(1);
  h.overlay.dispatchEvent(new h.win.Event('vcd:initial-reveal-complete'));
  h.intersections.at(-1)?.callback([{ isIntersecting: true }]);
  expect(h.guidePlay).toBe(1);
});

test('trusted parent input suppresses autoplay before image readiness', async () => {
  const h = setup({ imageDecodePending: true });
  const trusted = new h.win.Event('pointerdown', { bubbles: true }); Object.defineProperty(trusted, 'isTrusted', { value: true });
  h.document.dispatchEvent(trusted);
  h.cropImages.resolve(); await finishResources(h);
  h.overlay.dataset.vcdInitialReveal = 'complete';
  h.overlay.hidden = true;
  h.win.dispatchEvent(new h.win.Event('vcd:initial-reveal-complete'));
  h.intersections.at(-1)?.callback([{ isIntersecting: true }]);
  expect(h.guidePlay).toBe(0);
});

test('trusted iframe input suppresses autoplay before image readiness', async () => {
  const h = setup({ imageDecodePending: true });
  const childEvent = new h.win.Event('pointerdown', { bubbles: true }); Object.defineProperty(childEvent, 'isTrusted', { value: true });
  h.frame.contentDocument?.dispatchEvent(childEvent);
  h.cropImages.resolve(); await finishResources(h);
  h.overlay.dataset.vcdInitialReveal = 'complete';
  h.overlay.hidden = true;
  h.win.dispatchEvent(new h.win.Event('vcd:initial-reveal-complete'));
  h.intersections.at(-1)?.callback([{ isIntersecting: true }]);
  expect(h.guidePlay).toBe(0);
});

test('guide finish invokes the real Revert handler and manual controls stop it', async () => {
  const h = setup(); await finishResources(h);
  expect(h.demo.dataset.pageRevealReady).toBe('true');
  h.overlay.dataset.vcdInitialReveal = 'complete';
  h.overlay.hidden = true;
  h.win.dispatchEvent(new h.win.Event('vcd:initial-reveal-complete'));
  h.intersections.at(-1)?.callback([{ isIntersecting: true }]);
  expect(h.guideOptions?.iframe).toBe(h.frame);
  expect(h.guideOptions?.trigger).toBe(h.panel.querySelector('[data-demo-author-revert]'));
  h.fireGuideFinish();
  expect(h.revertClicks).toBe(1);
  h.hide.click(); h.minimize.click(); h.reset.click();
  expect(h.guideStop).toBeGreaterThanOrEqual(3);
  h.media.matches = false; h.media.listeners.forEach((listener) => listener());
  expect(h.guideStop).toBeGreaterThanOrEqual(4);
});
