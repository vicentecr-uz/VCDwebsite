import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { waitForSignupViewportSettlement } from '../../src/lib/signupViewport';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;

const setup = ({ coarse = true, focused = true, keyboard = false } = {}) => {
  const browserWindow = new Window();
  const input = browserWindow.document.createElement('input');
  browserWindow.document.body.append(input);
  const viewport = new EventTarget() as VisualViewport;
  Object.defineProperty(viewport, 'height', { value: keyboard ? 500 : 800, configurable: true });
  const listenerCounts = new Map<string, number>();
  const trackListeners = (target: EventTarget) => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      listenerCounts.set(type, (listenerCounts.get(type) ?? 0) + 1);
      add(type, listener, options);
    }) as typeof target.addEventListener;
    target.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
      listenerCounts.set(type, Math.max(0, (listenerCounts.get(type) ?? 0) - 1));
      remove(type, listener, options);
    }) as typeof target.removeEventListener;
  };
  trackListeners(browserWindow);
  trackListeners(viewport);
  Object.defineProperty(browserWindow, 'matchMedia', {
    value: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }),
  });
  Object.defineProperty(browserWindow.navigator, 'maxTouchPoints', { value: coarse ? 1 : 0 });
  Object.defineProperty(browserWindow.document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(browserWindow, 'visualViewport', {
    value: keyboard ? viewport : undefined,
    configurable: true,
  });
  if (focused) input.focus();
  globalThis.window = browserWindow as unknown as Window & typeof globalThis;
  globalThis.document = browserWindow.document as unknown as Document;
  globalThis.navigator = browserWindow.navigator as unknown as Navigator;
  return { browserWindow, input, viewport, listenerCounts };
};

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.navigator = originalNavigator;
});

test('desktop and unrelated coarse-pointer submissions resolve without waiting', async () => {
  const desktop = setup({ coarse: false });
  let desktopSettled = false;
  const desktopWait = waitForSignupViewportSettlement(desktop.input).then(() => { desktopSettled = true; });
  await Promise.resolve();
  expect(desktopSettled).toBe(true);
  await desktopWait;
  const unrelated = setup({ focused: false });
  let unrelatedSettled = false;
  const unrelatedWait = waitForSignupViewportSettlement(unrelated.input).then(() => { unrelatedSettled = true; });
  await Promise.resolve();
  expect(unrelatedSettled).toBe(true);
  await unrelatedWait;
});

test('focused mobile input waits for minimum settle time and responds to viewport changes', async () => {
  const { browserWindow, input } = setup();
  let settled = false;
  const waiting = waitForSignupViewportSettlement(input).then(() => { settled = true; });
  await Bun.sleep(250);
  browserWindow.dispatchEvent(new browserWindow.Event('scroll'));
  await Bun.sleep(100);
  expect(settled).toBe(false);
  await Bun.sleep(100);
  await waiting;
  expect(settled).toBe(true);
});

test('recent blur waits while stale blur stays immediate', async () => {
  const { input } = setup({ focused: false });
  let staleSettled = false;
  const staleWait = waitForSignupViewportSettlement(input, performance.now() - 301).then(() => { staleSettled = true; });
  await Promise.resolve();
  expect(staleSettled).toBe(true);
  await staleWait;
  const recentWait = waitForSignupViewportSettlement(input, performance.now());
  let recentSettled = false;
  recentWait.then(() => { recentSettled = true; });
  await Bun.sleep(200);
  expect(recentSettled).toBe(false);
  await recentWait;
});

test('pagehide resolves immediately and removes listeners', async () => {
  const { browserWindow, viewport, input, listenerCounts } = setup({ keyboard: true });
  let settled = false;
  const waiting = waitForSignupViewportSettlement(input).then(() => { settled = true; });
  expect(listenerCounts.get('scroll')).toBe(2);
  expect(listenerCounts.get('resize')).toBe(1);
  browserWindow.dispatchEvent(new browserWindow.Event('pagehide'));
  await waiting;
  expect(settled).toBe(true);
  browserWindow.dispatchEvent(new browserWindow.Event('scroll'));
  viewport.dispatchEvent(new Event('resize'));
  expect(listenerCounts.get('scroll')).toBe(0);
  expect(listenerCounts.get('resize')).toBe(0);
});

test('continuous viewport changes still stop at the deadline', async () => {
  const { input, viewport } = setup({ keyboard: true });
  const started = performance.now();
  const interval = setInterval(() => viewport.dispatchEvent(new Event('resize')), 100);
  await waitForSignupViewportSettlement(input);
  clearInterval(interval);
  const elapsed = performance.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(1100);
  expect(elapsed).toBeLessThan(1450);
});
