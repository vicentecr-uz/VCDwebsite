import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  HTMLElement: browser.HTMLElement,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
});

const { bindEditorChipMediaInk, frameForChip } = await import('../../src/scripts/bindEditorChipMediaInk');

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}

function setRect(element: HTMLElement, value: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
}

test('selects the frame under a grid chip instead of the first frame', () => {
  document.body.innerHTML = `
    <div class="dev-grid-edit-target">
      <button class="dev-grid-edit-trigger"></button>
      <div class="project-image-grid__frame" data-frame="first"></div>
      <div class="project-image-grid__frame" data-frame="under-chip"></div>
    </div>`;
  const scope = document.querySelector<HTMLElement>('.dev-grid-edit-target')!;
  const chip = scope.querySelector<HTMLElement>('.dev-grid-edit-trigger')!;
  const frames = [...scope.querySelectorAll<HTMLElement>('.project-image-grid__frame')];
  setRect(chip, rect(95, 95, 20, 20));
  setRect(frames[0], rect(0, 300, 100, 100));
  setRect(frames[1], rect(90, 90, 100, 100));
  assert.equal(frameForChip(chip, scope), frames[1]);
});

test('returns no image frame for a chip in the gap below an uncropped image', () => {
  document.body.innerHTML = `
    <figure class="dev-image-edit-target project-media">
      <img class="project-media__img" />
      <button class="dev-caption-add-trigger"></button>
    </figure>`;
  const scope = document.querySelector<HTMLElement>('.dev-image-edit-target')!;
  const image = scope.querySelector<HTMLImageElement>('img')!;
  const chip = scope.querySelector<HTMLElement>('button')!;
  setRect(image, rect(0, 0, 200, 120));
  setRect(scope, rect(0, 0, 200, 180));
  setRect(chip, rect(20, 140, 80, 20));
  assert.equal(frameForChip(chip, scope), null);
});

test('uses a standalone media frame when it is the editor target', () => {
  document.body.innerHTML = `
    <figure class="dev-image-edit-target project-media">
      <img class="project-media__img" />
      <button class="dev-image-edit-trigger"></button>
    </figure>`;
  const scope = document.querySelector<HTMLElement>('.dev-image-edit-target')!;
  const image = scope.querySelector<HTMLImageElement>('img')!;
  const chip = scope.querySelector<HTMLElement>('button')!;
  setRect(scope, rect(0, 0, 200, 120));
  setRect(image, rect(0, 0, 200, 120));
  setRect(chip, rect(12, 12, 60, 20));
  assert.equal(frameForChip(chip, scope), image);
});

test('teardown is safe before the scheduled editor refresh runs', async () => {
  document.body.innerHTML = '<div class="dev-image-edit-target"><button class="dev-image-edit-trigger"></button></div>';
  document.documentElement.classList.add('is-dev-mode');
  const cleanup = bindEditorChipMediaInk();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(document.querySelector('[data-media-ground]'), null);
  document.documentElement.classList.remove('is-dev-mode');
});

 test('brightness helper brightens dark and mid-tone samples, but darkens near-white samples', async () => {
  const { applyChipBrightness } = await import('../../src/scripts/adaptiveMediaInk');
  const chip = document.createElement('button');
  for (const luma of [0.05, 0.5, 0.77]) {
    applyChipBrightness(chip, luma);
    assert.equal(chip.style.getPropertyValue('--chip-rest-brightness'), '1.06');
    assert.equal(chip.style.getPropertyValue('--chip-hover-brightness'), '1.12');
    assert.equal(chip.style.getPropertyValue('--chip-hover-ring'), 'rgb(255 255 255 / 0.12)');
  }
  for (const luma of [0.78, 1]) {
    applyChipBrightness(chip, luma);
    assert.equal(chip.style.getPropertyValue('--chip-rest-brightness'), '0.94');
    assert.equal(chip.style.getPropertyValue('--chip-hover-brightness'), '0.88');
    assert.equal(chip.style.getPropertyValue('--chip-hover-ring'), 'rgb(0 0 0 / 0.12)');
  }
});
