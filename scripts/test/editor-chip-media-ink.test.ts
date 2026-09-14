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
const { applyChipAppearance } = await import('../../src/scripts/adaptiveMediaInk');
const { chipContrastFill } = await import('../../src/scripts/chipContrast');

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}

function setRect(element: HTMLElement, value: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
}

function parseFill(value: string): { r: number; g: number; b: number; a: number } {
  const match = value.match(/^rgb\((\S+) (\S+) (\S+) \/ (\S+)\)$/);
  assert.ok(match, `expected serialized rgb fill, got ${value}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) };
}

function composite(top: { r: number; g: number; b: number; a: number }, bottom: { r: number; g: number; b: number; a: number }) {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  };
}

function runAppearance(luma: number, pixels: Uint8ClampedArray): HTMLElement {
  const chip = document.createElement('button');
  const originalCreateElement = document.createElement.bind(document);
  const previousStyle = globalThis.getComputedStyle;
  Object.assign(globalThis, {
    getComputedStyle: () => ({
      getPropertyValue: (name: string) => name === '--sys-color-on-dark-media' ? '#f5f5f7' : '#5a5a5a',
    }),
  });
  document.createElement = ((name: string) => {
    const element = originalCreateElement(name);
    if (name === 'canvas') {
      const context = {
        fillStyle: '', fillRect() {},
        getImageData() { return { data: new Uint8ClampedArray(this.fillStyle === '#f5f5f7' ? [245, 245, 247, 255] : [90, 90, 90, 255]) }; },
      };
      Object.defineProperty(element, 'getContext', { value: () => context });
    }
    return element;
  }) as typeof document.createElement;
  try {
    applyChipAppearance(chip, luma, { luma, pixels });
    return chip;
  } finally {
    document.createElement = originalCreateElement;
    Object.assign(globalThis, { getComputedStyle: previousStyle });
  }
}

function channelLuma(value: number): number {
  const encoded = value / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function contrast(fill: { r: number; g: number; b: number }, ink: { r: number; g: number; b: number }): number {
  const luma = (color: { r: number; g: number; b: number }) => 0.2126 * channelLuma(color.r) + 0.7152 * channelLuma(color.g) + 0.0722 * channelLuma(color.b);
  const a = luma(fill);
  const b = luma(ink);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function surface(pixel: { r: number; g: number; b: number }, factor: number, fill: { r: number; g: number; b: number; a: number }) {
  const background = { r: Math.min(255, pixel.r * factor), g: Math.min(255, pixel.g * factor), b: Math.min(255, pixel.b * factor), a: 1 };
  return composite(fill, background);
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


test('brightness refresh replaces a protective fill with the baseline tint', async () => {
  const { applyChipBrightness } = await import('../../src/scripts/adaptiveMediaInk');
  const chip = document.createElement('button');
  chip.style.setProperty('--chip-contrast-fill', 'rgb(0 0 0 / 0.8)');
  applyChipBrightness(chip, 0.9);
  assert.equal(chip.style.getPropertyValue('--chip-contrast-fill'), 'rgb(0 0 0 / 0.08)');
  assert.equal(chip.style.getPropertyValue('--chip-hover-contrast-fill'), 'rgb(0 0 0 / 0.08)');
});

test('final fills keep pale rest surfaces visibly darker and black surfaces visible', () => {
  const pale = runAppearance(0.9, new Uint8ClampedArray([242, 242, 244, 255]));
  const paleFill = parseFill(pale.style.getPropertyValue('--chip-contrast-fill'));
  const paleSurface = surface({ r: 242, g: 242, b: 244 }, 0.94, paleFill);
  assert.ok(242 - paleSurface.r >= 15);
  assert.ok(contrast(paleSurface, { r: 90, g: 90, b: 90 }) >= 4.5);
  const paleHoverSurface = surface({ r: 242, g: 242, b: 244 }, 0.88, parseFill(pale.style.getPropertyValue('--chip-hover-contrast-fill')));
  assert.ok(contrast(paleHoverSurface, { r: 90, g: 90, b: 90 }) >= 4.5);

  const black = runAppearance(0.01, new Uint8ClampedArray([0, 0, 0, 255]));
  const blackFill = parseFill(black.style.getPropertyValue('--chip-contrast-fill'));
  assert.ok(blackFill.r * blackFill.a >= 15);
});

test('rest and hover final fills retain independent 95 percent contrast coverage', () => {
  const pixels = new Uint8ClampedArray([
    ...Array.from({ length: 96 }, () => [242, 242, 244, 255]).flat(),
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
  const chip = runAppearance(0.7, pixels);
  const restFill = parseFill(chip.style.getPropertyValue('--chip-contrast-fill'));
  const hoverFill = parseFill(chip.style.getPropertyValue('--chip-hover-contrast-fill'));
  const ink = { r: 90, g: 90, b: 90 };
  let restPass = 0;
  let hoverPass = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const pixel = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
    const restSurface = surface(pixel, 1.06, restFill);
    const hoverSurface = surface(pixel, 1.12, hoverFill);
    if (contrast(restSurface, ink) >= 4.5) restPass += 1;
    if (contrast(hoverSurface, ink) >= 4.5) hoverPass += 1;
  }
  assert.ok(restPass >= Math.ceil((pixels.length / 4) * 0.95));
  assert.ok(hoverPass >= Math.ceil((pixels.length / 4) * 0.95));
});

test('serialized fill matches sequential baseline tint and protection compositing', () => {
  const pixels = new Uint8ClampedArray([242, 242, 244, 255]);
  const chip = runAppearance(0.9, pixels);
  const actual = parseFill(chip.style.getPropertyValue('--chip-hover-contrast-fill'));
  const baseTint = { r: 0, g: 0, b: 0, a: 0.08 };
  const protection = chipContrastFill(pixels, { r: 90, g: 90, b: 90, a: 1 }, [0.88], baseTint);
  const backdrop = { r: 242 * 0.88, g: 242 * 0.88, b: 244 * 0.88, a: 1 };
  const sequential = composite(
    { r: protection.color, g: protection.color, b: protection.color, a: protection.opacity },
    composite(baseTint, backdrop),
  );
  const serialized = composite(actual, backdrop);
  assert.ok(Math.abs(serialized.r - sequential.r) < 0.01);
  assert.ok(Math.abs(serialized.g - sequential.g) < 0.01);
  assert.ok(Math.abs(serialized.b - sequential.b) < 0.01);
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
    assert.match(chip.style.getPropertyValue('--chip-contrast-fill'), /^rgb\([0-9]+(?:\.[0-9]+)? [0-9]+(?:\.[0-9]+)? [0-9]+(?:\.[0-9]+)? \/ 0\.[0-9]+\)$/);
    applyChipAppearance(chip, 0.5, { luma: 0.5, pixels: new Uint8ClampedArray([188, 188, 188, 255]) });
    assert.equal(chip.dataset.mediaGround, 'light');
    applyMediaGround(chip, 'dark');
    applyChipAppearance(chip, 0.01, { luma: 0.01, pixels: new Uint8ClampedArray([10, 10, 10, 255]) });
    assert.equal(chip.style.getPropertyValue('--chip-contrast-fill'), 'rgb(255 255 255 / 0.08)');
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
