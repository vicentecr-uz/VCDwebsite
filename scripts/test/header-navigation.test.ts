import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');
const titleTransition = readFileSync(resolve(root, 'src/scripts/headerTitleTransition.js'), 'utf8');
const settleMicrotasks = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function menuFixture(linkCount = 2) {
  const win = new Window();
  const doc = win.document;
  const linksHtml = Array.from({ length: linkCount }, (_, index) => `<a class="header-menu__link">Link ${index + 1}</a>`).join('');
  doc.body.innerHTML = `<div id="transition-overlay" data-vcd-initial-reveal="running"></div><div class="header-trigger header-trigger--start"><div class="header-trigger__panel-bg"></div><a href="/" class="header-trigger__brand-link">Home</a>${linksHtml}</div>`;
  const start = doc.querySelector<HTMLElement>('.header-trigger')!;
  const brand = start.querySelector<HTMLElement>('.header-trigger__brand-link')!;
  const links = [...start.querySelectorAll<HTMLElement>('.header-menu__link')];
  let hovered = false;
  const originalMatches = start.matches.bind(start);
  start.matches = ((selector: string) => selector === ':hover' ? hovered : originalMatches(selector)) as typeof start.matches;
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
  return { win, doc, start, brand, links, timers, timings, forceClose, setHovered: (value: boolean) => { hovered = value; }, frame: () => frames.splice(0).forEach((callback) => callback()) };
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
  expect(f.timings.at(-1)![0]).toBeCloseTo(0.18);
  expect(f.timings.at(-1)![1]).toBeCloseTo(0.1575);
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBeUndefined();
  [...f.timers.values()].forEach((timer) => timer.callback());
  expect(f.start.dataset.menuCloseTimer).toBeUndefined();
  expect(f.start.classList.contains('is-menu-open')).toBe(false);
  f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
  expect(f.start.dataset.menuOpen).toBe('true');
});

for (const linkCount of [1, 3, 5]) {
  test(`menu veil waits for all ${linkCount} links, then reopens without the close delay`, () => {
    const f = menuFixture(linkCount);
    f.setHovered(true); f.start.dispatchEvent(new f.win.MouseEvent('mouseenter')); f.frame();
    f.setHovered(false); f.start.dispatchEvent(new f.win.MouseEvent('mouseleave'));
    const linkCloseEnd = Math.max(...f.links.map((link) =>
      parseFloat(link.style.getPropertyValue('--menu-link-delay')) +
      parseFloat(link.style.getPropertyValue('--menu-link-duration')),
    ));
    const surfaceCloseDuration = f.timings.at(-1)![0];
    const surfaceCloseDelay = f.timings.at(-1)![1];
    const timer = [...f.timers.values()][0];
    expect(surfaceCloseDuration).toBeCloseTo(0.18);
    expect(surfaceCloseDelay).toBeCloseTo(linkCloseEnd);
    expect(timer.delay).toBe(Math.ceil((linkCloseEnd + surfaceCloseDuration) * 1000) + 32);
    expect(f.start.classList.contains('is-menu-open')).toBe(true);
    f.setHovered(true); f.start.dispatchEvent(new f.win.MouseEvent('mouseenter'));
    expect(f.timers.size).toBe(0);
    expect(f.timings.at(-1)![1]).toBe(0);
    expect(f.start.classList.contains('is-menu-open')).toBe(true);
  });
}

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

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

function navigationFixture(pageTitle = 'Home') {
  const f = menuFixture();
  const { win, doc, start, brand } = f;
  const chars = (text: string) => [...text].map((char) => `<span class="header-trigger__char">${char}</span>`).join('');
  const slot = doc.createElement('div');
  slot.className = 'site-header-slot';
  start.replaceWith(slot);
  const siteHeader = doc.createElement('header');
  siteHeader.className = 'site-header';
  slot.append(siteHeader);
  siteHeader.append(start);
  siteHeader.insertAdjacentHTML('beforeend', '<div class="header-trigger--end"><a class="header-trigger__brand-link" href="/">Logo</a></div>');
  start.dataset.headerTitleSwap = String(pageTitle !== 'Home');
  start.classList.toggle('header-trigger--home', pageTitle === 'Home');
  brand.innerHTML = `<span class="header-trigger__wordmark-stack"><h1 class="header-trigger__wordmark header-trigger__wordmark--page" aria-hidden="false">${chars(pageTitle)}</h1><span class="header-trigger__wordmark header-trigger__wordmark--home" aria-hidden="true">${chars('Home')}</span></span>`;
  const stack = brand.querySelector<HTMLElement>('.header-trigger__wordmark-stack')!;
  const animations: Array<{ id: string; startTime: number | null; finished: Promise<void>; finish: () => void; cancel: () => void }> = [];
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: Math.max(16, (this.textContent?.length ?? 1) * 16), height: 24 } as any;
  };
  win.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 16, height: 24 }) as any;
  win.HTMLElement.prototype.animate = function () {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    const animation = { id: '', startTime: null, finished, finish, cancel() { reject(new Error('canceled')); } };
    animations.push(animation);
    return animation as any;
  };
  Object.defineProperty(doc, 'timeline', { value: { currentTime: 5000 } });
  const computed = (el: HTMLElement) => ({ font: '400 16px sans-serif', fontSize: '16px', lineHeight: '24px', letterSpacing: '0px', fontKerning: 'auto', fontFeatureSettings: 'normal', opacity: el.style.opacity || '1', filter: el.style.filter || 'none' });
  new Function('window', 'document', 'getComputedStyle', titleTransition)(win, doc, computed);
  let sequence = 1000;
  const frames = new Map<number, () => void>();
  const clock = {
    setTimeout(callback: () => void, delay: number) { f.timers.set(++sequence, { callback, delay }); return sequence; },
    clearTimeout(id: number) { f.timers.delete(id); }, addEventListener() {},
    __vcdHeaderTitleTransition: (win as any).__vcdHeaderTitleTransition,
  };
  const script = header.slice(header.indexOf("  const startTrigger = document.querySelector('.header-trigger--start');"), header.indexOf('  let currentPageLinks = [')).replaceAll('import.meta.env.DEV', 'false');
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script);
  new Function('document', 'window', 'headerSlot', 'requestAnimationFrame', 'cancelAnimationFrame', 'applyWordmarkKerning', 'isDevEditing', 'CustomEvent', compiled)(doc, clock, slot, (fn: () => void) => { frames.set(++sequence, fn); return sequence; }, (id: number) => frames.delete(id), () => {}, () => false, win.CustomEvent);
  const page = () => stack.querySelector<HTMLElement>('.header-trigger__wordmark--page')!;
  const home = stack.querySelector<HTMLElement>('.header-trigger__wordmark--home')!;
  return {
    ...f, slot, stack, page, home,
    hover(value: boolean) { f.setHovered(value); start.dispatchEvent(new win.MouseEvent(value ? 'mouseenter' : 'mouseleave')); },
    focus() {
      const matches = brand.matches.bind(brand);
      brand.matches = (selector: string) => selector === ':focus-visible' || matches(selector);
      brand.focus();
    },
    navigate(title: string) {
      const count = animations.length;
      doc.dispatchEvent(new win.CustomEvent('header:navigation-start', { detail: { pending: { title: page().textContent, targetTitle: title } } }));
      return animations.slice(count);
    },
    commit(title: string) {
      const incoming = slot.cloneNode(true) as HTMLElement;
      const next = incoming.querySelector<HTMLElement>('.header-trigger--start')!;
      next.dataset.headerTitleSwap = String(title !== 'Home');
      next.classList.toggle('header-trigger--home', title === 'Home');
      next.querySelector('.header-trigger__wordmark--page')!.innerHTML = chars(title);
      incoming.querySelectorAll('a.header-trigger__brand-link').forEach((link) => link.setAttribute('href', title === 'Home' ? '#' : '/'));
      doc.dispatchEvent(new win.CustomEvent('header:navigation-commit', { detail: { header: incoming, url: new URL('https://vcd.test/') } }));
    },
    reveal() { doc.dispatchEvent(new win.CustomEvent('header:navigation-reveal')); },
    async finish(effects: typeof animations) { effects.forEach((animation) => animation.finish()); await flush(); },
    frame() { f.frame(); const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
  };
}

test('early hover waits for commit and every native title effect, then opens name and menu together', async () => {
  const f = navigationFixture();
  const effects = f.navigate('GoodHome');
  f.hover(true);
  f.commit('GoodHome');
  f.reveal();
  await f.finish(effects.slice(0, -1));
  expect(f.start.dataset.menuOpen).toBeUndefined();
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(false);
  expect(f.stack.querySelector('.header-navigation-title')).not.toBeNull();
  await f.finish(effects.slice(-1));
  expect(f.stack.querySelector('.header-navigation-title')).toBeNull();
  expect(f.start.dataset.menuOpen).toBe('true');
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(true);
  expect(f.page().getAttribute('aria-hidden')).toBe('true');
  f.frame();
  expect([...f.home.children].every((char) => (char as HTMLElement).style.opacity === '1')).toBe(true);
});

test('leaving before the title finishes cancels the queued opening', async () => {
  const f = navigationFixture();
  const effects = f.navigate('Knife');
  f.commit('Knife'); f.reveal(); f.hover(true); f.hover(false);
  await f.finish(effects);
  expect(f.start.dataset.menuOpen).toBeUndefined();
  expect(f.start.dataset.headerTitlePending).toBeUndefined();
  expect(f.page().getAttribute('aria-hidden')).toBe('false');
  expect(f.home.getAttribute('aria-hidden')).toBe('true');
});

test('native completion before a delayed commit cannot unlock the old title', async () => {
  const f = navigationFixture();
  const effects = f.navigate('Knife');
  f.hover(true);
  await f.finish(effects);
  expect(f.page().textContent).toBe('Home');
  expect(f.start.dataset.headerTitlePending).toBe('');
  expect(f.start.dataset.menuOpen).toBeUndefined();
  f.commit('Knife');
  await flush();
  expect(f.start.dataset.headerTitlePending).toBeUndefined();
  expect(f.start.dataset.menuOpen).toBeUndefined();
  f.reveal();
  expect(f.start.dataset.menuOpen).toBe('true');
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(true);
});

for (const revealFirst of [true, false]) {
  test(`keyboard focus opens after both title completion and reveal (${revealFirst})`, async () => {
    const f = navigationFixture();
    const effects = f.navigate('Knife');
    f.commit('Knife'); f.focus();
    if (revealFirst) f.reveal();
    expect(f.start.dataset.menuOpen).toBeUndefined();
    await f.finish(effects);
    if (!revealFirst) { expect(f.start.dataset.menuOpen).toBeUndefined(); f.reveal(); }
    expect(f.start.dataset.menuOpen).toBe('true');
    expect(f.home.getAttribute('aria-hidden')).toBe('false');
  });
}

test('superseded completion cannot clean or unlock the current title', async () => {
  const f = navigationFixture();
  const first = f.navigate('Knife'); f.commit('Knife'); f.hover(true);
  const second = f.navigate('GoodHome'); f.commit('GoodHome'); f.reveal();
  await f.finish(first);
  expect(f.start.dataset.headerTitlePending).toBe('');
  expect(f.start.dataset.menuOpen).toBeUndefined();
  expect(f.page().textContent).toBe('GoodHome');
  await f.finish(second);
  expect(f.start.dataset.menuOpen).toBe('true');
});

test('canceling navigation releases the title lock and ignores stale completion', async () => {
  const f = navigationFixture();
  const effects = f.navigate('Knife'); f.hover(true);
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-cancel'));
  await f.finish(effects);
  expect(f.start.dataset.headerTitlePending).toBeUndefined();
  expect(f.page().textContent).toBe('Home');
  expect(f.start.dataset.menuOpen).toBeUndefined();
  expect(f.stack.querySelector('.header-navigation-title')).toBeNull();
});

test('cancellation keeps the name visible when the current menu remains open', async () => {
  const f = navigationFixture('Knife');
  f.hover(true);
  const effects = f.navigate('GoodHome');
  f.doc.dispatchEvent(new f.win.CustomEvent('header:navigation-cancel'));
  await f.finish(effects);
  expect(f.start.dataset.menuOpen).toBe('true');
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(true);
  expect(f.home.getAttribute('aria-hidden')).toBe('false');
  expect([...f.home.children].every((char) => (char as HTMLElement).style.opacity === '1')).toBe(true);
});

test('ordinary hover still opens immediately and Home return settles its semantic title', async () => {
  const f = navigationFixture('Knife');
  f.hover(true); f.frame();
  expect(f.start.dataset.menuOpen).toBe('true');
  expect(f.home.getAttribute('aria-hidden')).toBe('false');
  const effects = f.navigate('Home');
  f.commit('Home'); f.reveal();
  await f.finish(effects);
  expect(f.page().textContent).toBe('Home');
  expect(f.page().getAttribute('aria-hidden')).toBe('false');
  expect(f.home.getAttribute('aria-hidden')).toBe('true');
  expect(f.start.classList.contains('is-wordmark-swapped')).toBe(false);
  expect(f.start.dataset.headerTitlePending).toBeUndefined();
});

test('same-title navigation without a bridge releases the lock on commit', () => {
  const f = navigationFixture();
  f.navigate('Home'); f.commit('Home'); f.reveal();
  expect(f.start.dataset.headerTitlePending).toBeUndefined();
  expect(f.stack.querySelector('.header-navigation-title')).toBeNull();
});

test('both brand links update on commits without replacing either anchor', () => {
  const f = navigationFixture();
  const links = [...f.slot.querySelectorAll('.header-trigger__brand-link')];
  f.commit('Knife');
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/']);
  f.commit('Home');
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['#', '#']);
  expect([...f.slot.querySelectorAll('.header-trigger__brand-link')]).toEqual(links);
});
