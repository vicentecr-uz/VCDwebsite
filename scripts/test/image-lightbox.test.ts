import { afterEach, expect, test } from 'bun:test';
import { Window, BrowserErrorCaptureEnum } from 'happy-dom';
import { readFileSync } from 'node:fs';
import * as geometry from '../../src/lib/imageLightbox';

const script = readFileSync(new URL('../../src/components/ImageLightbox.astro', import.meta.url), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)![1];
const source = script.slice(0, script.indexOf('  const disposers'))
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\.\/lib\/imageLightbox';/, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

function fixture() {
  const window = new Window({ url: 'http://localhost:4323', settings: { errorCapture: BrowserErrorCaptureEnum.disabled } });
  const document = window.document;
  document.body.innerHTML = `<img id="source" alt="Study" data-image-original="/images/study.jpg" role="button" tabindex="0">
    <dialog data-image-lightbox><div data-image-lightbox-viewer tabindex="0"><img data-image-lightbox-image><p data-image-lightbox-error hidden></p></div>
    <button data-image-lightbox-zoom-in>Zoom in</button><button data-image-lightbox-zoom-out>Zoom out</button>
    <button data-image-lightbox-reset>Reset</button><button data-image-lightbox-close>Close</button></dialog>`;
  const original = document.querySelector<HTMLImageElement>('#source')!;
  const dialog = document.querySelector('dialog')!;
  const viewer = dialog.querySelector<HTMLElement>('[data-image-lightbox-viewer]')!;
  const image = dialog.querySelector<HTMLImageElement>('[data-image-lightbox-image]')!;
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  window.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => timers.delete(id)) as typeof window.clearTimeout;
  const raf = (callback: FrameRequestCallback) => { const id = ++nextId; frames.set(id, callback); return id; };
  const captured = new Set<number>();
  viewer.setPointerCapture = (id: number) => { captured.add(id); };
  viewer.hasPointerCapture = (id: number) => captured.has(id);
  viewer.releasePointerCapture = (id: number) => { captured.delete(id); };
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  Object.defineProperties(viewer, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  Object.defineProperties(image, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } });
  viewer.getBoundingClientRect = () => ({ left: 100, top: 100, width: 800, height: 600 } as DOMRect);
  const env = { ...geometry, window, document, Element: window.Element, MutationObserver: window.MutationObserver,
    requestAnimationFrame: raf, cancelAnimationFrame: (id: number) => frames.delete(id) };
  const bind = new Function(...Object.keys(env), `${compiled}; return bindImageLightbox;`)(...Object.values(env));
  const dispose = bind(dialog);
  cleanups.push(dispose);
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(now)); };
  const tick = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  const click = (target: Element = original, options = {}) => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
  const button = (name: string) => dialog.querySelector<HTMLButtonElement>(`[data-image-lightbox-${name}]`)!;
  const pointer = (type: string, id: number, x = 400, y = 400, button = 0) =>
    viewer.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, clientX: x, clientY: y, button }));
  return { window, document, original, dialog, viewer, image, click, button, pointer, frame, tick, frames, timers, captured, dispose };
}

for (const key of ['Enter', ' ']) {
  test(`${key}: opens original only on activation, then fades before restoring focus`, () => {
    const f = fixture();
    expect(f.image.hasAttribute('src')).toBe(false);
    const event = new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    f.original.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.dialog.open).toBe(true);
    expect(f.image.getAttribute('src')).toBe('/images/study.jpg');
    expect(f.document.activeElement).toBe(f.viewer);
    expect(f.dialog.classList.contains('is-visible')).toBe(false);
    f.frame(); f.frame();
    expect(f.dialog.classList.contains('is-visible')).toBe(true);
    f.click(f.button('close'));
    f.tick(199);
    expect(f.dialog.open).toBe(true);
    expect(f.image.hasAttribute('src')).toBe(true);
    f.tick(1);
    expect(f.dialog.open).toBe(false);
    expect(f.image.hasAttribute('src')).toBe(false);
    expect(f.document.activeElement).toBe(f.original);
  });
}

test('links, editable/hidden content, cancelled events and Edit mode do not open', () => {
  const f = fixture();
  for (const attrs of ['href="/other"', 'contenteditable="plaintext-only"', 'aria-hidden="true"', 'class="dev-crop-stage"']) {
    const parent = f.document.createElement(attrs.startsWith('href') ? 'a' : 'div');
    const parsed = f.document.createElement('div'); parsed.innerHTML = `<${parent.tagName.toLowerCase()} ${attrs}></${parent.tagName.toLowerCase()}>`;
    const wrapper = parsed.firstElementChild!;
    f.original.replaceWith(wrapper); wrapper.append(f.original);
    f.click(); expect(f.dialog.open).toBe(false);
    wrapper.replaceWith(f.original);
  }
  const cancelled = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  cancelled.preventDefault(); f.original.dispatchEvent(cancelled);
  expect(f.dialog.open).toBe(false);
  f.document.documentElement.classList.add('is-dev-mode');
  f.click(); expect(f.dialog.open).toBe(false);
  f.document.documentElement.classList.remove('is-dev-mode');
  f.click(); expect(f.dialog.open).toBe(true);
});

test('closing before entry paint and reopening cannot apply stale frames or source cleanup', () => {
  const f = fixture(); f.click(); f.click(f.button('close'));
  f.frame(); f.frame();
  expect(f.dialog.classList.contains('is-visible')).toBe(false);
  f.original.dataset.imageOriginal = '/images/new.jpg';
  f.click(); f.tick(200); f.frame(); f.frame();
  expect(f.dialog.open).toBe(true);
  expect(f.image.getAttribute('src')).toBe('/images/new.jpg');
  expect(f.dialog.classList.contains('is-visible')).toBe(true);
});

test('pinch stays centred, clamps scale/pan, and release cannot dismiss', () => {
  const f = fixture(); f.click();
  f.pointer('pointerdown', 1, 400, 400); f.pointer('pointerdown', 2, 600, 400);
  f.pointer('pointermove', 1, 300, 400); f.pointer('pointermove', 2, 700, 400);
  expect(f.image.style.transform).toBe('translate3d(0px, 0px, 0) scale(2)');
  f.pointer('pointerup', 2, 700, 400);
  f.pointer('pointermove', 1, 5000, 400);
  expect(f.image.style.transform).toBe('translate3d(400px, 0px, 0) scale(2)');
  f.pointer('pointerup', 1); f.click(f.viewer); f.tick(200);
  expect(f.dialog.open).toBe(true);
  expect(f.captured.size).toBe(0);
  f.click(f.button('reset'));
  for (let i = 0; i < 10; i++) f.click(f.button('zoom-in'));
  expect(f.image.style.transform).toContain('scale(4)');
  expect(f.button('zoom-in').disabled).toBe(true);
});

test('cancelled pointer and two-finger tap do not dismiss; next plain tap can dismiss', () => {
  const f = fixture(); f.click();
  f.pointer('pointerdown', 1); f.pointer('pointerdown', 2);
  f.pointer('pointercancel', 1); f.pointer('pointerup', 2);
  f.click(f.viewer); f.tick(200); expect(f.dialog.open).toBe(true);
  f.pointer('pointerdown', 3); f.pointer('pointerup', 3);
  f.click(f.viewer); f.tick(200); expect(f.dialog.open).toBe(false);
});

test('keyboard users can zoom and pan; reset returns to fit', () => {
  const f = fixture(); f.click(); f.click(f.button('zoom-in'));
  f.viewer.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(f.image.style.transform).toBe('translate3d(-40px, 0px, 0) scale(1.5)');
  f.click(f.button('reset'));
  expect(f.image.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
});

test('image errors keep dismissal usable; Escape, pagehide and disposal clean up', () => {
  const f = fixture(); f.click();
  f.image.dispatchEvent(new f.window.Event('error'));
  expect(f.dialog.querySelector<HTMLElement>('[data-image-lightbox-error]')!.hidden).toBe(false);
  f.dialog.dispatchEvent(new f.window.Event('cancel', { cancelable: true })); f.tick(200);
  expect(f.dialog.open).toBe(false);
  f.click(); f.window.dispatchEvent(new f.window.Event('pagehide'));
  expect(f.dialog.open).toBe(false); expect(f.timers.size).toBe(0); expect(f.frames.size).toBe(0);
  f.click(); f.dispose(); f.click(); f.frame(); f.tick(200);
  expect(f.dialog.open).toBe(false);
});

test('live source helper removes placeholder actions and uses the new original', () => {
  const f = fixture(); geometry.syncLightboxImage(f.original, '/images/placeholder.svg');
  expect(f.original.hasAttribute('tabindex')).toBe(false); f.click(); expect(f.dialog.open).toBe(false);
  geometry.syncLightboxImage(f.original, '/images/replacement.jpg');
  f.click(); expect(f.image.getAttribute('src')).toBe('/images/replacement.jpg');
  expect(geometry.clampImageScale(Infinity)).toBe(1);
});
