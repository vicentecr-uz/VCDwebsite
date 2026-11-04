import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDevPanelCollapse } from '../../src/lib/devPanelCollapse';

function setup(reduced = false, prepare?: () => void, devOverlay = true) {
  const win = new Window({ url: 'http://localhost/' });
  win.matchMedia = (() => ({ matches: reduced, media: '(prefers-reduced-motion: reduce)', addListener() {}, removeListener() {} })) as typeof win.matchMedia;
  win.document.body.innerHTML = `<section class="dev-panel dev-overlay"><header><button data-minimize-toggle aria-expanded="true" aria-label="Minimize"></button></header><div data-overlay-body><input /></div></section>`;
  const panel = win.document.querySelector('.dev-panel') as HTMLElement;
  if (!devOverlay) panel.classList.remove('dev-overlay');
  const body = panel.querySelector('[data-overlay-body]') as HTMLElement;
  body.style.opacity = '1';
  panel.style.paddingBottom = '12px';
  body.style.borderBottomLeftRadius = '12px';
  body.style.borderBottomRightRadius = '10px';
  body.style.clipPath = 'inset(1px)';
  const button = panel.querySelector('button') as HTMLButtonElement;
  Object.defineProperty(panel, 'getBoundingClientRect', { configurable: true, value: () => {
    const explicitHeight = Number.parseFloat(panel.style.height);
    const height = panel.classList.contains('is-minimized') ? 40 : Number.isFinite(explicitHeight) ? explicitHeight : 120;
    return { height, width: 200, top: 0, left: 0, right: 200, bottom: height };
  } });
  Object.defineProperty(body, 'getBoundingClientRect', { configurable: true, value: () => ({ height: 80, width: 180, top: 32, left: 10, right: 190, bottom: 112 }) });
  const pending: Array<{ resolve(): void; cancel(): void; keyframes: Keyframe[]; target: HTMLElement; options?: KeyframeAnimationOptions; cancelCount: number }> = [];
  const animate = function (this: HTMLElement, keyframes: Keyframe[], options?: KeyframeAnimationOptions) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const record = { resolve, cancel: () => { record.cancelCount += 1; }, keyframes, target: this, options, cancelCount: 0 };
    pending.push(record);
    this.animate = animate as typeof this.animate;
    return { finished, cancel: record.cancel } as unknown as Animation;
  };
  panel.animate = animate as typeof panel.animate;
  body.animate = animate as typeof body.animate;
  const callbacks: string[] = [];
  const stateChanges: Array<{ minimized: boolean; hidden: boolean; height: number }> = [];
  const api = createDevPanelCollapse(panel, {
    beforeChange: () => callbacks.push('before'),
    afterStateChange: () => {
      prepare?.();
      stateChanges.push({
        minimized: panel.classList.contains('is-minimized'),
        hidden: body.hidden,
        height: panel.getBoundingClientRect().height,
      });
    },
    afterChange: () => callbacks.push('after'),
  });
  return { win, panel, body, button, pending, callbacks, stateChanges, api };
}

test('non-animated collapse produces a header-only, inert panel and expand restores ARIA state', () => {
  const h = setup();
  h.api.set(true, false);
  expect(h.panel.classList.contains('is-minimized')).toBe(true);
  expect(h.body.hidden).toBe(true);
  expect(h.body.inert).toBe(true);
  expect(h.button.getAttribute('aria-expanded')).toBe('false');
  expect(h.button.getAttribute('aria-label')).toBe('Expand');
  h.api.set(false, false);
  expect(h.body.hidden).toBe(false);
  expect(h.body.inert).toBe(false);
  expect(h.button.getAttribute('aria-expanded')).toBe('true');
});

test('animated expand restores explicit height and reports completion', async () => {
  const h = setup();
  h.panel.style.height = '120px';
  const collapseStart = h.pending.length;
  h.api.set(true);
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('80px');
  expect(h.panel.classList.contains('is-dev-overlay-morphing')).toBe(true);
  const mask = h.pending.find((animation) => animation.target === h.body && animation.keyframes[0].clipPath != null)!;
  expect(mask.keyframes[0].clipPath).toContain('round 0 0 12px 10px');
  expect(mask.keyframes[1].clipPath).toContain('84px');
  expect(mask.keyframes[0].clipPath).not.toBe(mask.keyframes[1].clipPath);
  const frame = h.pending.find((animation) => animation.target === h.panel)!;
  expect(mask.options).toEqual(frame.options);
  const inset = (keyframe: Keyframe) => Number.parseFloat(String(keyframe.clipPath).match(/0 0 ([\d.-]+)px/)?.[1] ?? 'NaN');
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const height = 120 + (40 - 120) * progress;
    const clipInset = inset(mask.keyframes[0]) + (inset(mask.keyframes[1]) - inset(mask.keyframes[0])) * progress;
    expect(height + clipInset).toBeCloseTo(124);
  }
  const originalClip = h.body.style.clipPath;
  h.pending.slice(collapseStart).forEach((animation) => animation.resolve());
  await Promise.resolve(); await Promise.resolve();
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('');
  const expandStart = h.pending.length;
  h.api.set(false);
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('80px');
  h.pending.slice(expandStart).forEach((animation) => animation.resolve());
  await Promise.resolve(); await Promise.resolve();
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('');
  expect(h.panel.style.height).toBe('120px');
  expect(h.body.style.clipPath).toBe(originalClip);
  expect(h.callbacks).toEqual(['before', 'after', 'before', 'after']);
});

test('reversing ignores stale completion and destroy cancels pending work', async () => {
  const h = setup();
  h.api.set(true);
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('80px');
  const reverseStart = h.pending.length;
  h.api.set(false);
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('80px');
  h.pending[0].resolve();
  await Promise.resolve();
  expect(h.api.animating).toBe(true);
  const masks = h.pending.filter((animation) => animation.target === h.body && animation.keyframes[0].clipPath != null);
  expect(masks.length).toBe(2);
  h.api.destroy();
  expect(h.api.animating).toBe(false);
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('');
  expect(masks.every((animation) => animation.cancelCount > 0)).toBe(true);
  expect(h.body.style.clipPath).toBe('inset(1px)');
  h.pending.slice(reverseStart).forEach((animation) => animation.resolve());
  await Promise.resolve();
  expect(h.panel.classList.contains('is-dev-overlay-morphing')).toBe(false);
  expect(h.callbacks).toEqual(['before', 'before']);
});

test('reduced motion keeps endpoint height fixed while preserving fade timing', () => {
  const h = setup(true);
  h.api.set(true);
  expect(h.panel.style.getPropertyValue('--dev-overlay-morph-body-height')).toBe('80px');
  expect(h.pending[0].keyframes[0].height).toBe(h.pending[0].keyframes[1].height);
  expect(h.pending[1].keyframes[0].opacity).not.toBe(h.pending[1].keyframes[1].opacity);
  expect(h.pending.some((animation) => animation.keyframes[0].clipPath != null)).toBe(false);
  h.pending.forEach((animation) => animation.resolve());
});

test('state hook runs after final visibility state and before target measurement', () => {
  const h = setup(false, () => { if (!h.panel.classList.contains('is-minimized')) h.panel.style.height = '96px'; });
  h.api.set(true, false);
  h.stateChanges.length = 0;
  h.api.set(false);
  expect(h.stateChanges).toEqual([{ minimized: false, hidden: false, height: 96 }]);
  expect(h.pending[0].keyframes[1].height).toBe('96px');
});

test('generic callers keep the existing frame and fade animations without a clip mask', () => {
  const h = setup(false, undefined, false);
  h.api.set(true);
  expect(h.pending.some((animation) => animation.keyframes[0].clipPath != null)).toBe(false);
});
