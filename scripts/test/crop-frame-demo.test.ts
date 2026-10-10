import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoImageCrop } from '../../src/lib/demoImageCrop';
import type { DemoImageCropState } from '../../src/lib/demoImageCrop';
import { coverWidthFraction } from '../../src/lib/responsiveImage';

const frame = (win: Window) => new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));

function setup({ sourceAspect = 16 / 9, initialAspect = 'original', initialState, active = true, onChange }: { sourceAspect?: number; initialAspect?: string; initialState?: DemoImageCropState; active?: boolean; onChange?: () => void } = {}) {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<div data-crop-demo>
    <div class="dev-controls">
      <div data-crop-preview><img src="/preview.jpg" alt="Preview" data-crop-image></div>
      <select class="dev-select__native">
        <option value="original">Original</option><option value="4:3">4:3</option><option value="1:1">1:1</option><option value="3:4">3:4</option>
      </select>
      <button data-crop-center-x>Center X</button><button data-crop-center-y>Center Y</button>
      <button data-crop-fit>Fit</button>
      <button data-crop-constraint><span data-crop-constraint-state></span></button>
      <button data-crop-reset>Reset</button>
    </div>
    <div class="project-image"><div class="project-crop-clip"><img src="/source.jpg" alt="Source"></div></div>
  </div>`;
  const root = document.body.firstElementChild as HTMLElement;
  const host = root.querySelector('.project-image') as HTMLElement;
  const controls = root.querySelector('.dev-controls') as HTMLElement;
  const stageRect = { width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 } as DOMRect;
  const stage = () => host.querySelector('.dev-crop-stage') as HTMLElement;
  const preview = root.querySelector('[data-crop-preview]') as HTMLElement;
  const setRects = () => {
    stage().getBoundingClientRect = () => stageRect;
    preview.getBoundingClientRect = () => stageRect;
  };
  const captures = new Set<number>();
  const pointer = (target: Element, type: string, values: Record<string, number> = {}) => {
    const event = new win.Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
    Object.assign(event, { button: 0, pointerId: 4, clientX: 200, clientY: 150 }, values);
    target.dispatchEvent(event);
    return event;
  };
  let paints = 0;
  const api = createDemoImageCrop({ host, controls, sourceAspect, initialAspect, initialState, active, onChange: () => { paints += 1; onChange?.(); } });
  setRects();
  return {
    win, document, root, host, controls, stage, preview, captures, pointer, api, paints: () => paints,
    select: controls.querySelector('select') as HTMLSelectElement,
    reset: controls.querySelector('[data-crop-reset]') as HTMLButtonElement,
    constraint: controls.querySelector('[data-crop-constraint]') as HTMLButtonElement,
    centerX: controls.querySelector('[data-crop-center-x]') as HTMLButtonElement,
    centerY: controls.querySelector('[data-crop-center-y]') as HTMLButtonElement,
    fit: controls.querySelector('[data-crop-fit]') as HTMLButtonElement,
  };
}

test('original finite non-4:3 source renders finite crop and preview state', () => {
  const h = setup();
  expect(h.host.dataset.cropAspect).toBe('original');
  expect(Number.isFinite(Number(h.host.style.getPropertyValue('--project-content-w-desktop')))).toBe(true);
  expect(h.preview.style.aspectRatio).toBe(`${16 / 9} / 1`);
  expect(h.preview.style.getPropertyValue('--tuner-content-w')).not.toBe('');
  h.api.destroy();
});

test('preview pan and resize keep both surfaces synchronized', async () => {
  const h = setup({ initialAspect: '4:3' });
  const stage = h.stage();
  stage.setPointerCapture = (id: number) => h.captures.add(id);
  stage.releasePointerCapture = (id: number) => h.captures.delete(id);
  stage.hasPointerCapture = (id: number) => h.captures.has(id);
  h.pointer(stage, 'pointerdown');
  h.pointer(stage, 'pointermove', { clientX: 240, clientY: 120 });
  await frame(h.win);
  expect(h.preview.style.getPropertyValue('--tuner-content-cx')).toBe(h.host.style.getPropertyValue('--project-content-cx-desktop'));
  expect(h.preview.style.getPropertyValue('--tuner-content-cy')).toBe(h.host.style.getPropertyValue('--project-content-cy-desktop'));
  const east = stage.querySelector('[data-page-resize="e"]')!;
  h.pointer(east, 'pointerdown', { clientX: 200 });
  h.pointer(stage, 'pointermove', { clientX: 260 });
  await frame(h.win);
  expect(h.host.dataset.cropAspect).toBe('400:261');
  expect(h.preview.style.aspectRatio).toBe(`${h.root.style.getPropertyValue('--crop-demo-aspect')} / 1`);
  h.pointer(stage, 'pointerup', { clientX: 260 });
  h.api.destroy();
});

test('pointermove paints once per frame with the latest pose', async () => {
  const h = setup({ initialAspect: '1:1' });
  const stage = h.stage();
  stage.setPointerCapture = (id: number) => h.captures.add(id);
  stage.releasePointerCapture = (id: number) => h.captures.delete(id);
  stage.hasPointerCapture = (id: number) => h.captures.has(id);
  const before = h.paints();
  h.pointer(stage, 'pointerdown');
  h.pointer(stage, 'pointermove', { clientX: 220, clientY: 150 });
  h.pointer(stage, 'pointermove', { clientX: 260, clientY: 150 });
  expect(h.paints()).toBe(before);
  expect(h.api.getState().crop.cx).toBeLessThan(0.5);
  await frame(h.win);
  expect(h.paints()).toBe(before + 1);
  expect(h.host.style.getPropertyValue('--project-content-cx-desktop')).toBe(String(h.api.getState().crop.cx));
  h.pointer(stage, 'pointerup', { clientX: 260, clientY: 150 });
  h.api.destroy();
});

test('pointerup flushes the final pending pose before the next frame', async () => {
  const h = setup({ initialAspect: '1:1' });
  const stage = h.stage();
  stage.setPointerCapture = (id: number) => h.captures.add(id);
  stage.releasePointerCapture = (id: number) => h.captures.delete(id);
  stage.hasPointerCapture = (id: number) => h.captures.has(id);
  const before = h.paints();
  h.pointer(stage, 'pointerdown');
  h.pointer(stage, 'pointermove', { clientX: 260, clientY: 150 });
  h.pointer(stage, 'pointerup', { clientX: 260, clientY: 150 });
  expect(h.paints()).toBe(before + 1);
  const painted = h.host.style.getPropertyValue('--project-content-cx-desktop');
  await frame(h.win);
  expect(h.paints()).toBe(before + 1);
  expect(h.host.style.getPropertyValue('--project-content-cx-desktop')).toBe(painted);
  h.api.destroy();
});

test('wheel pan is unchanged when timestamped events share or split RAF buckets', async () => {
  const dispatchWheel = (h: ReturnType<typeof setup>, deltaX: number, timeStamp: number) => {
    const event = new h.win.Event('wheel', { cancelable: true }) as Event & Record<string, unknown>;
    Object.assign(event, { deltaX, deltaY: 0, deltaMode: 0, clientX: 200, clientY: 150 });
    Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp });
    h.stage().dispatchEvent(event);
  };
  const split = setup({ initialAspect: '1:1' });
  dispatchWheel(split, 10, 0);
  await frame(split.win);
  dispatchWheel(split, 10, 16);
  await frame(split.win);
  dispatchWheel(split, 10, 32);
  await frame(split.win);
  const splitState = split.api.getState();

  const burst = setup({ initialAspect: '1:1' });
  dispatchWheel(burst, 10, 0);
  dispatchWheel(burst, 10, 16);
  dispatchWheel(burst, 10, 32);
  await frame(burst.win);
  const burstState = burst.api.getState();
  expect(burstState.crop.cx).toBeGreaterThan(0.5);
  expect(burstState.crop.cx).toBe(splitState.crop.cx);
  expect(burstState.crop.cy).toBe(splitState.crop.cy);
  split.api.destroy();
  burst.api.destroy();
});

test('pan samples warm the existing zoom EMA without changing pure zoom', async () => {
  const zoomGain = (speed: number) => {
    const t = Math.min(1, Math.max(0, speed) / 40);
    const blend = t * t * (3 - 2 * t);
    return 0.00085 + (0.0022 - 0.00085) * blend;
  };
  const ema = (speed: number, magnitude: number) => speed + (magnitude - speed) * 0.32;
  const dispatchWheel = (h: ReturnType<typeof setup>, values: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; timeStamp: number }) => {
    const event = new h.win.Event('wheel', { cancelable: true }) as Event & Record<string, unknown>;
    for (const [key, value] of Object.entries({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, clientX: 200, clientY: 150, ...values })) {
      Object.defineProperty(event, key, { configurable: true, value });
    }
    h.stage().dispatchEvent(event);
  };
  const pure = setup({ initialAspect: '1:1' });
  const initialWidth = pure.api.getState().crop.w;
  dispatchWheel(pure, { deltaY: 20, ctrlKey: true, timeStamp: 0 });
  await frame(pure.win);
  dispatchWheel(pure, { deltaY: 20, ctrlKey: true, timeStamp: 16 });
  await frame(pure.win);
  const pureWidth = pure.api.getState().crop.w;
  let pureSpeed = ema(0, 20);
  const pureGain1 = zoomGain(pureSpeed);
  pureSpeed = ema(pureSpeed, 20);
  const pureGain2 = zoomGain(pureSpeed);
  expect(pureWidth).toBeCloseTo(initialWidth * Math.exp(20 * (pureGain1 + pureGain2)), 10);

  const mixed = setup({ initialAspect: '1:1' });
  dispatchWheel(mixed, { deltaY: 20, ctrlKey: true, timeStamp: 0 });
  await frame(mixed.win);
  dispatchWheel(mixed, { deltaX: 10, timeStamp: 16 });
  await frame(mixed.win);
  dispatchWheel(mixed, { deltaY: 20, ctrlKey: true, timeStamp: 32 });
  await frame(mixed.win);
  const mixedWidth = mixed.api.getState().crop.w;
  let mixedSpeed = ema(0, 20);
  const mixedGain1 = zoomGain(mixedSpeed);
  mixedSpeed = ema(mixedSpeed, 10);
  mixedSpeed = ema(mixedSpeed, 20);
  const mixedGain2 = zoomGain(mixedSpeed);
  expect(mixedWidth).toBeCloseTo(initialWidth * Math.exp(20 * (mixedGain1 + mixedGain2)), 10);
  expect(mixedWidth).toBeGreaterThan(pureWidth);
  expect(mixedWidth).toBeGreaterThan(initialWidth);
  pure.api.destroy();
  mixed.api.destroy();

  const startup = setup({ initialAspect: '1:1' });
  const startupWidth = startup.api.getState().crop.w;
  dispatchWheel(startup, { deltaX: 40, timeStamp: 0 });
  await frame(startup.win);
  dispatchWheel(startup, { deltaY: 10, ctrlKey: true, timeStamp: 16 });
  await frame(startup.win);
  const startupSpeed = ema(ema(0, 40), 10);
  expect(startup.api.getState().crop.w).toBeCloseTo(startupWidth * Math.exp(10 * zoomGain(startupSpeed)), 10);
  startup.api.destroy();
});

test('reset and destroy cancel stale pointer paints', async () => {
  const reset = setup({ initialAspect: '1:1' });
  const resetStage = reset.stage();
  resetStage.setPointerCapture = (id: number) => reset.captures.add(id);
  resetStage.releasePointerCapture = (id: number) => reset.captures.delete(id);
  resetStage.hasPointerCapture = (id: number) => reset.captures.has(id);
  const resetBefore = reset.paints();
  reset.pointer(resetStage, 'pointerdown');
  reset.pointer(resetStage, 'pointermove', { clientX: 260, clientY: 150 });
  reset.api.reset();
  const resetAfter = reset.paints();
  await frame(reset.win);
  expect(reset.paints()).toBe(resetAfter);
  expect(reset.paints()).toBe(resetBefore + 1);
  reset.api.destroy();

  const destroyed = setup({ initialAspect: '1:1' });
  const destroyedStage = destroyed.stage();
  destroyedStage.setPointerCapture = (id: number) => destroyed.captures.add(id);
  destroyedStage.releasePointerCapture = (id: number) => destroyed.captures.delete(id);
  destroyedStage.hasPointerCapture = (id: number) => destroyed.captures.has(id);
  const destroyedBefore = destroyed.paints();
  destroyed.pointer(destroyedStage, 'pointerdown');
  destroyed.pointer(destroyedStage, 'pointermove', { clientX: 260, clientY: 150 });
  destroyed.api.destroy();
  await frame(destroyed.win);
  expect(destroyed.paints()).toBe(destroyedBefore);
});

test('center controls restore one axis independently', () => {
  const h = setup({ initialAspect: '1:1' });
  h.pointer(h.stage(), 'pointerdown');
  h.pointer(h.stage(), 'pointermove', { clientX: 260, clientY: 210 });
  h.pointer(h.stage(), 'pointerup');
  h.centerX.click();
  expect(h.host.style.getPropertyValue('--project-content-cx-desktop')).toBe('0.5');
  expect(h.host.style.getPropertyValue('--project-content-cy-desktop')).not.toBe('0.5');
  h.centerY.click();
  expect(h.host.style.getPropertyValue('--project-content-cy-desktop')).toBe('0.5');
  h.api.destroy();
});

test('fit unlocks and contains the frame, then unlock allows outside bounds and relock clamps', () => {
  const h = setup({ sourceAspect: 2, initialAspect: '1:1' });
  expect(h.constraint.getAttribute('aria-pressed')).toBe('true');
  h.fit.click();
  expect(h.constraint.getAttribute('aria-pressed')).toBe('false');
  expect(Number(h.host.style.getPropertyValue('--project-content-w-desktop'))).toBeGreaterThanOrEqual(1);
  h.pointer(h.stage(), 'pointerdown');
  h.pointer(h.stage(), 'pointermove', { clientX: -1000, clientY: 1400 });
  h.pointer(h.stage(), 'pointerup');
  const outsideX = Number(h.host.style.getPropertyValue('--project-content-cx-desktop'));
  expect(outsideX).toBeGreaterThan(1);
  h.constraint.click();
  expect(h.constraint.getAttribute('aria-pressed')).toBe('true');
  expect(Number(h.host.style.getPropertyValue('--project-content-cx-desktop'))).toBeGreaterThanOrEqual(0);
  h.api.destroy();
});

test('wheel batching and repeated reset restore finite locked state', async () => {
  const h = setup({ initialAspect: '4:3' });
  const stage = h.stage();
  const wheel = new h.win.Event('wheel', { cancelable: true });
  Object.assign(wheel, { ctrlKey: true, deltaY: -60, deltaX: 0, clientX: 200, clientY: 150 });
  stage.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  await frame(h.win);
  expect(Number(h.host.style.getPropertyValue('--project-content-w-desktop'))).toBeLessThan(0.8);
  h.reset.click();
  h.reset.click();
  expect(h.select.value).toBe('4:3');
  expect(h.constraint.getAttribute('aria-pressed')).toBe('true');
  expect(h.select.querySelector('[data-crop-custom]')).toBeNull();
  h.api.destroy();
});

test('inactive crop stage cannot focus, pan, resize, or wheel', () => {
  const h = setup({ active: false });
  const stage = h.stage();
  expect(stage.tabIndex).toBe(-1);
  expect(stage.getAttribute('aria-hidden')).toBe('true');
  expect(stage.style.pointerEvents).toBe('none');
  const wheel = h.pointer(stage, 'wheel', { deltaY: -40 });
  expect(wheel.defaultPrevented).toBe(false);
  const key = new h.win.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
  stage.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  h.api.setActive(true);
  expect(stage.tabIndex).toBe(0);
  expect(stage.getAttribute('aria-hidden')).toBe('false');
  h.api.destroy();
});

test('pointer focus marker suppresses the ring until keyboard or blur focus', () => {
  const h = setup();
  const stage = h.stage();
  h.pointer(stage, 'pointerdown');
  expect(stage.hasAttribute('data-pointer-focus')).toBe(true);
  h.pointer(stage, 'pointerup');
  expect(stage.hasAttribute('data-pointer-focus')).toBe(true);
  stage.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
  expect(stage.hasAttribute('data-pointer-focus')).toBe(false);
  h.pointer(stage, 'pointerdown');
  expect(stage.hasAttribute('data-pointer-focus')).toBe(true);
  stage.dispatchEvent(new h.win.Event('blur'));
  expect(stage.hasAttribute('data-pointer-focus')).toBe(false);
  h.api.destroy();
});

test('direct pan and zoom reject invalid values, inactive edits, and respect locked bounds', () => {
  const h = setup({ initialAspect: '1:1' });
  const before = h.api.getState();
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(h.api.panBy(value, 0)).toBe(false);
    expect(h.api.zoomBy(value)).toBe(false);
  }
  expect(h.api.zoomBy(0)).toBe(false);
  expect(h.api.getState()).toEqual(before);
  h.api.panBy(100, 100);
  const locked = h.api.getState();
  expect(locked.crop.cx).toBeGreaterThanOrEqual(locked.crop.w / 2);
  expect(locked.crop.cx).toBeLessThanOrEqual(1 - locked.crop.w / 2);
  const halfHeight = locked.crop.w * (16 / 9) / 2;
  expect(locked.crop.cy).toBeGreaterThanOrEqual(halfHeight);
  expect(locked.crop.cy).toBeLessThanOrEqual(1 - halfHeight);
  h.api.setActive(false);
  expect(h.api.panBy(0.1, 0.1)).toBe(false);
  expect(h.api.zoomBy(1.1)).toBe(false);
  h.api.destroy();
});

test('valid direct crop edits render and notify changes', () => {
  let changes = 0;
  const h = setup({ initialAspect: '1:1', onChange: () => { changes += 1; } });
  const before = changes;
  expect(h.api.panBy(0.01, 0.01)).toBe(true);
  expect(changes).toBeGreaterThan(before);
  const afterPan = changes;
  expect(h.api.zoomBy(1.12)).toBe(true);
  expect(changes).toBeGreaterThan(afterPan);
  h.api.destroy();
});

test('destroy removes crop stage, ghost, and listeners', () => {
  const h = setup();
  h.api.destroy();
  expect(h.host.querySelector('.dev-crop-stage')).toBeNull();
  expect(h.host.querySelector('.dev-crop-ghost')).toBeNull();
  expect(h.host.classList.contains('dev-crop-stage-host')).toBe(false);
});

test('setSource synchronizes source imagery and reset restores the original', () => {
  const h = setup();
  expect(h.api.setSource({ src: '/replacement.jpg', width: 1000, height: 500, alt: 'Replacement' })).toBe(true);
  expect(h.host.querySelector('img')?.src).toContain('/replacement.jpg');
  expect(h.preview.querySelector('img')?.getAttribute('src')).toContain('/replacement.jpg');
  expect(h.stage().previousElementSibling?.querySelector('img')?.getAttribute('src')).toContain('/replacement.jpg');
  expect(h.api.setSource({ src: '', width: 0, height: 500 })).toBe(false);
  h.api.reset();
  expect(h.host.querySelector('.project-crop-clip img')?.src).toContain('/source.jpg');
  expect(h.preview.querySelector('img')?.getAttribute('src')).toContain('/source.jpg');
  h.api.destroy();
});

test('setSource starts a fresh centered crop for the replacement aspect', () => {
  const h = setup({ initialAspect: '4:3', initialState: {
    source: { src: '/saved.jpg', width: 1200, height: 800, alt: 'Saved' },
    crop: { aspect: '3:2', cx: 0.2, cy: 0.8, w: 0.35 },
    locked: false,
  } });
  expect(h.api.setSource({ src: '/portrait.jpg', width: 100, height: 1000, alt: 'Portrait' })).toBe(true);
  const state = h.api.getState();
  expect(state.crop.aspect).toBe('4:3');
  expect(state.crop.cx).toBe(0.5);
  expect(state.crop.cy).toBe(0.5);
  expect(state.locked).toBe(true);
  expect(state.crop.w).toBeCloseTo(coverWidthFraction('4:3', 0.1) / 1.25);
  h.api.destroy();
});

test('replacement dimensions drive Original and Fit before reset restores source metadata', () => {
  const h = setup({ initialAspect: '4:3' });
  expect(h.api.setSource({ src: '/portrait.jpg', width: 400, height: 800, alt: 'Portrait' })).toBe(true);
  h.select.value = 'original';
  h.select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  expect(h.preview.style.aspectRatio).toBe('0.5 / 1');
  h.select.value = '4:3';
  h.select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  h.fit.click();
  expect(Number(h.host.style.getPropertyValue('--project-content-w-desktop'))).toBeCloseTo(8 / 3);
  h.api.reset();
  expect(h.host.querySelector('.project-crop-clip img')?.alt).toBe('Source');
  expect(h.select.value).toBe('4:3');
  h.api.destroy();
});

test('initial state becomes the reset baseline and round trips through a deep copy', () => {
  const initialState: DemoImageCropState = {
    source: { src: '/saved.jpg', width: 1200, height: 800, alt: 'Saved source' },
    crop: { aspect: '3:2', cx: 0.62, cy: 0.38, w: 0.72 },
    locked: false,
  };
  const h = setup({ initialState });
  const snapshot = h.api.getState();
  expect(snapshot).toEqual(initialState);
  snapshot.source.src = '/mutated.jpg';
  snapshot.crop.cx = 0.1;
  expect(h.api.getState()).toEqual(initialState);
  expect(h.api.restore({ ...initialState, crop: { ...initialState.crop, cx: 0.3 } })).toBe(true);
  expect(h.api.getState().crop.cx).toBe(0.3);
  h.api.reset();
  expect(h.api.getState()).toEqual(initialState);
  expect(h.host.querySelector('.project-crop-clip img')?.src).toContain('/saved.jpg');
  h.api.destroy();
});

test('invalid restore preserves the current state without releasing or rendering', () => {
  const h = setup();
  const before = h.api.getState();
  const invalid = [
    { ...before, source: { ...before.source, width: 0 } },
    { ...before, crop: { ...before.crop, aspect: '0:3' } },
    { ...before, crop: { ...before.crop, w: 0 } },
    { ...before, locked: 'yes' },
  ] as unknown as DemoImageCropState[];
  invalid.forEach((state) => expect(h.api.restore(state)).toBe(false));
  expect(h.api.getState()).toEqual(before);
  h.api.destroy();
});

test('responsive variants edit independently and restore atomically', () => {
  const initialState: DemoImageCropState = {
    source: { src: '/saved.jpg', width: 1200, height: 800, alt: 'Saved source' },
    crop: { aspect: '3:2', cx: 0.2, cy: 0.3, w: 0.6 },
    variants: {
      desktop: { aspect: '3:2', cx: 0.4, cy: 0.3, w: 0.6 },
      tablet: { aspect: '4:3', cx: 0.7, cy: 0.4, w: 0.5 },
      mobile: { aspect: '1:1', cx: 0.4, cy: 0.8, w: 0.4 },
    },
    locked: true,
  };
  const h = setup({ initialState });
  h.api.setViewport('tablet');
  h.centerX.click();
  expect(h.host.style.getPropertyValue('--project-content-cx-desktop')).toBe('0.4');
  expect(h.host.style.getPropertyValue('--project-content-cx-tablet')).toBe('0.5');
  h.api.setViewport('mobile');
  expect(h.select.value).toBe('1:1');
  expect(h.api.getState().crop.cx).toBe(0.4);
  h.api.setViewport('desktop');
  expect(h.api.getState().crop.cx).toBe(0.4);
  const before = h.api.getState();
  const untouched = structuredClone(before);
  before.variants!.tablet.cx = 0.1;
  expect(h.api.getState().variants!.tablet.cx).toBe(0.5);
  expect(h.api.restore({ ...untouched, variants: { ...untouched.variants!, tablet: { ...untouched.variants!.tablet, w: 0 } } })).toBe(false);
  expect(h.api.getState()).toEqual(untouched);
  h.api.destroy();
});

test('restore returns every saved pose and keeps the selected viewport', () => {
  const h = setup({ initialState: {
    source: { src: '/saved.jpg', width: 1200, height: 800, alt: 'Saved source' },
    crop: { aspect: '3:2', cx: 0.4, cy: 0.3, w: 0.6 },
    variants: {
      desktop: { aspect: '3:2', cx: 0.4, cy: 0.3, w: 0.6 },
      tablet: { aspect: '4:3', cx: 0.7, cy: 0.4, w: 0.5 },
      mobile: { aspect: '1:1', cx: 0.4, cy: 0.8, w: 0.4 },
    },
    locked: true,
  } });
  h.api.setViewport('tablet');
  h.centerY.click();
  h.api.setViewport('mobile');
  h.centerX.click();
  const saved = h.api.getState();
  h.api.setViewport('desktop');
  h.centerX.click();
  expect(h.api.restore(saved)).toBe(true);
  expect(h.api.getViewport()).toBe('desktop');
  expect(h.api.getState().variants).toEqual(saved.variants);
  h.api.setViewport('tablet');
  expect(h.api.getState().crop).toEqual(saved.variants!.tablet);
  h.api.setViewport('mobile');
  expect(h.api.getState().crop).toEqual(saved.variants!.mobile);
  h.api.destroy();
});

test('switching to an out-of-bounds saved pose infers unlocked compatibility', () => {
  const h = setup({ initialState: {
    source: { src: '/saved.jpg', width: 1200, height: 800, alt: 'Saved source' },
    crop: { aspect: '3:2', cx: 0.5, cy: 0.5, w: 0.6 },
    variants: {
      desktop: { aspect: '3:2', cx: 0.5, cy: 0.5, w: 0.6 },
      tablet: { aspect: '4:3', cx: 0.95, cy: 0.1, w: 0.5 },
      mobile: { aspect: '1:1', cx: 0.5, cy: 0.5, w: 0.4 },
    },
    locked: true,
  } });
  h.api.setViewport('tablet');
  expect(h.api.getState().locked).toBe(false);
  expect(h.api.getState().crop.cx).toBe(0.95);
  expect(h.api.getState().crop.cy).toBe(0.1);
  h.api.destroy();
});

test('locked keyboard pan stays clamped and relocking an outside crop clamps it', () => {
  const h = setup({ initialAspect: '1:1' });
  const key = (key: string) => h.stage().dispatchEvent(new h.win.KeyboardEvent('keydown', { key, cancelable: true }));
  for (let i = 0; i < 30; i += 1) key('ArrowRight');
  expect(h.api.getState().locked).toBe(true);
  expect(h.api.getState().crop.cx).toBeLessThanOrEqual(1 - h.api.getState().crop.w / 2);
  h.constraint.click();
  for (let i = 0; i < 30; i += 1) key('ArrowRight');
  expect(h.api.getState().crop.cx).toBeGreaterThan(1);
  h.constraint.click();
  expect(h.api.getState().locked).toBe(true);
  expect(h.api.getState().crop.cx).toBeLessThanOrEqual(1 - h.api.getState().crop.w / 2);
  h.api.destroy();
});
