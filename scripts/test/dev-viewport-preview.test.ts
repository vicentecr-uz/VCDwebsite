import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/DevViewportPreview.astro', import.meta.url), 'utf8');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.split('<script>')[1].split('</script>')[0]
  .replace(/^\s*import .*;$/gm, '').replace('import.meta.hot?.dispose(dispose);', 'return dispose;'));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(reduced = false, frameMode = false, idleSupported = true) {
  const window = new Window({ url: 'http://localhost:4358/', settings: { disableIframePageLoading: true } });
  const document = window.document;
  document.documentElement.classList.add('is-dev-mode');
  document.body.innerHTML = `<main><button id="focus">Edit</button></main><div data-dev-viewport-preview hidden>
    <div data-test-backdrop></div><div data-viewport-shadow></div>
    <div data-viewport-surface><iframe data-viewport-frame></iframe></div>
    <div data-viewport-controls>${['desktop', 'tablet', 'mobile'].map(p => `<button data-viewport-preset="${p}">${p}</button>`).join('')}</div></div>`;
  const root = document.querySelector<HTMLElement>('[data-dev-viewport-preview]')!;
  const surface = root.querySelector<HTMLElement>('[data-viewport-surface]')!;
  const frame = root.querySelector<HTMLIFrameElement>('iframe')!;
  const controls = root.querySelector<HTMLElement>('[data-viewport-controls]')!;
  controls.getBoundingClientRect = () => ({ height: 48, top: window.innerHeight - 60 }) as DOMRect;
  const child = new Window({ url: window.location.href });
  Object.defineProperty(frame, 'contentWindow', { value: child });
  Object.defineProperty(frame, 'contentDocument', { value: child.document });
  const outgoing: any[] = [];
  child.postMessage = (data: unknown) => { outgoing.push(data); };
  const posts: any[] = [];
  const parent = { postMessage: (data: unknown) => posts.push(data) };
  if (frameMode) {
    Object.defineProperty(window, 'parent', { value: parent });
    window.name = 'vcd-edit-viewport-preview';
  }
  let reloads = 0;
  Object.defineProperty(window.location, 'reload', { value: () => reloads++ });
  const scrolls: number[] = [];
  window.scrollTo = ((options: ScrollToOptions) => { scrolls.push(options.top ?? 0); }) as typeof window.scrollTo;
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const idle = new Map<number, () => void>();
  let id = 0;
  if (idleSupported) {
    window.requestIdleCallback = (callback: () => void) => { idle.set(++id, callback); return id; };
    window.cancelIdleCallback = (key: number) => { idle.delete(key); };
  } else {
    Object.defineProperty(window, 'requestIdleCallback', { value: undefined });
  }
  window.setTimeout = ((callback: () => void, delay: number) => { timers.push({ callback, delay }); return ++id; }) as typeof window.setTimeout;
  const frames = new Map<number, FrameRequestCallback>();
  let now = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  window.cancelAnimationFrame = (key) => { frames.delete(key); };
  const step = (ms: number) => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  };
  const cleanups: Array<() => void> = [];
  const scope = {
    signal: { aborted: false },
    listen(target: EventTarget, event: string, listener: EventListener, options?: boolean) {
      target.addEventListener(event, listener, options);
      cleanups.push(() => target.removeEventListener(event, listener, options));
    },
    frame(callback: () => void) { callback(); },
    timeout(callback: () => void, delay: number) { timers.push({ callback, delay }); },
    add(callback: () => void) { cleanups.push(callback); },
    destroy() { scope.signal.aborted = true; cleanups.reverse().forEach(fn => fn()); },
  };
  const dispose = new Function('window', 'document', 'HTMLElement', 'CustomEvent', 'MutationObserver', 'matchMedia', 'sessionStorage', 'performance', 'createPageScope', 'onPageLoad', script)(
    window, document, window.HTMLElement, window.CustomEvent, window.MutationObserver,
    () => ({ matches: reduced }), window.sessionStorage, { now: () => now }, () => scope, (mount: () => () => void) => mount(),
  );
  const request = (preset: string) => window.dispatchEvent(new window.CustomEvent('vcd:edit-viewport-request', { detail: { preset } }));
  const message = (type: string, extra = {}) => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: child, data: { type, ...extra } }));
  const parentMessage = (type: string, extra = {}) => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: parent, data: { type, ...extra } }));
  const warm = () => { [...idle.values()].forEach(callback => callback()); idle.clear(); };
  const acknowledge = async () => {
    await flush();
    const sync = outgoing.findLast(data => data.type === 'vcd-viewport-preview-scroll');
    message('vcd-viewport-preview-restored', { id: sync?.id });
    await flush();
  };
  const open = async (preset = 'tablet') => {
    warm();
    message('vcd-viewport-preview-edited');
    request(preset);
    await acknowledge();
  };
  const settle = async () => { await flush(); step(1000); await flush(); };
  return { window, document, root, surface, frame, controls, child, posts, outgoing, timers, frames, idle, scrolls,
    request, message, parentMessage, warm, acknowledge, open, step, settle, reloads: () => reloads,
    dispose: async () => { dispose(); await window.happyDOM.abort(); await child.happyDOM.abort(); } };
}

test('warms at Desktop size, inert and invisible, and refreshes after disk writes', async () => {
  const f = fixture();
  try {
    expect(f.idle.size).toBe(1);
    f.warm();
    expect(f.root.style.visibility).toBe('hidden');
    expect(f.root.inert).toBe(true);
    expect(f.frame.inert).toBe(true);
    expect(f.frame.style.width).toBe(`${f.window.innerWidth}px`);
    expect(f.frame.style.height).toBe(`${f.window.innerHeight}px`);
    expect(f.frame.style.transform).toBe('scale(1, 1)');
    expect(f.document.querySelector('main')!.inert).toBe(false);
    f.message('vcd-viewport-preview-ready');
    expect(f.outgoing.at(-1).type).toBe('vcd-viewport-preview-edit');
    f.window.dispatchEvent(new f.window.Event('vcd:dev-content-written'));
    expect(f.frame.src).toBe('about:blank');
    expect(f.idle.size).toBe(1);
    f.warm();
    expect(f.frame.src).toBe(f.window.location.href);
    f.window.dispatchEvent(new f.window.CustomEvent('vcd:dev-mode-change', { detail: { active: false } }));
    expect(f.frame.src).toBe('about:blank');
  } finally { await f.dispose(); }
});

test('opens only after scroll acknowledgement, reflows real dimensions, and closes without a fade', async () => {
  const f = fixture();
  try {
    const focus = f.document.getElementById('focus')!;
    focus.focus();
    f.warm();
    f.message('vcd-viewport-preview-edited');
    f.request('tablet');
    await flush();
    expect(f.root.style.visibility).toBe('hidden');
    expect(f.document.querySelector('main')!.inert).toBe(false);
    f.message('vcd-viewport-preview-restored', { id: -1 });
    await flush();
    expect(f.root.style.visibility).toBe('hidden');
    await f.acknowledge();
    expect(f.root.style.visibility).toBe('visible');
    expect(f.surface.style.width).toBe(`${f.window.innerWidth}px`);
    expect(f.frame.style.width).toBe(`${f.window.innerWidth}px`);
    expect(f.frame.style.opacity).toBe('');
    f.step(100);
    const width = parseFloat(f.frame.style.width);
    expect(width).toBeGreaterThan(820);
    expect(width).toBeLessThan(f.window.innerWidth);
    expect(width).toBe(Math.round(width));
    expect(parseFloat(f.surface.style.getPropertyValue('--viewport-radius'))).toBeGreaterThan(0);
    await f.settle();
    expect(f.frame.style.width).toBe('820px');
    const src = f.frame.src;
    f.request('mobile');
    await f.settle();
    expect(f.frame.src).toBe(src);
    expect(f.frame.style.width).toBe('390px');
    expect(f.root.dataset.viewportStagePreset).toBe('mobile');
    Object.defineProperty(f.child, 'scrollY', { value: 320 });
    f.request('desktop');
    await f.settle();
    expect(f.reloads()).toBe(0);
    expect(f.root.style.visibility).toBe('hidden');
    expect(f.frame.style.width).toBe(`${f.window.innerWidth}px`);
    expect(f.scrolls.at(-1)).toBe(320);
    expect(f.document.querySelector('main')!.inert).toBe(false);
    expect(f.document.activeElement).toBe(focus);
  } finally { await f.dispose(); }
});

test('samples the specified spring and interrupts from current size without a pause', async () => {
  const f = fixture();
  try {
    await f.open();
    f.step(100);
    const omega = 2 * Math.PI / (0.35 * 1.2);
    const x = 1 - Math.exp(-omega * 0.1) * (1 + omega * 0.1);
    expect(parseFloat(f.frame.style.width)).toBe(Math.round(f.window.innerWidth + (820 - f.window.innerWidth) * x));
    const before = f.frame.style.width;
    f.request('mobile');
    expect(f.frame.style.width).toBe(before);
    expect(f.frames.size).toBe(1);
    f.step(16);
    expect(parseFloat(f.frame.style.width)).toBeLessThan(parseFloat(before));
    f.request('desktop');
    f.step(100);
    f.request('tablet');
    await f.settle();
    expect(f.root.style.visibility).toBe('visible');
    expect(f.frame.style.width).toBe('820px');
  } finally { await f.dispose(); }
});

test('a single Option+2 waits for a cold frame and the scroll acknowledgement is bounded', async () => {
  const f = fixture();
  try {
    const shortcut = new f.window.KeyboardEvent('keydown', { altKey: true, code: 'Digit2', bubbles: true, cancelable: true });
    f.document.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);
    f.step(4200);
    await flush();
    expect(f.root.style.visibility).toBe('hidden');
    expect(f.frames.size).toBe(0);
    f.message('vcd-viewport-preview-edited');
    await flush();
    f.timers.findLast(timer => timer.delay === 150)!.callback();
    await f.settle();
    expect(f.frame.style.width).toBe('820px');
  } finally { await f.dispose(); }
});

test('the surface keeps moving between iframe layout updates and background clicks keep the preset', async () => {
  const f = fixture();
  try {
    await f.open();
    f.step(16);
    const width = f.frame.style.width;
    const surfaceWidth = f.surface.style.width;
    f.step(16);
    expect(f.frame.style.width).toBe(width);
    expect(f.surface.style.width).not.toBe(surfaceWidth);
    f.document.querySelector<HTMLElement>('[data-test-backdrop]')!.click();
    await f.settle();
    expect(f.root.dataset.viewportStagePreset).toBe('tablet');
    expect(f.frame.style.width).toBe('820px');
  } finally { await f.dispose(); }
});

test('guards dirty/pending writes, keeps the parent unchanged while waiting, and reloads only after a frame save', async () => {
  const f = fixture();
  try {
    const dirty = (event: any) => { event.detail.dirty = true; };
    f.window.addEventListener('vcd:dev-viewport-preview-dirty-check', dirty);
    f.request('mobile');
    expect(f.frame.getAttribute('src')).toBe('about:blank');
    f.window.removeEventListener('vcd:dev-viewport-preview-dirty-check', dirty);
    let release!: () => void;
    const write = new Promise<void>(resolve => { release = resolve; });
    f.window.addEventListener('vcd:dev-viewport-prepare', ((event: any) => event.detail.waitUntil(write)), { once: true });
    f.request('mobile');
    expect(f.frame.getAttribute('src')).toBe('about:blank');
    release();
    await flush();
    f.message('vcd-viewport-preview-edited');
    await f.acknowledge();
    await f.settle();
    f.message('vcd-viewport-preview-saved');
    f.request('desktop');
    await f.settle();
    expect(f.reloads()).toBe(1);
    expect(f.window.sessionStorage.getItem('vcd-viewport-preview-restore')).not.toBeNull();
  } finally { await f.dispose(); }
});

test('reduced motion jumps size with no content fades; only the stationary bottom bar fades', async () => {
  const f = fixture(true);
  try {
    await f.open('mobile');
    expect(f.frames.size).toBe(0);
    expect(f.frame.style.width).toBe('390px');
    expect(f.frame.style.opacity).toBe('');
    expect(f.surface.style.opacity).toBe('');
    expect(f.controls.style.opacity).toBe('1');
    f.request('desktop');
    expect(f.root.style.visibility).toBe('hidden');
    expect(f.frame.style.transform).toBe('scale(1, 1)');
  } finally { await f.dispose(); }
  expect(source).toContain('bottom: max(12px, env(safe-area-inset-bottom))');
  expect(source).toContain('transition: opacity 150ms');
  expect(source).not.toContain('data-viewport-size');
  expect(source).toContain('label="Viewport" bare');
  expect(source).toContain('slideSelection={false}');
  expect(source).not.toContain('element.animate');
});

test('frame handshake synchronizes scroll, pauses hidden autoplay and resumes only paused media', async () => {
  const f = fixture(false, true);
  try {
    const video = f.document.createElement('video');
    let paused = false;
    let resumes = 0;
    Object.defineProperty(video, 'paused', { get: () => paused });
    video.pause = () => { paused = true; };
    video.play = async () => { paused = false; resumes++; };
    f.document.body.append(video);
    video.dispatchEvent(new f.window.Event('play', { bubbles: true }));
    expect(paused).toBe(true);
    f.parentMessage('vcd-viewport-preview-edit');
    expect(f.posts.at(-1).type).toBe('vcd-viewport-preview-edited');
    f.parentMessage('vcd-viewport-preview-scroll', { scrollY: 450, id: 3 });
    expect(f.scrolls.at(-1)).toBe(450);
    expect(f.posts.at(-1)).toEqual({ type: 'vcd-viewport-preview-restored', id: 3 });
    f.parentMessage('vcd-viewport-preview-visible', { visible: true });
    expect(resumes).toBe(1);
    f.window.dispatchEvent(new f.window.Event('vcd:dev-pending-committed'));
    f.window.dispatchEvent(new f.window.Event('vcd:dev-content-written'));
    expect(f.posts.filter(data => data.type === 'vcd-viewport-preview-saved')).toHaveLength(2);
    expect(f.document.documentElement.hasAttribute('data-edit-viewport-frame')).toBe(true);
  } finally { await f.dispose(); }
});


test('uses a 200ms idle fallback and cancels an interrupted cold open', async () => {
  const f = fixture(false, false, false);
  try {
    expect(f.timers.some(timer => timer.delay === 200)).toBe(true);
    f.request('mobile');
    f.request('desktop');
    f.message('vcd-viewport-preview-edited');
    await flush();
    expect(f.root.style.visibility).toBe('hidden');
    expect(f.frames.size).toBe(0);
  } finally { await f.dispose(); }
});

test('a cancelled scroll handshake cannot open the frame or clear the next request', async () => {
  const f = fixture(true);
  try {
    f.warm();
    f.message('vcd-viewport-preview-edited');
    f.request('tablet');
    await flush();
    const cancelled = f.outgoing.findLast(data => data.type === 'vcd-viewport-preview-scroll');
    f.request('desktop');
    f.request('mobile');
    await flush();
    f.message('vcd-viewport-preview-restored', { id: cancelled.id });
    await flush();
    expect(f.root.style.visibility).toBe('hidden');
    await f.acknowledge();
    expect(f.frame.style.width).toBe('390px');
  } finally { await f.dispose(); }
});

test('frame save guard and rejected pending writes prevent close', async () => {
  const f = fixture(true);
  try {
    await f.open();
    f.child.addEventListener('vcd:before-reload', event => event.preventDefault(), { once: true });
    f.request('desktop');
    expect(f.root.dataset.viewportStagePreset).toBe('tablet');
    f.child.addEventListener('vcd:dev-viewport-prepare', ((event: any) => event.detail.waitUntil(Promise.reject(new Error('write failed')))), { once: true });
    f.request('desktop');
    await flush();
    expect(f.root.style.visibility).toBe('visible');
    expect(f.root.dataset.viewportStagePreset).toBe('tablet');
    f.request('desktop');
    expect(f.root.style.visibility).toBe('hidden');
  } finally { await f.dispose(); }
});
