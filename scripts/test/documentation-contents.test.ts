import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const globals = ['window', 'document', 'AbortController', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
let restore: (() => Promise<void>) | undefined;

afterEach(async () => { await restore?.(); restore = undefined; });

function fixture(settle = true) {
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = new Window({ url: 'https://vcd.test/sabi/api', innerHeight: 600 });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let scrollY = 0;
  let dispose: (() => void) | undefined;
  Object.defineProperty(win, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(win.document.documentElement, 'scrollHeight', { configurable: true, get: () => 3000 });
  const values = {
    window: win,
    document: win.document,
    AbortController: win.AbortController,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  restore = async () => {
    dispose?.();
    await win.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  const render = () => {
    const ids = ['installation', 'input-types', 'sync'];
    win.document.body.innerHTML = `<main id="main-content">${ids.map(id => `<h2 id="${id}" style="scroll-margin-top: 48px">${id}</h2>`).join('')}</main><nav data-documentation-contents><div class="documentation-contents__outline"><span data-contents-marker aria-hidden="true"></span>${ids.map(id => `<a href="#${id}" style="padding-top:8px;padding-bottom:8px">${id}</a>`).join('')}</div></nav>`;
    const tops = [80, 400, 800];
    const rows = [{ top: 104, height: 32 }, { top: 140, height: 48 }, { top: 192, height: 32 }];
    const outline = win.document.querySelector('.documentation-contents__outline')!;
    outline.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    [...outline.querySelectorAll('a')].forEach((link, index) => {
      link.getBoundingClientRect = () => rows[index] as DOMRect;
    });
    const marker = outline.querySelector<HTMLElement>('[data-contents-marker]')!;
    let reads = 0;
    ids.forEach((id, index) => {
      win.document.getElementById(id)!.getBoundingClientRect = () => { reads++; return { top: tops[index] } as DOMRect; };
    });
    return {
      tops, rows, marker,
      reads: () => reads,
      current: () => [...win.document.querySelectorAll('[aria-current="location"]')].map(link => link.getAttribute('href')),
    };
  };
  const page = render();
  const source = readFileSync(new URL('../../src/components/DocumentationContents.astro', import.meta.url), 'utf8');
  const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, ''));
  new Function('createPageScope', 'onPageLoad', compiled)(createPageScope, (mount: Parameters<typeof onPageLoad>[0]) => { dispose = onPageLoad(mount); });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
  if (settle) flush();
  return {
    win, page, render,
    pending: () => frames.size,
    setScroll: (value: number) => { scrollY = value; },
    event: (type: string) => win.dispatchEvent(new win.Event(type)),
    pageEvent: (type: string) => win.document.dispatchEvent(new win.Event(type)),
    flush,
  };
}

test('initial outline marks only the first heading current', () => {
  const f = fixture(false);
  expect(f.page.current()).toEqual(['#installation']);
  expect(f.page.marker.style.transform).toBe('translateY(12px) scaleY(16)');
  expect(f.page.marker.dataset.ready).toBeUndefined();
  expect(f.pending()).toBe(1);
  f.flush();
  expect(f.page.marker.dataset.ready).toBe('true');
  expect(f.pending()).toBe(0);
});

test('scroll advances at the heading scroll margin and clears the previous current link', () => {
  const f = fixture();
  f.page.tops.splice(0, 3, -200, 50, 400);
  f.event('scroll'); f.flush();
  expect(f.page.current()).toEqual(['#installation']);
  f.page.tops[1] = 49;
  f.event('scroll'); f.flush();
  expect(f.page.current()).toEqual(['#input-types']);
  expect(f.page.marker.style.transform).toBe('translateY(48px) scaleY(32)');
  f.page.tops[2] = 0;
  f.event('scroll'); f.flush();
  expect(f.page.current()).toEqual(['#sync']);
  expect(f.page.marker.style.transform).toBe('translateY(100px) scaleY(16)');
});

test('document bottom selects the final heading even if it has not reached the top margin', () => {
  const f = fixture();
  f.setScroll(2400);
  f.event('scroll'); f.flush();
  expect(f.page.current()).toEqual(['#sync']);
});

test('scroll, resize and hashchange bursts share one pending measurement frame', () => {
  const f = fixture();
  const initialReads = f.page.reads();
  for (const type of ['scroll', 'scroll', 'resize', 'hashchange', 'resize']) f.event(type);
  expect(f.pending()).toBe(1);
  expect(f.page.reads()).toBe(initialReads);
  f.page.tops.splice(0, 3, -200, 20, 400);
  f.flush();
  expect(f.page.reads() - initialReads).toBe(3);
  expect(f.page.current()).toEqual(['#input-types']);
  expect(f.pending()).toBe(0);
});

test('page teardown cancels pending work and listeners; replacement mounts once', () => {
  const f = fixture();
  const oldReads = f.page.reads();
  f.event('scroll');
  expect(f.pending()).toBe(1);
  f.pageEvent('astro:before-swap');
  expect(f.pending()).toBe(0);
  for (const type of ['scroll', 'resize', 'hashchange']) f.event(type);
  f.flush();
  expect(f.pending()).toBe(0);
  expect(f.page.reads()).toBe(oldReads);

  const next = f.render();
  f.pageEvent('astro:page-load');
  f.pageEvent('astro:page-load');
  expect(next.reads()).toBe(3);
  f.flush();
  next.tops.splice(0, 3, -200, 20, 400);
  for (const type of ['scroll', 'resize', 'hashchange']) f.event(type);
  expect(f.pending()).toBe(1);
  f.flush();
  expect(next.reads()).toBe(6);
  expect(next.current()).toEqual(['#input-types']);
  expect(f.page.reads()).toBe(oldReads);
});


test('teardown cancels the initial frame before marker motion is enabled', () => {
  const f = fixture(false);
  expect(f.pending()).toBe(1);
  f.pageEvent('astro:before-swap');
  expect(f.pending()).toBe(0);
  f.flush();
  expect(f.page.marker.dataset.ready).toBeUndefined();
});

test('resize remeasures the marker after outline labels wrap', () => {
  const f = fixture();
  f.page.rows[0] = { top: 104, height: 64 };
  f.event('resize');
  f.flush();
  expect(f.page.marker.style.transform).toBe('translateY(12px) scaleY(48)');
});
