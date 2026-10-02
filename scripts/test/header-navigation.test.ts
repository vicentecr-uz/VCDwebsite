import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');
const layout = readFileSync(resolve(root, 'src/layouts/Layout.astro'), 'utf8');
const reveal = readFileSync(resolve(root, 'src/lib/homeReveal.ts'), 'utf8');
const inline = header.match(/<script is:inline>\s*([\s\S]*?)\s*<\/script>/)?.[1] ?? '';

class FakeElement {
  dataset: Record<string, string> = {};
  style = { opacity: '', setProperty: (key: string, value: string) => { (this.style as Record<string, unknown>)[key] = value; } } as Record<string, unknown> & { opacity: string; setProperty: (key: string, value: string) => void };
  children: FakeElement[] = [];
  textContent = '';
  attrs: Record<string, string> = {};
  classList = { add: (...names: string[]) => names.forEach((name) => this.attrs[name] = ''), remove: (...names: string[]) => names.forEach((name) => delete this.attrs[name]) };
  constructor(private selectors: Record<string, FakeElement | null> = {}) {}
  querySelector(selector: string) { return this.selectors[selector] ?? null; }
  querySelectorAll() { return this.children; }
  replaceChildren(...children: FakeElement[]) { this.children = children; this.textContent = children.map((child) => child.textContent).join(''); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
}

function runCarry(pending: unknown, href = 'https://vcd.test/work', rawOverride?: string, throwingStorage = false) {
  const slot = new FakeElement();
  const home = new FakeElement();
  const page = new FakeElement(); page.textContent = 'Project';
  page.children = [...'Project'].map((char) => { const child = new FakeElement(); child.textContent = char; return child; });
  const start = new FakeElement({ '.header-trigger__wordmark--home': home, '.header-trigger__wordmark--page': page });
  const rootElement = new FakeElement();
  const storage = { value: rawOverride ?? (pending === null ? null : JSON.stringify(pending)), getItem: () => { if (throwingStorage) throw new Error('blocked'); return storage.value; }, removeItem: () => { if (throwingStorage) throw new Error('blocked'); storage.value = null; } };
  const document = { documentElement: rootElement, querySelector: (selector: string) => selector === '.site-header-slot' ? slot : start, createElement: () => new FakeElement() };
  const location = { href };
  new Function('document', 'sessionStorage', 'location', 'window', `(function(){${inline}\n})()`)(document, storage, location, { addEventListener() {} });
  return { slot, home, page, storage };
}

test('valid carry restores visible layers with safe textContent chars', () => {
  const result = runCarry({ href: 'https://vcd.test/work', title: '<img src=x>', time: Date.now() });
  expect(result.home.textContent).toBe('<img\u00a0src=x>');
  expect(result.home.attrs['aria-hidden']).toBe('false');
  expect(result.page.attrs['aria-hidden']).toBe('true');
  expect(result.home.children.length).toBe(11);
  expect(result.home.children.every((child) => child.style.opacity === '1')).toBe(true);
  expect(result.page.children.every((child) => child.style.opacity === '0')).toBe(true);
  expect(result.storage.value).toBeNull();
});

test('mismatched, expired, future and oversized carries are ignored', () => {
  for (const pending of [
    { href: 'https://vcd.test/about', title: 'Old', time: Date.now() },
    { href: 'https://vcd.test/work', title: 'Old', time: Date.now() - 10001 },
    { href: 'https://vcd.test/work', title: 'Old', time: Date.now() + 1000 },
    { href: 'https://vcd.test/work', title: 'x'.repeat(301), time: Date.now() },
  ]) {
    const result = runCarry(pending);
    expect(result.slot.dataset.headerCarriedNavigation).toBeUndefined();
    expect(result.home.children.length).toBe(0);
  }
});

test('storage and parser failures fail closed', () => {
  for (const result of [runCarry(null, 'https://vcd.test/work', '{bad'), runCarry(null, 'https://vcd.test/work', undefined, true)]) {
    expect(result.slot.dataset.headerCarriedNavigation).toBeUndefined();
    expect(result.storage.value).toBeNull();
  }
});

test('native CSS and reveal guards keep persistent header above veil and out of cold home reveal', () => {
  expect(layout).toContain('html[data-header-navigation] .site-header-slot { z-index: 110; }');
  expect(reveal).toContain("el.dataset.headerCarriedNavigation !== undefined");
});

import { Window } from 'happy-dom';

const wordmarkScript = header.slice(
  header.indexOf("  const startTrigger = document.querySelector('.header-trigger--start');"),
  header.indexOf('  const currentPageLinks = ['),
).replaceAll('import.meta.env.DEV', 'false');
const compiledWordmark = new Bun.Transpiler({ loader: 'ts' }).transformSync(wordmarkScript);
const captureScript = layout.slice(layout.indexOf('      const clearHeaderNavigationState ='), layout.indexOf("      document.querySelectorAll('a').forEach"));
const compiledCapture = new Bun.Transpiler({ loader: 'ts' }).transformSync(captureScript);

function runtimeFixture(oldTitle: string, newTitle = 'Project', fontsReady = Promise.resolve()) {
  const win = new Window({ url: 'https://vcd.test/project' });
  const doc = win.document;
  doc.body.innerHTML = '<div class="site-header-slot"><header class="site-header"><div class="header-trigger--start" data-header-title-swap="true" data-header-home-title="Vicente Cruz"><span class="header-trigger__wordmark-stack"><span class="header-trigger__wordmark header-trigger__wordmark--page" aria-hidden="false"></span><span class="header-trigger__wordmark header-trigger__wordmark--home" aria-hidden="true"></span></span></div></header></div>';
  const slot = doc.querySelector('.site-header-slot')!;
  const start = doc.querySelector('.header-trigger--start')!;
  const page = doc.querySelector('.header-trigger__wordmark--page')!;
  const home = doc.querySelector('.header-trigger__wordmark--home')!;
  for (const text of newTitle) {
    const char = doc.createElement('span'); char.className = 'header-trigger__char'; char.textContent = text;
    page.appendChild(char);
  }
  win.sessionStorage.setItem('vcd:header-navigation', JSON.stringify({ href: win.location.href, title: oldTitle, time: Date.now() }));
  new Function('document', 'sessionStorage', 'location', 'window', inline)(doc, win.sessionStorage, win.location, win);
  Object.defineProperty(doc, 'fonts', { value: { ready: fontsReady } });
  const frames = new Map<number, Function>();
  const timers = new Map<number, { callback: Function; delay: number }>();
  let sequence = 0;
  const requestFrame = (callback: Function) => { frames.set(++sequence, callback); return sequence; };
  const clock = { setTimeout(callback: Function, delay: number) { timers.set(++sequence, { callback, delay }); return sequence; }, clearTimeout(id: number) { timers.delete(id); }, addEventListener: win.addEventListener.bind(win) };
  new Function('document', 'window', 'headerSlot', 'requestAnimationFrame', 'cancelAnimationFrame', 'applyWordmarkKerning', 'isDevEditing', compiledWordmark)(doc, clock, slot, requestFrame, (id: number) => frames.delete(id), () => {}, () => false);
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); };
  return { win, doc, slot, start, page, home, timers, frame };
}

async function startAnimation(f: ReturnType<typeof runtimeFixture>) {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  f.frame(); f.frame(); f.frame();
}

test('same-title navigation keeps the title visible and clears the carried layer', async () => {
  const f = runtimeFixture('Project');
  await startAnimation(f);
  expect([...f.page.children].every((char: any) => char.style.opacity === '1')).toBe(true);
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(false);
  expect(f.slot.getAttribute('data-header-navigation-title')).toBeNull();
  expect(f.home.textContent).toBe('Vicente Cruz');
});

test('slow title handover finishes the longer outgoing title before restoring home', async () => {
  const f = runtimeFixture('A'.repeat(60), 'Work');
  await startAnimation(f);
  expect([...f.page.children].every((char: any) => char.style.opacity === '1')).toBe(true);
  const cleanup = [...f.timers.values()][0];
  expect(cleanup.delay).toBeGreaterThanOrEqual(1920);
  cleanup.callback();
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(false);
  expect(f.home.textContent).toBe('Vicente Cruz');
  expect(f.home.getAttribute('aria-hidden')).toBe('true');
});

test('force-close while fonts are pending prevents a later title animation', async () => {
  let resolveFonts!: () => void;
  const fonts = new Promise<void>((resolve) => { resolveFonts = resolve; });
  const f = runtimeFixture('Previous', 'Project', fonts);
  f.doc.dispatchEvent(new f.win.CustomEvent('header:force-close'));
  resolveFonts();
  await startAnimation(f);
  expect(f.timers.size).toBe(0);
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(false);
  expect([...f.page.children].every((char: any) => char.style.opacity === '1')).toBe(true);
});

test('visible docked header captures with its flow slot offscreen; hidden header does not', () => {
  const f = runtimeFixture('Previous');
  const head = f.doc.querySelector('.site-header')!;
  const rect = { top: 0, left: 0, bottom: 80, right: 800, width: 800, height: 80 };
  f.slot.getBoundingClientRect = () => ({ ...rect, top: -1000, bottom: -920 } as any);
  head.getBoundingClientRect = () => rect as any;
  f.home.getBoundingClientRect = () => rect as any;
  const getStyle = (el: any) => ({ display: 'block', visibility: 'visible', opacity: el === head ? el.style.opacity || '1' : '1' });
  const runtime = new Function('document', 'sessionStorage', 'getComputedStyle', 'innerHeight', 'innerWidth', `${compiledCapture}; return {captureHeaderNavigation,clearHeaderNavigationState}`)(f.doc, f.win.sessionStorage, getStyle, 900, 1200);
  const target = new URL('https://vcd.test/about');
  expect(runtime.captureHeaderNavigation(target)).toBe(true);
  expect(JSON.parse(f.win.sessionStorage.getItem('vcd:header-navigation')!).href).toBe(target.href);
  runtime.clearHeaderNavigationState();
  expect(f.win.sessionStorage.getItem('vcd:header-navigation')).toBeNull();
  head.style.opacity = '0';
  expect(runtime.captureHeaderNavigation(target)).toBe(false);
});
