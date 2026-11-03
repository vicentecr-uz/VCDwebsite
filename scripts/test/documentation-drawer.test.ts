import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const source = readFileSync(new URL('../../src/layouts/DocumentationLayout.astro', import.meta.url), 'utf8');
const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, ''));
const globals = ['window', 'document', 'AbortController', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
let restore: (() => Promise<void>) | undefined;
afterEach(async () => { await restore?.(); restore = undefined; });

function fixture(reduce = false) {
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = new Window({ url: 'https://vcd.test/sabi/getting-started' });
  const desktop = Object.assign(new win.EventTarget(), { matches: false });
  const reduced = Object.assign(new win.EventTarget(), { matches: reduce });
  Object.defineProperty(win, 'matchMedia', { value: (query: string) => query.includes('reduced-motion') ? reduced : desktop });
  win.document.body.innerHTML = '<div data-documentation-page><button data-documentation-open aria-expanded="false">Open</button><dialog id="documentation-drawer"><a href="#next">API</a></dialog><main id="main-content"></main></div>';
  win.document.documentElement.style.overflow = 'auto';
  const dialog = win.document.querySelector('dialog')!;
  const opener = win.document.querySelector('button')!;
  let animations: Array<{ finished: Promise<void> }> = [];
  let dispose: (() => void) | undefined;
  Object.defineProperty(dialog, 'getAnimations', { value: () => animations });
  dialog.getBoundingClientRect = () => ({ left: 122, right: 382, top: 8, bottom: 592 }) as DOMRect;
  const values = { window: win, document: win.document, AbortController: win.AbortController, getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win) };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  restore = async () => {
    dispose?.();
    await win.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  new Function('createPageScope', 'onPageLoad', compiled)(createPageScope, (mount: Parameters<typeof onPageLoad>[0]) => { dispose = onPageLoad(mount); });
  return {
    win, dialog, opener, desktop, reduced,
    open: () => opener.click(),
    escape: () => { const event = new win.Event('cancel', { cancelable: true }); dialog.dispatchEvent(event); return event; },
    outside: () => dialog.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 })),
    animation: () => { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }); animations = [{ finished }]; return finish; },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('Escape keeps the modal locked until its exit animation finishes', async () => {
  const f = fixture(); f.open();
  const finish = f.animation();
  expect(f.escape().defaultPrevented).toBe(true);
  expect(f.dialog.open).toBe(true);
  expect(f.dialog.dataset.closing).toBe('true');
  expect(f.opener.getAttribute('aria-expanded')).toBe('true');
  expect(f.win.document.documentElement.style.overflow).toBe('hidden');
  finish(); await settle();
  expect(f.dialog.open).toBe(false);
  expect(f.opener.getAttribute('aria-expanded')).toBe('false');
  expect(f.win.document.documentElement.style.overflow).toBe('auto');
});

test('an interrupted closing cannot close a reopened drawer when the old animation finishes', async () => {
  const f = fixture(); f.open(); const finish = f.animation(); f.escape();
  f.open();
  expect(f.dialog.dataset.closing).toBeUndefined();
  finish(); await settle();
  expect(f.dialog.open).toBe(true);
  expect(f.opener.getAttribute('aria-expanded')).toBe('true');
  expect(f.win.document.documentElement.style.overflow).toBe('hidden');
});

test('outside clicks animate dismissal; navigation closes immediately', async () => {
  const f = fixture(); f.open(); const finish = f.animation(); f.outside();
  expect(f.dialog.open).toBe(true);
  expect(f.dialog.dataset.closing).toBe('true');
  f.dialog.querySelector('a')!.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true }));
  expect(f.dialog.open).toBe(false);
  expect(f.win.document.documentElement.style.overflow).toBe('auto');
  finish(); await settle();
  expect(f.dialog.open).toBe(false);
});

test('reduced motion dismisses immediately and a preference change releases an in-progress exit', () => {
  const f = fixture(true); f.open(); f.animation(); f.escape();
  expect(f.dialog.open).toBe(false);
  f.reduced.matches = false; f.open(); f.escape();
  expect(f.dialog.open).toBe(true);
  f.reduced.matches = true; f.reduced.dispatchEvent(new f.win.Event('change'));
  expect(f.dialog.open).toBe(false);
  expect(f.win.document.documentElement.style.overflow).toBe('auto');
});

test('page cleanup invalidates pending exit completion and restores scroll lock immediately', async () => {
  const f = fixture(); f.open(); const finish = f.animation(); f.escape();
  f.win.document.dispatchEvent(new f.win.Event('astro:before-swap'));
  expect(f.dialog.open).toBe(false);
  expect(f.win.document.documentElement.style.overflow).toBe('auto');
  finish(); await settle();
  f.opener.click();
  expect(f.dialog.open).toBe(false);
  expect(f.opener.getAttribute('aria-expanded')).toBe('false');
});

test('desktop resize closes immediately even while exit animation is pending', () => {
  const f = fixture(); f.open(); f.animation(); f.escape();
  f.desktop.matches = true; f.desktop.dispatchEvent(new f.win.Event('change'));
  expect(f.dialog.open).toBe(false);
  expect(f.win.document.documentElement.style.overflow).toBe('auto');
});
