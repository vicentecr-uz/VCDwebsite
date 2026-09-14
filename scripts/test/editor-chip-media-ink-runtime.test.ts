import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mock } from 'bun:test';

type Pending = { resolve: (value: { naturalWidth: number; naturalHeight: number; src: string }) => void };
const pending = new Map<string, Pending>();
let lumaCalls = 0;

mock.module('../../src/scripts/adaptiveMediaInk', () => ({
  applyMediaGround(host: HTMLElement, ground: 'light' | 'dark') {
    host.dataset.mediaGround = ground;
    host.style.setProperty('--media-ink', ground);
  },
  cropHostFor: () => null,
  groundForBox: (_chip: HTMLElement, _frame: HTMLElement, decoded: { src?: string }) => (
    decoded.src?.endsWith('new-image') ? 'light' : 'dark'
  ),
  groundForRegion: () => 'light',
  lumaGridFor: (src: string) => {
    lumaCalls += 1;
    return new Promise((resolve) => pending.set(src, { resolve: (value) => resolve(value) }));
  },
  readCropVars: () => null,
}));

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  HTMLElement: browser.HTMLElement,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  MutationObserver: browser.MutationObserver,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
});

const { bindEditorChipMediaInk } = await import('../../src/scripts/bindEditorChipMediaInk');

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function fixture(): { chip: HTMLElement; image: HTMLImageElement } {
  document.body.innerHTML = `
    <figure class="dev-image-edit-target project-media">
      <img class="project-media__img" />
      <button class="dev-image-edit-trigger"></button>
    </figure>`;
  const scope = document.querySelector<HTMLElement>('.dev-image-edit-target')!;
  const image = scope.querySelector<HTMLImageElement>('img')!;
  const chip = scope.querySelector<HTMLElement>('button')!;
  Object.defineProperty(scope, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 }) });
  Object.defineProperty(image, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 }) });
  Object.defineProperty(chip, 'getBoundingClientRect', { value: () => ({ left: 12, top: 12, right: 72, bottom: 32, width: 60, height: 20 }) });
  Object.defineProperty(image, 'complete', { configurable: true, value: true });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 100 });
  return { chip, image };
}

function resolveLuma(src: string): void {
  const key = [...pending.keys()].find((candidate) => candidate.endsWith(src));
  if (key) pending.get(key)?.resolve({ naturalWidth: 100, naturalHeight: 100, src: key });
}

test('rejects a stale decode after the image source changes', async () => {
  pending.clear();
  lumaCalls = 0;
  const { chip, image } = fixture();
  image.src = 'old-image';
  const cleanup = bindEditorChipMediaInk();
  document.documentElement.classList.add('is-dev-mode');
  await tick();
  image.src = 'new-image';
  await tick();
  resolveLuma('old-image');
  await tick();
  assert.equal(chip.dataset.mediaGround, undefined);
  resolveLuma('new-image');
  await tick();
  assert.equal(chip.dataset.mediaGround, 'light');
  assert.equal(lumaCalls, 2);
  cleanup();
  document.documentElement.classList.remove('is-dev-mode');
});

test('teardown prevents a pending decode from mutating the chip', async () => {
  pending.clear();
  const { chip, image } = fixture();
  image.src = 'teardown-image';
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  await tick();
  cleanup();
  resolveLuma('teardown-image');
  await tick();
  assert.equal(chip.dataset.mediaGround, undefined);
  document.documentElement.classList.remove('is-dev-mode');
});

test('ignores its own chip style and ground mutations', async () => {
  pending.clear();
  lumaCalls = 0;
  const { chip, image } = fixture();
  image.src = 'self-image';
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  await tick();
  resolveLuma('self-image');
  await tick();
  await tick();
  assert.equal(chip.dataset.mediaGround, 'dark');
  assert.equal(lumaCalls, 1);
  cleanup();
  document.documentElement.classList.remove('is-dev-mode');
});
