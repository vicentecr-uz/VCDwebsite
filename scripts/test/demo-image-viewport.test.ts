import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoImageViewport } from '../../src/lib/demoImageViewport';

function setup(reduced = false, mobile = false) {
  const win = new Window();
  const root = win.document.createElement('div');
  const column = win.document.createElement('div');
  const shell = win.document.createElement('div');
  const iframe = win.document.createElement('iframe');
  root.innerHTML = '<button data-crop-viewport="desktop"></button><button data-crop-viewport="tablet"></button><button data-crop-viewport="mobile"></button>';
  shell.append(iframe); column.append(shell); root.append(column);
  let width = 500;
  let mobileMatches = mobile;
  column.getBoundingClientRect = () => ({ width } as DOMRect);
  let resize!: () => void;
  (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const mobileQuery = { matches: mobileMatches } as MediaQueryList;
  (win as unknown as { matchMedia: (query: string) => MediaQueryList }).matchMedia = (query: string) => query.includes('prefers-reduced-motion')
    ? ({ matches: reduced } as MediaQueryList)
    : mobileQuery;
  const animations: Array<{ cancel(): void }> = [];
  iframe.animate = (() => { const animation = { cancel() { animations.splice(animations.indexOf(animation), 1); } }; animations.push(animation); return animation; }) as unknown as typeof iframe.animate;
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const controller = createDemoImageViewport({ root, column, iframe });
  return { win, root, column, shell, iframe, controller, animations, setWidth(value: number) { width = value; resize(); }, setMobile(value: boolean) { mobileMatches = value; mobileQuery.matches = value; resize(); }, restore() { globalThis.ResizeObserver = previous; } };
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

test('mobile measurements fill the column for the selected viewport', () => {
  const h = setup(false, true);
  h.setWidth(430);
  h.controller.setViewport('mobile');
  expect(h.shell.style.width).toBe('430px');
  expect(h.iframe.style.transform).toBe(`scale(${430 / 390})`);
  h.controller.setViewport('tablet');
  expect(h.shell.style.width).toBe('430px');
  expect(h.iframe.style.transform).toBe(`scale(${430 / 834})`);
  h.controller.destroy(); h.restore();
});

test('resize measurements follow the live mobile breakpoint', () => {
  const h = setup(false, true);
  h.controller.setViewport('mobile');
  expect(h.iframe.style.transform).toBe(`scale(${500 / 390})`);
  h.setMobile(false);
  expect(h.iframe.style.transform).toBe(`scale(${500 / 1024})`);
  h.setMobile(true);
  expect(h.iframe.style.transform).toBe(`scale(${500 / 390})`);
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
