import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clampImageScale,
  distance,
  midpoint,
  panForPointer,
  panForPinch,
  pinchScale,
  syncLightboxImage,
  IMAGE_LIGHTBOX_MAX_SCALE,
} from '../../src/lib/imageLightbox';

const lightboxScript = readFileSync(resolve(import.meta.dir, '../../src/components/ImageLightbox.astro'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

const installBinding = (window: Window) => {
  const pending = new Map<number, () => void>();
  let nextTimer = 1;
  window.setTimeout = ((callback: TimerHandler) => {
    const id = nextTimer++;
    pending.set(id, callback as () => void);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => { pending.delete(id); }) as typeof window.clearTimeout;
  (window as any).flushLightboxTimers = () => {
    const timers = [...pending.values()];
    pending.clear();
    timers.forEach((callback) => callback());
  };
  window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1; };
  const source = lightboxScript
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\.\/lib\/imageLightbox';/, '')
    .replace('import.meta.hot?.dispose(() => disposers.forEach((dispose) => dispose()));', '');
  const transpiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
  const run = new Function('window', 'document', 'MutationObserver', 'requestAnimationFrame', 'Element', transpiled);
  run(window, window.document, window.MutationObserver, window.requestAnimationFrame, window.Element);
  return { pending };
};

const imageFixture = () => {
  const window = new Window();
  const { document } = window;
  const dialog = document.createElement('dialog');
  dialog.dataset.imageLightbox = '';
  dialog.innerHTML = `
    <div class="image-lightbox__viewer" data-image-lightbox-viewer tabindex="-1">
      <img data-image-lightbox-image alt="" />
      <p data-image-lightbox-error hidden>Image could not be loaded.</p>
    </div>
    <button data-image-lightbox-zoom-out></button>
    <button data-image-lightbox-reset></button>
    <button data-image-lightbox-zoom-in></button>
    <button data-image-lightbox-close></button>`;
  const source = document.createElement('img');
  source.alt = 'Source';
  source.dataset.imageOriginal = '/images/source.jpg';
  source.setAttribute('role', 'button');
  source.tabIndex = 0;
  const link = document.createElement('a');
  link.href = '/elsewhere';
  link.append(source);
  document.body.append(dialog, source);
  (dialog as any).showModal = () => dialog.setAttribute('open', '');
  (dialog as any).close = () => dialog.removeAttribute('open');
  return { window, document, dialog, source, link };
};

describe('image lightbox geometry', () => {
  test('clamps desktop and pinch zoom to the V0 ceiling', () => {
    expect(clampImageScale(0)).toBe(1);
    expect(clampImageScale(2.5)).toBe(2.5);
    expect(clampImageScale(99)).toBe(IMAGE_LIGHTBOX_MAX_SCALE);
    expect(pinchScale(2, 100, 300)).toBe(IMAGE_LIGHTBOX_MAX_SCALE);
  });

  test('keeps pinch midpoint and single pointer pan calculations deterministic', () => {
    expect(midpoint({ x: 10, y: 30 }, { x: 50, y: 70 })).toEqual({ x: 30, y: 50 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(panForPointer({ x: 4, y: -2 }, { x: 10, y: 10 }, { x: 35, y: 25 }))
      .toEqual({ x: 29, y: 13 });
    expect(panForPinch(
      { x: 0, y: 0 },
      { x: 400, y: 300 },
      { x: 450, y: 350 },
      1,
      2,
      { x: 400, y: 300 },
    )).toEqual({ x: 50, y: 50 });
  });

  test('syncs live image eligibility and removes it for placeholders', () => {
    const image = new Window().document.createElement('img');
    image.alt = 'Study';
    syncLightboxImage(image, '/images/study.jpg');
    expect(image.dataset.imageOriginal).toBe('/images/study.jpg');
    expect(image.getAttribute('role')).toBe('button');
    expect(image.tabIndex).toBe(0);
    expect(image.getAttribute('aria-label')).toBe('Open image: Study');
    syncLightboxImage(image, '/images/placeholder.svg');
    expect(image.hasAttribute('data-image-original')).toBe(false);
    expect(image.hasAttribute('role')).toBe(false);
    expect(image.hasAttribute('tabindex')).toBe(false);
  });

  test('opens from click and keyboard, loads source on demand, and restores focus after close', () => {
    const { window, document, dialog, source } = imageFixture();
    installBinding(window);
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector('[data-image-lightbox-image]')?.getAttribute('src')).toBe(null);

    source.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const modalImage = dialog.querySelector<HTMLImageElement>('[data-image-lightbox-image]')!;
    expect(dialog.open).toBe(true);
    expect(modalImage.src).toContain('/images/source.jpg');
    dialog.querySelector<HTMLButtonElement>('[data-image-lightbox-close]')!.click();
    (window as any).flushLightboxTimers();
    expect(dialog.open).toBe(false);
    expect(modalImage.getAttribute('src')).toBe(null);
    expect(document.activeElement).toBe(source);

    source.focus();
    source.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(dialog.open).toBe(true);
  });

  test('keeps excluded links and cancelled events closed', () => {
    const fixture = imageFixture();
    installBinding(fixture.window);
    fixture.link.append(fixture.source);
    fixture.source.dispatchEvent(new fixture.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fixture.dialog.open).toBe(false);
    fixture.link.dispatchEvent(new fixture.window.MouseEvent('click', { bubbles: true }));
    expect(fixture.dialog.open).toBe(false);
    const cancelled = new fixture.window.MouseEvent('click', { bubbles: true, cancelable: true });
    cancelled.preventDefault();
    fixture.source.dispatchEvent(cancelled);
    expect(fixture.dialog.open).toBe(false);
  });

  test('does not let a stale close timer clear a reopened image', () => {
    const { window, dialog, source } = imageFixture();
    const { pending } = installBinding(window);
    source.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const close = dialog.querySelector<HTMLButtonElement>('[data-image-lightbox-close]')!;
    close.click();
    source.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(true);
    expect(pending.size).toBe(0);
    expect(dialog.querySelector<HTMLImageElement>('[data-image-lightbox-image]')?.getAttribute('src'))
      .toContain('/images/source.jpg');
  });

  test('keeps a pinch session open and does not treat its release as backdrop dismissal', () => {
    const { window, dialog, source } = imageFixture();
    installBinding(window);
    source.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const viewer = dialog.querySelector<HTMLElement>('[data-image-lightbox-viewer]')!;
    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new window.PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: y });
      viewer.dispatchEvent(event);
    };
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 300, 100);
    pointer('pointerup', 1, 100, 100);
    pointer('pointerup', 2, 300, 100);
    viewer.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(true);
  });
});
