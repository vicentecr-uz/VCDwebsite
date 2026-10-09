import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoBlockGuide } from '../../src/lib/demoBlockGuide';

type Harness = ReturnType<typeof setup>;

function setup(reduced = false) {
  const win = new Window({ url: 'http://localhost/' });
  let now = 0; let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  win.performance.now = () => now;
  win.setTimeout = ((callback: TimerHandler, delay?: number) => { const id = ++next; timers.set(id, { at: now + Number(delay || 0), callback: callback as () => void }); return id; }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof win.clearTimeout;
  win.requestAnimationFrame = ((callback: FrameRequestCallback) => { const id = ++next; frames.set(id, callback); return id; }) as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = ((id: number) => { frames.delete(id); }) as typeof win.cancelAnimationFrame;
  win.matchMedia = (() => ({ matches: reduced, media: '(prefers-reduced-motion: reduce)', addEventListener: () => {}, removeEventListener: () => {} })) as typeof win.matchMedia;
  const observerInstances: Array<{ callback: IntersectionObserverCallback; observe: (element: Element) => void; disconnect: () => void }> = [];
  win.IntersectionObserver = class {
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; observerInstances.push(this as unknown as typeof observerInstances[number]); }
    observe = () => {};
    disconnect = () => {};
  } as unknown as typeof win.IntersectionObserver;
  const root = win.document.createElement('div'); root.innerHTML = '<div data-page-viewport><div data-image><img><span class="dev-gap-toolbar__pill"></span><button data-dev-spacing-option="group"></button><span data-reorder-demo-handle></span></div><div data-text></div><button data-revert>Revert</button><div data-cursor></div></div>';
  win.document.body.append(root);
  const viewport = root.querySelector<HTMLElement>('[data-page-viewport]')!;
  const imageBlock = root.querySelector<HTMLElement>('[data-image]')!;
  const textBlock = root.querySelector<HTMLElement>('[data-text]')!;
  const cursor = root.querySelector<HTMLElement>('[data-cursor]')!;
  const revertButton = root.querySelector<HTMLButtonElement>('[data-revert]')!;
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(viewport, 'getBoundingClientRect', { value: () => rect(0, 0, 1000, 800) });
  Object.defineProperty(imageBlock, 'getBoundingClientRect', { value: () => rect(100, 100, 300, 200) });
  Object.defineProperty(textBlock, 'getBoundingClientRect', { value: () => rect(500, 180, 300, 300) });
  Object.defineProperty(imageBlock.querySelector('.dev-gap-toolbar__pill'), 'getBoundingClientRect', { value: () => rect(180, 180, 40, 20) });
  Object.defineProperty(imageBlock.querySelector('[data-dev-spacing-option="group"]'), 'getBoundingClientRect', { value: () => rect(180, 220, 80, 30) });
  Object.defineProperty(imageBlock.querySelector('[data-reorder-demo-handle]'), 'getBoundingClientRect', { value: () => rect(180, 150, 30, 30) });
  Object.defineProperty(revertButton, 'getBoundingClientRect', { value: () => rect(650, 650, 100, 40) });
  const image = root.querySelector('img')! as HTMLImageElement; image.decode = () => Promise.resolve();
  Object.defineProperty(win.document, 'fonts', { value: { ready: Promise.resolve() } });
  const actions: string[] = [];
  const gaps = { reveal: () => actions.push('reveal'), hide: () => actions.push('hide') };
  const reorder = { guideLift: () => { actions.push('lift'); return true; }, guideMove: (x: number, y: number) => actions.push(`move:${Math.round(x)},${Math.round(y)}`), guideDrop: async () => { actions.push('drop'); }, cancel: () => actions.push('cancel') };
  revertButton.addEventListener('click', () => actions.push('revert'));
  const guide = createDemoBlockGuide({ root: root.firstElementChild as HTMLElement, cursor, imageBlock, textBlock, gaps, reorder, revertButton });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(now); }
    await flush();
  };
  return { win, root, cursor, imageBlock, actions, guide, observerInstances, flush, advance };
}

async function reachDrop(h: Harness) {
  h.guide.play(); await h.flush();
  await h.advance(600); await h.advance(420); await h.advance(250); await h.advance(320); await h.advance(100); await h.advance(120); await h.advance(120); await h.advance(350); await h.advance(400); await h.advance(120);
  await h.advance(200); await h.advance(200); await h.advance(200); await h.advance(200); await h.advance(200); await h.advance(1000); await h.flush(); await h.advance(120); await h.advance(320); await h.advance(100); await h.advance(120); await h.advance(120); await h.advance(120); await h.advance(120); await h.advance(500); await h.advance(250);
}

test('plays the guide sequence with grouped spacing, smooth drag, drop, and actual revert click', async () => {
  const h = setup();
  await reachDrop(h);
  expect(h.actions).toContain('reveal');
  expect(h.actions).toContain('lift');
  expect(h.actions.filter((action) => action.startsWith('move:')).length).toBeGreaterThan(1);
  expect(h.actions.indexOf('drop')).toBeGreaterThan(h.actions.indexOf('lift'));
  expect(h.actions.indexOf('revert')).toBeGreaterThan(h.actions.indexOf('drop'));
  expect(h.cursor.style.opacity).toBe('0');
  h.guide.destroy();
});

test('cancelling during the initial wait or drag stops queued actions', async () => {
  const waiting = setup(); waiting.guide.play(); await waiting.flush(); await waiting.advance(300); waiting.guide.stop(); await waiting.advance(5000); expect(waiting.actions.filter((action) => action === 'reveal')).toEqual([]); waiting.guide.destroy();
  const moving = setup(); moving.guide.play(); await moving.flush(); await moving.advance(600); await moving.advance(420); await moving.advance(250); await moving.advance(320); await moving.advance(100); await moving.advance(120); await moving.advance(120); await moving.advance(350); await moving.advance(400); await moving.advance(120); await moving.advance(200); const moves = moving.actions.filter((action) => action.startsWith('move:')).length; moving.guide.stop(); await moving.advance(5000); expect(moving.actions.filter((action) => action.startsWith('move:')).length).toBe(moves); expect(moving.actions).not.toContain('drop'); moving.guide.destroy();
});

test('observer auto-starts once, leaving cancels, and destroy keeps Astro markup', async () => {
  const h = setup(); const observer = h.observerInstances[0];
  observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver); for (let i = 0; i < 10; i += 1) await h.flush(); observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver); expect(h.actions.filter((action) => action === 'hide')).toHaveLength(1);
  observer.callback([{ isIntersecting: false } as IntersectionObserverEntry], observer as unknown as IntersectionObserver); h.guide.destroy(); expect(h.root.querySelector('[data-image]')).not.toBeNull(); expect(h.root.querySelector('[data-cursor]')).not.toBeNull();
});

test('reduced motion never changes gaps or order', async () => {
  const h = setup(true); h.guide.play(); await h.flush(); await h.advance(280); await h.advance(700); await h.advance(250); expect(h.actions.filter((action) => action === 'reveal' || action === 'lift' || action === 'drop')).toEqual([]); h.guide.destroy();
});
