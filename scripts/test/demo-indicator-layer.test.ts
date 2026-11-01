import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoIndicatorLayer } from '../../src/lib/demoIndicatorLayer';

const bounds = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

function fixture(embedded = false) {
  const win = new Window({ url: 'http://localhost/preview/demo' });
  const parent = embedded ? new Window({ url: 'http://localhost/project' }) : win;
  const anchor = win.document.createElement('div');
  win.document.body.append(anchor);
  anchor.getBoundingClientRect = () => bounds(20, 30, 360, 168);
  Object.defineProperties(anchor, { offsetWidth: { value: 720 }, offsetHeight: { value: 336 } });
  anchor.style.setProperty('--ss-cursor-size', '2');
  const host = parent.document.createElement('project-demo-content');
  const frame = parent.document.createElement('iframe');
  host.append(frame); parent.document.body.append(host);
  frame.getBoundingClientRect = () => bounds(100, 200, 400, 300);
  Object.defineProperties(frame, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } });
  if (embedded) Object.defineProperty(win, 'frameElement', { value: frame });
  return { win, parent, anchor, host, frame };
}

test('stage indicators use page coordinates and preserve both stage and iframe scale', () => {
  const f = fixture(true);
  const layer = createDemoIndicatorLayer(f.anchor as unknown as HTMLElement, 'element');
  expect(layer.element.ownerDocument).toBe(f.parent.document);
  expect(layer.element.parentElement?.parentElement).toBe(f.parent.document.body);
  expect(layer.element.style.transform).toBe('translate(110px, 215px) scale(0.25, 0.25)');
  expect(layer.element.style.getPropertyValue('--ss-cursor-size')).toBe('2');
  expect(f.host.contains(layer.element as any)).toBe(false);
  f.frame.getBoundingClientRect = () => bounds(50, 100, 800, 600);
  f.parent.dispatchEvent(new f.parent.Event('scroll'));
  expect(layer.element.style.transform).toBe('translate(70px, 130px) scale(0.5, 0.5)');
  layer.destroy();
  expect(f.parent.document.querySelector('.demo-indicator-layer')).toBeNull();
});

test('viewport guides escape their iframe without applying the anchor offset', () => {
  const f = fixture(true);
  const layer = createDemoIndicatorLayer(f.anchor as unknown as HTMLElement);
  expect(layer.element.style.transform).toBe('translate(100px, 200px) scale(0.5, 0.5)');
  f.host.setAttribute('data-demo-loading', ''); layer.sync();
  expect(layer.element.parentElement?.hidden).toBe(true);
  f.host.removeAttribute('data-demo-loading'); layer.sync();
  expect(layer.element.parentElement?.hidden).toBe(false);
  f.parent.document.dispatchEvent(new f.parent.Event('astro:before-swap'));
  expect(layer.element.isConnected).toBe(false);
  layer.destroy();
});

test('standalone stages retain coordinates, keyboard hiding state, and dispose on page exit', () => {
  const f = fixture();
  const layer = createDemoIndicatorLayer(f.anchor as unknown as HTMLElement, 'element');
  expect(layer.element.style.transform).toBe('translate(20px, 30px) scale(0.5, 0.5)');
  f.anchor.dataset.mark = 'keyboard'; layer.sync();
  expect(layer.element.dataset.mark).toBe('keyboard');
  delete f.anchor.dataset.mark; layer.sync();
  expect(layer.element.dataset.mark).toBeUndefined();
  f.anchor.dataset.still = ''; f.anchor.dataset.offscreen = ''; layer.sync();
  expect(layer.element.hasAttribute('data-still')).toBe(true);
  expect(layer.element.hasAttribute('data-offscreen')).toBe(true);
  f.anchor.remove(); layer.sync();
  expect(layer.element.parentElement?.hidden).toBe(true);
  f.win.dispatchEvent(new f.win.Event('pagehide'));
  expect(layer.element.isConnected).toBe(false);
});
