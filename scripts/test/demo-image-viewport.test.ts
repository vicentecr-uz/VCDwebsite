import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoImageViewport } from '../../src/lib/demoImageViewport';

function setup(reduced = false) {
  const win = new Window();
  const root = win.document.createElement('div');
  const column = win.document.createElement('div');
  const shell = win.document.createElement('div');
  const iframe = win.document.createElement('iframe');
  root.innerHTML = '<button data-crop-viewport="desktop"></button><button data-crop-viewport="tablet"></button><button data-crop-viewport="mobile"></button>';
  shell.append(iframe); column.append(shell); root.append(column);
  let width = 500;
  column.getBoundingClientRect = () => ({ width } as DOMRect);
  let resize!: () => void;
  (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (win as unknown as { matchMedia: (query: string) => MediaQueryList }).matchMedia = () => ({ matches: reduced }) as MediaQueryList;
  const animations: Array<{ cancel(): void }> = [];
  iframe.animate = (() => { const animation = { cancel() { animations.splice(animations.indexOf(animation), 1); } }; animations.push(animation); return animation; }) as unknown as typeof iframe.animate;
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const controller = createDemoImageViewport({ root, column, iframe });
  return { win, root, column, shell, iframe, controller, animations, setWidth(value: number) { width = value; resize(); }, restore() { globalThis.ResizeObserver = previous; } };
}

test('initial selection and repeated viewport choices update aria state', () => {
  const h = setup();
  expect(h.root.querySelector('[data-crop-viewport="desktop"]')?.getAttribute('aria-pressed')).toBe('true');
  h.controller.setViewport('tablet');
  h.controller.setViewport('tablet');
  expect(h.root.querySelector('[data-crop-viewport="tablet"]')?.classList.contains('is-active')).toBe(true);
  expect(h.root.querySelector('[data-crop-viewport="desktop"]')?.getAttribute('aria-pressed')).toBe('false');
  h.controller.destroy(); h.restore();
});

test('resize measurements use the stable column and bypass transitions immediately', () => {
  const h = setup();
  h.controller.setViewport('mobile');
  h.setWidth(834);
  expect(h.iframe.style.transform).toBe(`scale(${834 / 1024})`);
  expect(h.iframe.style.width).toBe('390px');
  h.controller.destroy(); h.restore();
});

test('selected viewports keep the proportional width and shared scaled height', () => {
  const h = setup();
  h.setWidth(500);
  h.controller.setViewport('mobile');
  expect(Number.parseFloat(h.shell.style.width)).toBeCloseTo(390 * (500 / 1024), 5);
  expect(Number.parseFloat(h.shell.style.height)).toBeCloseTo(900 * (500 / 1024), 5);
  expect(h.iframe.style.transform).toBe(`scale(${500 / 1024})`);
  expect(h.root.dataset.cropPreviewViewport).toBe('mobile');
  h.controller.setViewport('desktop');
  expect(h.shell.style.width).toBe('500px');
  expect(h.root.dataset.cropPreviewViewport).toBe('desktop');
  h.controller.destroy(); h.restore();
});

test('reduced motion cancels the previous opacity animation and cleans up', () => {
  const h = setup(true);
  h.controller.setViewport('tablet');
  h.controller.setViewport('mobile');
  expect(h.animations.length).toBe(1);
  h.controller.destroy();
  expect(h.animations.length).toBe(0);
  h.restore();
});
