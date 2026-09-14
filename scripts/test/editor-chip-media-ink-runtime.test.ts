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
  applyChipAppearance(host: HTMLElement, luma: number | null) {
    host.dataset.mediaGround = luma !== null && luma < 0.6 ? 'dark' : 'light';
    host.style.setProperty('--chip-rest-brightness', luma !== null && luma >= 0.78 ? '0.94' : '1.06');
    host.style.setProperty('--chip-hover-brightness', luma !== null && luma >= 0.78 ? '0.88' : '1.12');
  },
  opaqueBackground: () => '#fff',
  cropHostFor: () => null,
  groundForBox: (_chip: HTMLElement, _frame: HTMLElement, decoded: { src?: string }) => (
    decoded.src?.endsWith('new-image') ? 'light' : 'dark'
  ),
  sampleForBox: (_chip: HTMLElement, _frame: HTMLElement, decoded: { src?: string }) => ({
    luma: decoded.src?.endsWith('new-image') ? 0.7 : decoded.src?.endsWith('nearwhite-image') ? 0.9 : decoded.src?.endsWith('midgray-image') ? 0.5 : 0.2,
    pixels: new Uint8ClampedArray(),
  }),
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
  Event: browser.Event,
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
  Object.defineProperty(chip, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 12, top: 12, right: 72, bottom: 32, width: 60, height: 20 }) });
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
  assert.equal(chip.style.getPropertyValue('--chip-rest-brightness'), '1.06');
  assert.equal(chip.style.getPropertyValue('--chip-hover-brightness'), '1.12');
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

test('does not resample on page scroll or unrelated html class changes', async () => {
  pending.clear();
  lumaCalls = 0;
  const { chip, image } = fixture();
  image.src = 'stable-image';
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  await tick();
  resolveLuma('stable-image');
  await tick();
  const baseline = lumaCalls;
  window.dispatchEvent(new Event('scroll'));
  document.documentElement.classList.add('some-unrelated-state');
  await tick();
  assert.equal(lumaCalls, baseline);
  assert.equal(chip.dataset.mediaGround, 'dark');
  cleanup();
  document.documentElement.classList.remove('is-dev-mode', 'some-unrelated-state');
});

test('refreshes after a carousel track scrollend', async () => {
  pending.clear();
  lumaCalls = 0;
  const { image } = fixture();
  const scope = image.closest<HTMLElement>('.dev-image-edit-target')!;
  const track = document.createElement('div');
  track.className = 'project-image-carousel__track';
  scope.append(track);
  image.src = 'carousel-image';
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  await tick();
  resolveLuma('carousel-image');
  await tick();
  const baseline = lumaCalls;
  track.dispatchEvent(new Event('scrollend', { bubbles: true }));
  await tick();
  assert.equal(lumaCalls, baseline + 1);
  cleanup();
  document.documentElement.classList.remove('is-dev-mode');
});

test('does not decode an offscreen chip', async () => {
  pending.clear();
  lumaCalls = 0;
  const { chip, image } = fixture();
  image.src = 'offscreen-image';
  Object.defineProperty(chip, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 12, top: 900, right: 72, bottom: 920, width: 60, height: 20 }) });
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  await tick();
  assert.equal(lumaCalls, 0);
  cleanup();
  document.documentElement.classList.remove('is-dev-mode');
});

test('brightens ordinary grounds and darkens near-white grounds', async () => {
  pending.clear();
  const { chip, image } = fixture();
  image.src = 'midgray-image';
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  await tick();
  resolveLuma('midgray-image');
  await tick();
  assert.equal(chip.style.getPropertyValue('--chip-rest-brightness'), '1.06');
  image.src = 'nearwhite-image';
  await tick();
  resolveLuma('nearwhite-image');
  await tick();
  assert.equal(chip.style.getPropertyValue('--chip-rest-brightness'), '0.94');
  assert.equal(chip.style.getPropertyValue('--chip-hover-brightness'), '0.88');
  cleanup();
  document.documentElement.classList.remove('is-dev-mode');
});
