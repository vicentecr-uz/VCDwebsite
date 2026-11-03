import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const globals = ['window', 'document', 'AbortController', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
let restore: (() => Promise<void>) | undefined;

afterEach(async () => { await restore?.(); restore = undefined; });

function fixture() {
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
    win.document.body.innerHTML = `<main id="main-content">${ids.map(id => `<h2 id="${id}" style="scroll-margin-top: 48px">${id}</h2>`).join('')}</main><nav data-documentation-contents>${ids.map(id => `<a href="#${id}">${id}</a>`).join('')}</nav>`;
    const tops = [80, 400, 800];
    let reads = 0;
    ids.forEach((id, index) => {
      win.document.getElementById(id)!.getBoundingClientRect = () => { reads++; return { top: tops[index] } as DOMRect; };
    });
    return {
      tops,
      reads: () => reads,
      current: () => [...win.document.querySelectorAll('[aria-current="location"]')].map(link => link.getAttribute('href')),
    };
  };
  const page = render();
  const source = readFileSync(new URL('../../src/components/DocumentationContents.astro', import.meta.url), 'utf8');
  const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, ''));
  new Function('createPageScope', 'onPageLoad', compiled)(createPageScope, (mount: Parameters<typeof onPageLoad>[0]) => { dispose = onPageLoad(mount); });
  return {
    win, page, render,
    pending: () => frames.size,
    setScroll: (value: number) => { scrollY = value; },
    event: (type: string) => win.dispatchEvent(new win.Event(type)),
    pageEvent: (type: string) => win.document.dispatchEvent(new win.Event(type)),
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); },
  };
}

test('initial outline marks only the first heading current', () => {
  const f = fixture();
  expect(f.page.current()).toEqual(['#installation']);
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
  f.page.tops[2] = 0;
  f.event('scroll'); f.flush();
  expect(f.page.current()).toEqual(['#sync']);
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
  next.tops.splice(0, 3, -200, 20, 400);
  for (const type of ['scroll', 'resize', 'hashchange']) f.event(type);
  expect(f.pending()).toBe(1);
  f.flush();
  expect(next.reads()).toBe(6);
  expect(next.current()).toEqual(['#input-types']);
  expect(f.page.reads()).toBe(oldReads);
});
