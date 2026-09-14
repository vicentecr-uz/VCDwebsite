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


test('brightness refresh clears a protective fill left by the previous image', async () => {
  const { applyChipBrightness } = await import('../../src/scripts/adaptiveMediaInk');
  const chip = document.createElement('button');
  chip.style.setProperty('--chip-contrast-fill', 'rgb(0 0 0 / 0.8)');
  applyChipBrightness(chip, 0.9);
  assert.equal(chip.style.getPropertyValue('--chip-contrast-fill'), '');
});

test('mid-tone and light backgrounds keep light chips even when a dark fill would be thinner', async () => {
  const { applyChipAppearance, applyMediaGround } = await import('../../src/scripts/adaptiveMediaInk');
  const chip = document.createElement('button');
  const originalCreateElement = document.createElement.bind(document);
  const previousStyle = globalThis.getComputedStyle;
  Object.assign(globalThis, { getComputedStyle: () => ({
    getPropertyValue: (name: string) => name === '--sys-color-on-dark-media' ? '#f5f5f7' : '#6d6d6d',
  }) });
  document.createElement = ((name: string) => {
    const element = originalCreateElement(name);
    if (name === 'canvas') {
      const context = {
        fillStyle: '', clearRect() {}, fillRect() {},
        getImageData() {
          return { data: new Uint8ClampedArray(this.fillStyle === '#f5f5f7'
            ? [245, 245, 247, 255] : [109, 109, 109, 255]) };
        },
      };
      Object.defineProperty(element, 'getContext', { value: () => context });
    }
    return element;
  }) as typeof document.createElement;
  try {
    applyMediaGround(chip, 'light');
    applyChipAppearance(chip, 0.7, { luma: 0.7, pixels: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) });
    assert.equal(chip.dataset.mediaGround, 'light');
    assert.match(chip.style.getPropertyValue('--chip-contrast-fill'), /^rgb\(255 255 255 \/ 0\.[0-9]+\)$/);
    applyChipAppearance(chip, 0.1, { luma: 0.1, pixels: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) });
    assert.match(chip.style.getPropertyValue('--chip-contrast-fill'), /^rgb\(0 0 0 \/ 0\.[0-9]+\)$/);
    applyChipAppearance(chip, 0.5, { luma: 0.5, pixels: new Uint8ClampedArray([188, 188, 188, 255]) });
    assert.equal(chip.dataset.mediaGround, 'light');
    applyMediaGround(chip, 'dark');
    applyChipAppearance(chip, 0.01, { luma: 0.01, pixels: new Uint8ClampedArray([10, 10, 10, 255]) });
    assert.equal(chip.style.getPropertyValue('--chip-contrast-fill'), '');
  } finally {
    document.createElement = originalCreateElement;
    Object.assign(globalThis, { getComputedStyle: previousStyle });
  }
});

test('computes token contrast before clearing the previous fill', async () => {
  const { applyChipAppearance } = await import('../../src/scripts/adaptiveMediaInk');
  const chip = document.createElement('button');
  chip.style.setProperty('--chip-contrast-fill', 'rgb(0 0 0 / 0.8)');
  const originalCreateElement = document.createElement.bind(document);
  const previousStyle = globalThis.getComputedStyle;
  const events: string[] = [];
  Object.assign(globalThis, {
    getComputedStyle: () => ({
      getPropertyValue: (name: string) => {
        events.push(`read:${name}`);
        return name === '--sys-color-on-dark-media' ? '#f5f5f7' : '#6d6d6d';
      },
    }),
  });
  document.createElement = ((name: string) => {
    const element = originalCreateElement(name);
    if (name === 'canvas') {
      const context = {
        fillStyle: '', clearRect() {}, fillRect() {},
        getImageData() {
          return { data: new Uint8ClampedArray(this.fillStyle === '#f5f5f7'
            ? [245, 245, 247, 255] : [109, 109, 109, 255]) };
        },
      };
      Object.defineProperty(element, 'getContext', { value: () => context });
    }
    return element;
  }) as typeof document.createElement;
  const originalSet = chip.style.setProperty.bind(chip.style);
  const originalRemove = chip.style.removeProperty.bind(chip.style);
  chip.style.setProperty = ((name: string, value: string) => {
    events.push(`set:${name}`);
    originalSet(name, value);
  }) as typeof chip.style.setProperty;
  chip.style.removeProperty = ((name: string) => {
    events.push(`remove:${name}`);
    return originalRemove(name);
  }) as typeof chip.style.removeProperty;
  try {
    const sample = { luma: 0.7, pixels: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
    applyChipAppearance(chip, sample.luma, sample);
    const firstMutation = events.findIndex((event) => event.startsWith('set:') || event.startsWith('remove:'));
    assert.ok(firstMutation >= 0);
    assert.ok(events.slice(0, firstMutation).every((event) => event.startsWith('read:')));
    assert.equal(events.filter((event) => event.startsWith('read:')).length, 1);
    assert.equal(events.slice(firstMutation).filter((event) => event.startsWith('read:')).length, 0);
    assert.match(chip.style.getPropertyValue('--chip-contrast-fill'), /^rgb\(255 255 255 \/ 0\.[0-9]+\)$/);
    const firstFill = chip.style.getPropertyValue('--chip-contrast-fill');
    const beforeRepeat = events.length;
    applyChipAppearance(chip, sample.luma, sample);
    const repeatEvents = events.slice(beforeRepeat);
    const repeatMutation = repeatEvents.findIndex((event) => event.startsWith('set:') || event.startsWith('remove:'));
    assert.ok(repeatMutation >= 0);
    assert.equal(repeatEvents.slice(repeatMutation).filter((event) => event.startsWith('read:')).length, 0);
    assert.equal(chip.style.getPropertyValue('--chip-contrast-fill'), firstFill);
  } finally {
    document.createElement = originalCreateElement;
    Object.assign(globalThis, { getComputedStyle: previousStyle });
  }
});
