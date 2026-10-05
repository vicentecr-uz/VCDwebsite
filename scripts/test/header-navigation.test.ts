import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');

function menuFixture() {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = '<div id="transition-overlay" data-vcd-initial-reveal="running"></div><div class="header-trigger header-trigger--start"><div class="header-trigger__panel-bg"></div><a href="/" class="header-trigger__brand-link">Home</a><a class="header-menu__link">About</a><a class="header-menu__link">Play</a></div>';
  const start = doc.querySelector<HTMLElement>('.header-trigger')!;
  const brand = start.querySelector<HTMLElement>('.header-trigger__brand-link')!;
  const links = [...start.querySelectorAll<HTMLElement>('.header-menu__link')];
  const begin = header.indexOf("\n  document.querySelectorAll<HTMLElement>('.header-trigger').forEach", header.indexOf('const forceCloseMenus'));
  const end = header.indexOf('  // Switching between hover and tap', begin);
  expect(begin).toBeGreaterThan(0);
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(header.slice(begin, end).replaceAll('import.meta.env.DEV', 'false'));
  const timers = new Map<number, { callback: Function; delay: number }>();
  const frames: Function[] = [];
  const timings: number[][] = [];
  let sequence = 0;
  const clearTimer = (id: number) => timers.delete(id);
  new Function('document', 'window', 'MouseEvent', 'HTMLElement', 'CustomEvent', 'syncMenuSurfaceInlineSize', 'setMenuSurfaceTiming', 'isTapMode', 'isDevEditing', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'menuScrollClosed', script)(
    doc, win, win.MouseEvent, win.HTMLElement, win.CustomEvent, () => {}, (...values: number[]) => timings.push(values), () => false, () => false,
    (callback: Function, delay: number) => { timers.set(++sequence, { callback, delay }); return sequence; },
    clearTimer, (callback: Function) => frames.push(callback), false,
  );
  const forceScript = new Bun.Transpiler({ loader: 'ts' }).transformSync(header.slice(header.indexOf('  const forceCloseMenus ='), begin));
  const forceClose = new Function('document', 'HTMLElement', 'CustomEvent', 'setMenuSurfaceTiming', 'clearTimeout', `let menuScrollClosed = false; ${forceScript}; return forceCloseMenus;`)(doc, win.HTMLElement, win.CustomEvent, (...values: number[]) => timings.push(values), clearTimer);
  return { win, doc, start, brand, links, timers, timings, forceClose, frame: () => frames.splice(0).forEach((callback) => callback()) };
}


test('menu stays open through navigation and commit, then exits with the incoming reveal', () => {
  const f = menuFixture();
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  f.frame();
  expect(f.start.dataset.menuOpen).toBe('true');
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start'));
  f.start.dispatchEvent(new f.win.MouseEvent('mouseleave'));
  expect(f.start.dataset.menuOpen).toBe('true');
  expect(f.links.every((link) => link.style.opacity === '1')).toBe(true);
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-commit'));
  f.start.dispatchEvent(new f.win.MouseEvent('mouseleave'));
  expect(f.start.dataset.menuOpen).toBe('true');
  expect(f.timers.size).toBe(0);
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-reveal'));
  expect(f.start.dataset.menuOpen).toBeUndefined();
  expect(f.start.dataset.menuSurfaceOpen).toBeUndefined();
  expect(f.links.every((link) => link.style.opacity === '0')).toBe(true);
  expect(f.timings.at(-1)![0] + f.timings.at(-1)![1]).toBeCloseTo(0.18);
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBeUndefined();
  [...f.timers.values()].forEach((timer) => timer.callback());
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBe('true');
});

test('current link appearance stays stable until the retained menu finishes closing', () => {
  const f = menuFixture();
  f.links[0].setAttribute('aria-current', 'page');
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter')); f.frame();
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start'));
  f.links[0].removeAttribute('aria-current'); f.links[1].setAttribute('aria-current', 'page');
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-commit'));
  expect(f.links.map((link) => link.dataset.navigationCurrent)).toEqual(['true', 'false']);
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-reveal'));
  expect(f.links.map((link) => link.dataset.navigationCurrent)).toEqual(['true', 'false']);
  [...f.timers.values()].forEach((timer) => timer.callback());
  expect(f.links.every((link) => link.dataset.navigationCurrent === undefined)).toBe(true);
  expect(f.links[1].getAttribute('aria-current')).toBe('page');
});

test('a new navigation during menu exit remains locked until its own reveal', () => {
  const f = menuFixture();
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter')); f.frame();
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start'));
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-reveal'));
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start'));
  [...f.timers.values()].forEach((timer) => timer.callback());
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBeUndefined();
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-reveal'));
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBe('true');
});

test('cancellation releases the outgoing menu lock', () => {
  const f = menuFixture();
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter')); f.frame();
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start'));
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-cancel'));
  expect(f.links.every((link) => link.dataset.navigationCurrent === undefined)).toBe(true);
  [...f.timers.values()].forEach((timer) => timer.callback());
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBe('true');
});

function titleFixture() {
  const win = new Window({ url: 'https://vcd.test/project' });
  const doc = win.document;
  doc.body.innerHTML = '<div class="site-header-slot"><header class="site-header"><div class="header-trigger--start" data-header-title-swap="true"><span class="header-trigger__sizer">Project</span><a class="header-trigger__brand-link" href="/"><span class="header-trigger__wordmark-stack"><h1 class="header-trigger__wordmark header-trigger__wordmark--page" aria-hidden="false"><span class="header-trigger__char">Project</span></h1><span class="header-trigger__wordmark header-trigger__wordmark--home" aria-hidden="true"><span class="header-trigger__char">Vicente Cruz</span></span></span></a></div><div class="header-trigger--end"><a class="header-trigger__brand-link" href="/">Logo</a></div></header></div>';
  const slot = doc.querySelector('.site-header-slot')!;
  const stack = doc.querySelector<HTMLElement>('.header-trigger__wordmark-stack')!;
  const timers = new Map<number, () => void>(); let id = 0;
  const clock = { setTimeout(fn: () => void) { timers.set(++id, fn); return id; }, clearTimeout(id: number) { timers.delete(id); }, addEventListener() {},
    __vcdHeaderTitleTransition() {
      stack.style.visibility = 'hidden';
      const layer = doc.createElement('div'); layer.className = 'live-title-transition'; stack.append(layer);
      return { finishesAt: Date.now() + 1000, cleanup() { stack.style.visibility = ''; layer.remove(); } };
    },
  };
  const script = header.slice(header.indexOf("  const startTrigger = document.querySelector('.header-trigger--start');"), header.indexOf('  let currentPageLinks = [')).replaceAll('import.meta.env.DEV', 'false');
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script);
  new Function('document', 'window', 'headerSlot', 'requestAnimationFrame', 'cancelAnimationFrame', 'applyWordmarkKerning', 'isDevEditing', compiled)(doc, clock, slot, () => 0, () => {}, () => {}, () => false);
  return { win, doc, slot, stack, timers };
}

test('destination title commits behind the same running title layer, then unlocks hover', () => {
  const f = titleFixture();
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start', { detail: { pending: { title: 'Project', targetTitle: 'Play' } } }));
  const live = f.stack.querySelector('.live-title-transition');
  const incoming = f.slot.cloneNode(true) as any;
  incoming.querySelector('.live-title-transition').remove();
  incoming.querySelector('.header-trigger__wordmark--page').textContent = 'Play';
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-commit', { detail: { header: incoming, url: new URL('https://vcd.test/play') } }));
  expect(f.stack.querySelector('.live-title-transition')).toBe(live);
  expect(f.stack.style.visibility).toBe('hidden');
  expect(f.stack.querySelector('.header-trigger__wordmark--page')?.textContent).toBe('Play');
  [...f.timers.values()].forEach((finish) => finish());
  expect(live?.isConnected).toBe(false);
  expect(f.stack.style.visibility).toBe('');
  expect(f.slot.isConnected).toBe(true);
});

test('Home commit clears retained wordmark timing and blur before the transition layer cleans up', () => {
  const f = titleFixture();
  const homeChars = [...f.stack.querySelectorAll<HTMLElement>('.header-trigger__wordmark--home .header-trigger__char')];
  homeChars.forEach((char) => {
    char.style.setProperty('--char-duration', '.25s');
    char.style.setProperty('--char-delay', '.55s');
    char.style.setProperty('--char-blur', '4px');
    char.style.opacity = '1';
  });
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start', { detail: { pending: { title: 'Project', targetTitle: 'Home' } } }));
  const live = f.stack.querySelector('.live-title-transition');
  const incoming = f.slot.cloneNode(true) as any;
  incoming.querySelector('.live-title-transition').remove();
  incoming.querySelector('.header-trigger--start').classList.add('header-trigger--home');
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-commit', { detail: { header: incoming, url: new URL('https://vcd.test/') } }));

  const expectReset = () => {
    expect(homeChars.every((char) => char.style.getPropertyValue('--char-duration') === '0s')).toBe(true);
    expect(homeChars.every((char) => char.style.getPropertyValue('--char-delay') === '0s')).toBe(true);
    expect(homeChars.every((char) => char.style.getPropertyValue('--char-blur') === '0px')).toBe(true);
    expect(homeChars.every((char) => char.style.opacity === '0')).toBe(true);
  };
  expectReset();
  expect(f.stack.querySelector('.live-title-transition')).toBe(live);
  [...f.timers.values()].forEach((finish) => finish());
  expectReset();
  expect(live?.isConnected).toBe(false);
});

test('title trigger stays locked until reveal, then opens and clears the bridge', () => {
  const f = titleFixture();
  const startTrigger = f.doc.querySelector<HTMLElement>('.header-trigger--start')!;
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start', { detail: { pending: { title: 'Project', targetTitle: 'Play' } } }));
  const live = f.stack.querySelector('.live-title-transition');
  const incoming = f.slot.cloneNode(true) as any;
  incoming.querySelector('.live-title-transition').remove();
  incoming.querySelector('.header-trigger__wordmark--page').textContent = 'Play';
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-commit', { detail: { header: incoming, url: new URL('https://vcd.test/play') } }));

  startTrigger.dispatchEvent(new f.win.CustomEvent('header:trigger-open'));
  expect(f.stack.querySelector('.live-title-transition')).toBe(live);
  expect(f.stack.querySelector('.header-trigger__wordmark--home')?.getAttribute('aria-hidden')).toBe('true');

  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-reveal'));
  startTrigger.dispatchEvent(new f.win.CustomEvent('header:trigger-open'));
  expect(f.stack.querySelector('.live-title-transition')).toBeNull();
  expect(startTrigger.classList.contains('is-wordmark-swapped')).toBe(true);
  expect(f.stack.querySelector('.header-trigger__wordmark--home')?.getAttribute('aria-hidden')).toBe('false');
  expect(f.timers.size).toBe(0);
});

test('cancellation removes only the transition layer and keeps the current page title', () => {
  const f = titleFixture();
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-start', { detail: { pending: { title: 'Project', targetTitle: 'Play' } } }));
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-cancel'));
  expect(f.stack.querySelector('.live-title-transition')).toBeNull();
  expect(f.stack.querySelector('.header-trigger__wordmark--page')?.textContent).toBe('Project');
  expect(f.stack.style.visibility).toBe('');
});


test('both brand links update on Home and project commits without replacing either anchor', () => {
  const f = titleFixture();
  const brands = [...f.doc.querySelectorAll('.header-trigger__brand-link')];
  expect(brands.length).toBe(2);
  for (const href of [null, '/']) {
    const incoming = f.slot.cloneNode(true) as any;
    incoming.querySelectorAll('.header-trigger__brand-link').forEach((link: Element) => {
      if (href) link.setAttribute('href', href); else link.removeAttribute('href');
    });
    f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-commit', { detail: { header: incoming, url: new URL('https://vcd.test/') } }));
    expect([...f.doc.querySelectorAll('.header-trigger__brand-link')]).toEqual(brands);
    expect(brands.map((link) => link.getAttribute('href'))).toEqual([href, href]);
  }
});
