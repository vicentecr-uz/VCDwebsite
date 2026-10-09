import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDevPanelCollapse } from '../../src/lib/devPanelCollapse';

function setup(reduced = false) {
  const win = new Window({ url: 'http://localhost/' });
  win.matchMedia = (() => ({ matches: reduced, media: '(prefers-reduced-motion: reduce)', addListener() {}, removeListener() {} })) as typeof win.matchMedia;
  win.document.body.innerHTML = `<section class="dev-panel"><header><button data-minimize-toggle aria-expanded="true" aria-label="Minimize"></button></header><div data-overlay-body><input /></div></section>`;
  const panel = win.document.querySelector('.dev-panel') as HTMLElement;
  const body = panel.querySelector('[data-overlay-body]') as HTMLElement;
  body.style.opacity = '1';
  const button = panel.querySelector('button') as HTMLButtonElement;
  Object.defineProperty(panel, 'getBoundingClientRect', { configurable: true, value: () => ({ height: panel.classList.contains('is-minimized') ? 40 : 120, width: 200, top: 0, left: 0, right: 200, bottom: 120 }) });
  const pending: Array<{ resolve(): void; cancel(): void; keyframes: Keyframe[] }> = [];
  const animate = function (this: HTMLElement, keyframes: Keyframe[]) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const record = { resolve, cancel: () => {}, keyframes };
    pending.push(record);
    this.animate = animate as typeof this.animate;
    return { finished, cancel: record.cancel } as unknown as Animation;
  };
  panel.animate = animate as typeof panel.animate;
  body.animate = animate as typeof body.animate;
  const callbacks: string[] = [];
  const api = createDevPanelCollapse(panel, { beforeChange: () => callbacks.push('before'), afterChange: () => callbacks.push('after') });
  return { win, panel, body, button, pending, callbacks, api };
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
  h.api.set(true);
  h.pending.forEach((animation) => animation.resolve());
  await Promise.resolve(); await Promise.resolve();
  h.api.set(false);
  h.pending.slice(2).forEach((animation) => animation.resolve());
  await Promise.resolve(); await Promise.resolve();
  expect(h.panel.style.height).toBe('120px');
  expect(h.callbacks).toEqual(['before', 'after', 'before', 'after']);
});

test('reversing ignores stale completion and destroy cancels pending work', async () => {
  const h = setup();
  h.api.set(true);
  h.api.set(false);
  h.pending[0].resolve();
  await Promise.resolve();
  expect(h.api.animating).toBe(true);
  h.api.destroy();
  expect(h.api.animating).toBe(false);
  h.pending.slice(2).forEach((animation) => animation.resolve());
  await Promise.resolve();
  expect(h.panel.classList.contains('is-dev-overlay-morphing')).toBe(false);
  expect(h.callbacks).toEqual(['before', 'before']);
});

test('reduced motion keeps endpoint height fixed while preserving fade timing', () => {
  const h = setup(true);
  h.api.set(true);
  expect(h.pending[0].keyframes[0].height).toBe(h.pending[0].keyframes[1].height);
  expect(h.pending[1].keyframes[0].opacity).not.toBe(h.pending[1].keyframes[1].opacity);
  h.pending.forEach((animation) => animation.resolve());
});
