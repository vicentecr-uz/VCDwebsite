import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/SectionSidebarNav.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const scrollToBlock = (scrollTarget: HTMLElement, href?: string) => {');
const end = source.indexOf('\n    const revealHistoryBlock', start);
if (start < 0 || end < 0) throw new Error('Could not extract sidebar click scroll');
const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end));

function harness() {
  const frames = new Map<number, Function>();
  let frameId = 0;
  const listeners = new Map<string, Function>();
  const routerState = { index: 3, scrollX: 0, scrollY: 0 };
  let scrollY = 0;
  let activeSyncs = 0;
  const win = {
    get scrollY() { return scrollY; },
    innerHeight: 800,
    history: { state: routerState as unknown, replaceState(state: unknown) { this.state = state; } },
    matchMedia: () => ({ matches: false }),
    scrollTo: (_x: number, y: number) => { scrollY = y; },
    clearTimeout: () => {},
  };
  const scope = {
    frame: (callback: Function) => { frames.set(++frameId, callback); return frameId; },
    timeout: () => 0,
    listen: (_target: unknown, type: string, listener: Function) => listeners.set(type, listener),
  };
  const scrollToBlock = new Function(
    'window', 'document', 'performance', 'cancelAnimationFrame', 'scope', 'scrollEasing', 'setActiveLink', 'updateActiveFromScroll', 'clickOffsetPx', 'clickLockMs',
    `let scrollRafId = 0, scrollTimeoutId = 0, isAutoScrolling = false, manualLockUntil = 0; ${body}; return scrollToBlock;`,
  )(
    win, { documentElement: { scrollHeight: 10000 } }, { now: () => 0 }, (id: number) => frames.delete(id), scope,
    { getUseNative: () => false, getEaser: () => (t: number) => t }, () => {}, () => { activeSyncs += 1; }, 152, 700,
  );
  const target = { id: 'research', getBoundingClientRect: () => ({ top: 3000, height: 200 }) };
  let time = 0;
  const step = (ms: number) => { time += ms; const due = [...frames.values()]; frames.clear(); due.forEach((callback) => callback(time)); };
  return { scrollToBlock, target, win, listeners, routerState, step, userScroll: (y: number) => { scrollY = y; }, activeSyncs: () => activeSyncs };
}

test('sidebar click keeps the ClientRouter history state so Back still navigates', () => {
  const h = harness();
  h.scrollToBlock(h.target, '#research');
  expect(h.win.history.state).toBe(h.routerState);
});

test('user scroll input cancels the click tween instead of being overwritten', () => {
  for (const event of [{ type: 'wheel' }, { type: 'touchstart' }, { type: 'pointerdown' }, { type: 'keydown', key: 'PageUp' }]) {
    const h = harness();
    h.scrollToBlock(h.target, '#research');
    h.step(16); h.step(100);
    const userY = h.win.scrollY - 100;
    h.userScroll(userY);
    h.listeners.get(event.type)!(event);
    h.step(16); h.step(500);
    expect(h.win.scrollY).toBe(userY);
    expect(h.activeSyncs()).toBe(1);
  }
});

test('non-scroll keys leave the click tween running', () => {
  const h = harness();
  h.scrollToBlock(h.target, '#research');
  h.step(16);
  h.listeners.get('keydown')!({ type: 'keydown', key: 'Tab' });
  h.step(2000);
  expect(h.win.scrollY).toBeGreaterThan(2000);
});
