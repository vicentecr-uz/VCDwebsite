import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');
const layout = readFileSync(resolve(root, 'src/layouts/Layout.astro'), 'utf8');
const homePage = readFileSync(resolve(root, 'src/pages/index.astro'), 'utf8');
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
  cloneNode() { const clone = new FakeElement(); clone.attrs = { ...this.attrs }; return clone; }
}

function runCarry(pending: unknown, href = 'https://vcd.test/work', rawOverride?: string, throwingStorage = false) {
  const slot = new FakeElement();
  const home = new FakeElement();
  home.children = [...'Vicente Cruz'].map((char) => { const child = new FakeElement(); child.textContent = char; child.attrs['data-astro-cid'] = ''; return child; });
  home.textContent = 'Vicente Cruz';
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
  expect(result.home.children.every((child) => child.attrs['data-astro-cid'] === '')).toBe(true);
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
    expect(result.home.children.length).toBe(12);
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
  doc.body.innerHTML = '<div class="site-header-slot"><header class="site-header"><div class="header-trigger--start" data-header-title-swap="true" ><span class="header-trigger__wordmark-stack"><span class="header-trigger__wordmark header-trigger__wordmark--page" aria-hidden="false"></span><span class="header-trigger__wordmark header-trigger__wordmark--home" aria-hidden="true"></span></span></div></header></div>';
  const slot = doc.querySelector('.site-header-slot')!;
  const start = doc.querySelector('.header-trigger--start')!;
  const page = doc.querySelector('.header-trigger__wordmark--page')!;
  const home = doc.querySelector('.header-trigger__wordmark--home')!;
  for (const text of 'Vicente Cruz') {
    const char = doc.createElement('span'); char.className = 'header-trigger__char'; char.textContent = text; char.setAttribute('data-astro-cid-fixture', ''); char.style.marginLeft = '0.02em'; home.appendChild(char);
  }
  for (const text of newTitle) {
    const char = doc.createElement('span'); char.className = 'header-trigger__char'; char.textContent = text;
    page.appendChild(char);
  }
  const originalHomeChars = [...home.children];
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
  return { win, doc, slot, start, page, home, timers, frame, originalHomeChars };
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
  const getStyle = (el: any) => ({ display: 'block', visibility: 'visible', opacity: el === head ? el.style.opacity || '1' : '1', fontSize: '20px', marginLeft: '2px' });
  const runtime = new Function('document', 'sessionStorage', 'getComputedStyle', 'innerHeight', 'innerWidth', 'CustomEvent', `${compiledCapture}; return {captureHeaderNavigation,clearHeaderNavigationState}`)(f.doc, f.win.sessionStorage, getStyle, 900, 1200, f.win.CustomEvent);
  const target = new URL('https://vcd.test/about');
  expect(runtime.captureHeaderNavigation(target)).toBe(true);
  const carried = JSON.parse(f.win.sessionStorage.getItem('vcd:header-navigation')!);
  expect(carried.href).toBe(target.href);
  expect(carried.margins).toEqual(Array.from('Previous', () => 0.1));
  runtime.clearHeaderNavigationState();
  expect(f.win.sessionStorage.getItem('vcd:header-navigation')).toBeNull();
  head.style.opacity = '0';
  expect(runtime.captureHeaderNavigation(target)).toBe(false);
});

test('active carry releases the home stacking boundary while cold home remains at z-index zero', () => {
  const win = new Window({ url: 'https://vcd.test/' });
  const doc = win.document;
  const critical = [
    layout.match(/html\[data-header-navigation\] \.site-header-slot \{[^}]*\}/)?.[0],
    layout.match(/html\[data-header-navigation\] \[data-home-page\] \{[^}]*\}/)?.[0],
  ].filter(Boolean).join('\n');
  const homeRule = homePage.match(/\.home-page\s*\{[\s\S]*?\}/)?.[0] ?? '';
  const style = doc.createElement('style'); style.textContent = `${critical}\n${homeRule}`; doc.head.append(style);
  doc.body.innerHTML = '<div data-home-page class="home-page"><div class="site-header-slot"></div></div>';
  const home = doc.querySelector('[data-home-page]')!;
  const slot = doc.querySelector('.site-header-slot')!;
  expect(win.getComputedStyle(home).zIndex).toBe('0');
  doc.documentElement.setAttribute('data-header-navigation', '');
  const activeStyle = doc.createElement('style'); activeStyle.textContent = critical; doc.head.append(activeStyle);
  const rules = [...(activeStyle.sheet?.cssRules ?? [])].map((rule) => (rule as CSSStyleRule).style?.zIndex).filter(Boolean);
  expect(rules).toContain('auto');
  expect(rules).toContain('110');
  doc.documentElement.removeAttribute('data-header-navigation');
  expect(win.getComputedStyle(home).zIndex).toBe('0');
});


test('carried letter margins are present before the deferred script runs', () => {
  const margins = Array.from('Vicente Cruz', (_, i) => i / 100);
  const f = runCarry({ href: 'https://vcd.test/work', title: 'Vicente Cruz', time: Date.now(), margins });
  expect(f.home.children.map((char) => char.style.marginLeft)).toEqual(margins.map((margin) => `${margin}em`));
});

test('hover after a page handover uses original scoped nodes and slow letter timing', async () => {
  const f = runtimeFixture('Previous');
  expect([...f.home.children].every((char) => char.hasAttribute('data-astro-cid-fixture'))).toBe(true);
  await startAnimation(f);
  [...f.timers.values()][0].callback();
  expect([...f.home.children]).toEqual(f.originalHomeChars);
  expect([...f.home.children].every((char: any) => char.style.marginLeft === '0.02em')).toBe(true);
  f.start.dispatchEvent(new f.win.Event('header:trigger-open'));
  expect([...f.home.children].every((char: any) => char.style.opacity === '0')).toBe(true);
  f.frame();
  const chars = [...f.home.children] as any[];
  expect(chars.every((char) => char.style.getPropertyValue('--char-duration') === '0.25s')).toBe(true);
  expect(parseFloat(chars.at(-1).style.getPropertyValue('--char-delay'))).toBeGreaterThan(0.5);
});

test('accepted navigation prevents title reversal and canceled navigation permits it', async () => {
  const f = runtimeFixture('Project');
  await startAnimation(f);
  f.start.dispatchEvent(new f.win.Event('header:trigger-open'));
  f.frame();
  f.doc.dispatchEvent(new f.win.Event('header:navigation-start'));
  f.start.dispatchEvent(new f.win.Event('header:trigger-close'));
  f.doc.dispatchEvent(new f.win.CustomEvent('header:force-close', { detail: { preserveNavigation: true } }));
  expect(f.home.getAttribute('aria-hidden')).toBe('false');
  expect([...f.home.children].every((char: any) => char.style.opacity === '1')).toBe(true);
  expect(f.timers.size).toBe(0);
  f.doc.dispatchEvent(new f.win.Event('header:navigation-cancel'));
  f.start.dispatchEvent(new f.win.Event('header:trigger-close'));
  expect(f.page.getAttribute('aria-hidden')).toBe('false');
  expect([...f.home.children].every((char: any) => char.style.opacity === '0')).toBe(true);
});

const bridgeScript = readFileSync(resolve(root, 'src/scripts/headerTitleBridge.js'), 'utf8');
function bridgeFixture(elapsed = 200, targetTitle = 'New') {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = '<span class="header-trigger__wordmark-stack" style="visibility: visible"><span class="header-trigger__wordmark header-trigger__wordmark--page" aria-hidden="false" style="margin-top: -5px"><span class="header-trigger__char" data-astro-cid-fixture style="margin-left: 2px; transform: translateX(10px); transition: opacity 1s">Old</span></span></span>';
  const now = 100000;
  new Function('window', 'document', 'getComputedStyle', 'Date', bridgeScript)(win, doc, win.getComputedStyle.bind(win), { now: () => now });
  const geometry = { left: 0.1, top: -0.15, width: 3, height: 1, offsets: [0, 0.6, 1.2] };
  const pending = {
    title: 'Old', targetTitle, startedAt: now - elapsed,
    fromGeometry: geometry, toGeometry: { ...geometry, offsets: [0, 0.7, 1.4] },
    fontMetrics: { font: '700 24px Hanken', lineHeight: '24px', letterSpacing: '-0.5px', fontKerning: 'normal', fontFeatureSettings: 'normal' },
  };
  const run = (win as any).__vcdHeaderTitleBridge;
  return { win, doc, pending, run, stack: doc.querySelector('.header-trigger__wordmark-stack')! };
}

test('destination resumes elapsed keyframes without restarting or recalculating visible geometry', () => {
  const f = bridgeFixture();
  const bridge = f.run(f.pending);
  const layers = f.doc.querySelectorAll('.header-navigation-title-layer');
  const outgoing = layers[0].querySelectorAll<HTMLElement>('.header-navigation-title-char');
  const incoming = layers[1].querySelectorAll<HTMLElement>('.header-navigation-title-char');
  expect(outgoing[0].style.animation).toContain('-200ms');
  expect(outgoing[1].style.animation).toContain('-170ms');
  expect(incoming[0].style.animation).toContain('-200ms');
  expect(incoming[1].style.animation).toContain('-160ms');
  expect((layers[0] as HTMLElement).style.top).toBe('-0.15em');
  expect((layers[0] as HTMLElement).style.left).toBe('0.1em');
  expect((layers[0] as HTMLElement).style.fontSize).toBe('24px');
  expect(outgoing[1].style.left).toBe('0.6em');
  expect(incoming[1].style.left).toBe('0.7em');
  expect(bridge.finishesAt).toBeGreaterThan(100000);
  expect(outgoing[0].hasAttribute('data-astro-cid-fixture')).toBe(true);
  expect(outgoing[0].style.transform).toBe('');
  expect(outgoing[0].style.marginLeft).toBe('0px');
  expect(outgoing[0].style.transition).toBe('none');
  expect((layers[0] as HTMLElement).style.marginTop).toBe('');
});

test('bridge cleanup restores the untouched original header for hover', () => {
  const f = bridgeFixture();
  const original = f.stack.firstElementChild;
  const bridge = f.run(f.pending);
  expect((f.stack as HTMLElement).style.visibility).toBe('hidden');
  bridge.cleanup();
  expect((f.stack as HTMLElement).style.visibility).toBe('visible');
  expect(f.stack.children.length).toBe(1);
  expect(f.stack.firstElementChild).toBe(original);
  expect(original?.querySelector<HTMLElement>('.header-trigger__char')?.style.marginLeft).toBe('2px');
});

test('same-title bridge uses a single visible fixed layer without duplicate text', () => {
  const f = bridgeFixture(200, 'Old');
  const bridge = f.run(f.pending);
  expect(f.doc.querySelectorAll('.header-navigation-title-layer').length).toBe(1);
  const chars = [...f.doc.querySelectorAll<HTMLElement>('.header-navigation-title-char')];
  expect(chars.every((char) => char.style.opacity === '1' && char.style.animation === 'none')).toBe(true);
  expect(bridge.remainingMs).toBe(0);
});

test('completed animation stays completed and malformed bridge state leaves original visible', () => {
  const f = bridgeFixture(2000);
  expect(f.run(f.pending).remainingMs).toBe(0);
  for (const mutate of [
    (p: any) => p.startedAt = 110000,
    (p: any) => p.fromGeometry.offsets = [NaN, 0, 0],
    (p: any) => p.fontMetrics.lineHeight = {},
  ]) {
    const invalid = bridgeFixture();
    mutate(invalid.pending);
    expect(invalid.run(invalid.pending)).toBeNull();
    expect((invalid.stack as HTMLElement).style.visibility).toBe('visible');
  }
});

test('accepted navigation runs the menu reverse timeline after title capture and recovers after cancel or Back', () => {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = '<div class="header-trigger header-trigger--start"><div class="header-trigger__panel-bg"></div><a href="/" class="header-trigger__brand-link">Home</a><a class="header-menu__link">About</a><a class="header-menu__link">Play</a></div>';
  const start = doc.querySelector<HTMLElement>('.header-trigger')!;
  const brand = start.querySelector<HTMLElement>('.header-trigger__brand-link')!;
  const links = [...start.querySelectorAll<HTMLElement>('.header-menu__link')];
  const begin = header.indexOf("\n  document.querySelectorAll<HTMLElement>('.header-trigger').forEach", header.indexOf('const forceCloseMenus'));
  const end = header.indexOf('  // Switching between hover and tap', begin);
  expect(begin).toBeGreaterThan(0);
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(header.slice(begin, end).replaceAll('import.meta.env.DEV', 'false'));
  const timers = new Map<number, { callback: Function; delay: number }>();
  const microtasks: Function[] = [];
  const timings: number[][] = [];
  let sequence = 0;
  new Function('document', 'window', 'MouseEvent', 'HTMLElement', 'CustomEvent', 'syncMenuSurfaceInlineSize', 'setMenuSurfaceTiming', 'isTapMode', 'isDevEditing', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'menuScrollClosed', script)(
    doc, win, win.MouseEvent, win.HTMLElement, win.CustomEvent, () => {}, (...values: number[]) => timings.push(values), () => false, () => false,
    (callback: Function, delay: number) => { timers.set(++sequence, { callback, delay }); return sequence; },
    (id: number) => timers.delete(id), (callback: Function) => microtasks.push(callback), false,
  );
  start.dispatchEvent(new win.Event('mouseenter'));
  brand.focus();
  expect(start.dataset.menuOpen).toBe('true');
  let titleCaptured = false;
  doc.addEventListener('header:navigation-start', () => { titleCaptured = true; });
  start.addEventListener('header:trigger-close', () => expect(titleCaptured).toBe(true));
  doc.dispatchEvent(new win.Event('header:navigation-start'));
  expect(start.dataset.menuOpen).toBe('true');
  microtasks.splice(0).forEach((callback) => callback());
  expect(start.dataset.menuOpen).toBeUndefined();
  expect(start.dataset.menuSurfaceOpen).toBeUndefined();
  expect(links.every((link) => link.style.opacity === '0' && parseFloat(link.style.getPropertyValue('--menu-link-duration')) > 0)).toBe(true);
  expect(timings.at(-1)![0]).toBeGreaterThan(0);
  expect(timings.at(-1)![0] + timings.at(-1)![1]).toBeCloseTo(0.18);
  expect(doc.activeElement).toBe(brand);
  const closing = [...timers.values()].at(-1)!;
  expect(closing.delay).toBe(212);
  closing.callback();
  expect(start.classList.contains('is-menu-open')).toBe(false);
  start.dispatchEvent(new win.Event('mouseenter'));
  expect(start.dataset.menuOpen).toBeUndefined();
  doc.dispatchEvent(new win.Event('header:navigation-cancel'));
  start.dispatchEvent(new win.Event('mouseenter'));
  expect(start.dataset.menuOpen).toBe('true');
  doc.dispatchEvent(new win.Event('header:navigation-start'));
  microtasks.splice(0).forEach((callback) => callback());
  doc.dispatchEvent(new win.Event('header:force-close'));
  start.dispatchEvent(new win.Event('mouseenter'));
  expect(start.dataset.menuOpen).toBe('true');
});

test('navigation slides only a visible partly clipped header into view using the hover docking path', () => {
  const marker = "    document.addEventListener('header:navigation-start', () => {";
  const begin = header.indexOf(marker);
  const end = header.indexOf('\n    });', begin) + '\n    });'.length;
  expect(begin).toBeGreaterThan(0);
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(header.slice(begin, end));
  for (const scenario of [
    { top: -8, bottom: 35, visible: true, shouldSlide: true },
    { top: -60, bottom: -5, visible: true, shouldSlide: false },
    { top: 10, bottom: 50, visible: true, shouldSlide: false },
    { top: -8, bottom: 35, visible: false, shouldSlide: false },
  ]) {
    const win = new Window();
    const calls: unknown[][] = [];
    if (scenario.visible) win.document.documentElement.dataset.headerNavigation = '';
    new Function('document', 'logicalHeaderRect', 'setMode', script)(win.document, () => scenario, (...args: unknown[]) => calls.push(args));
    win.document.dispatchEvent(new win.Event('header:navigation-start'));
    expect(calls).toEqual(scenario.shouldSlide ? [['docked', false, true]] : []);
  }
});

test('home intro gate suppresses unseen home handover while allowing seen and other destinations', () => {
  const run = (targetHref: string, introValue: string | null, storageBlocked = false) => {
    const f = runtimeFixture('Previous');
    f.win.sessionStorage.setItem('vcd:header-navigation', JSON.stringify({ href: targetHref, title: 'Stale', time: Date.now() }));
    const head = f.doc.querySelector('.site-header')!;
    const rect = { top: 0, left: 0, bottom: 80, right: 800, width: 800, height: 80 };
    f.slot.getBoundingClientRect = () => ({ ...rect, top: -1000, bottom: -920 } as any);
    head.getBoundingClientRect = () => rect as any;
    f.home.getBoundingClientRect = () => rect as any;
    if (introValue !== null) f.win.sessionStorage.setItem('vcd:home-intro-seen', introValue);
    const originalGet = f.win.sessionStorage.getItem.bind(f.win.sessionStorage);
    if (storageBlocked) f.win.sessionStorage.getItem = () => { throw new Error('blocked'); };
    const getStyle = (el: any) => ({ display: 'block', visibility: 'visible', opacity: '1', fontSize: '20px', marginLeft: '2px' });
    const runtime = new Function('document', 'sessionStorage', 'getComputedStyle', 'innerHeight', 'innerWidth', 'CustomEvent', `${compiledCapture}; return {captureHeaderNavigation,clearHeaderNavigationState}`)(f.doc, f.win.sessionStorage, getStyle, 900, 1200, f.win.CustomEvent);
    const result = runtime.captureHeaderNavigation(new URL(targetHref));
    f.win.sessionStorage.getItem = originalGet;
    return { f, result };
  };
  const unseen = run('https://vcd.test/', null);
  expect(unseen.result).toBe(false);
  expect(unseen.f.doc.documentElement.dataset.headerNavigation).toBeUndefined();
  expect(unseen.f.win.sessionStorage.getItem('vcd:header-navigation')).toBeNull();
  const queryUnseen = run('https://vcd.test/?from=menu', null);
  expect(queryUnseen.result).toBe(false);
  expect(queryUnseen.f.doc.documentElement.dataset.headerNavigation).toBeUndefined();
  const seen = run('https://vcd.test/', 'true');
  expect(seen.result).toBe(true);
  const explicitUnseen = run('https://vcd.test/', 'false');
  expect(explicitUnseen.result).toBe(false);
  const other = run('https://vcd.test/about', null);
  expect(other.result).toBe(true);
  const blocked = run('https://vcd.test/', null, true);
  expect(blocked.result).toBe(false);
  expect(blocked.f.doc.documentElement.dataset.headerNavigation).toBeUndefined();
  expect(blocked.f.win.sessionStorage.getItem('vcd:header-navigation')).toBeNull();
});
