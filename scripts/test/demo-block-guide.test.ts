import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoBlockGuide } from '../../src/lib/demoBlockGuide';

type Harness = ReturnType<typeof setup>;

function setup(reduced = false) {
  const win = new Window({ url: 'http://localhost/' });
  let now = 0; let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  Object.defineProperty(win, 'performance', { value: { now: () => now }, configurable: true });
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
  let hitCursor = 'default';
  Object.defineProperty(win.document, 'elementFromPoint', { value: () => imageBlock, configurable: true });
  Object.defineProperty(win, 'getComputedStyle', { value: () => ({ cursor: hitCursor }), configurable: true });
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
  return { win, root, cursor, imageBlock, gaps, actions, guide, observerInstances, flush, advance, setHitCursor: (value: string) => { hitCursor = value; } };
}

async function advanceUntil(h: Harness, predicate: () => boolean, maxMs = 10000, onAdvance?: () => void) {
  for (let elapsed = 0; elapsed < maxMs && !predicate(); elapsed += 20) {
    await h.advance(20);
    onAdvance?.();
  }
  expect(predicate()).toBe(true);
}

async function reachLift(h: Harness) {
  h.guide.play();
  await h.flush();
  await advanceUntil(h, () => h.actions.includes('lift'));
}

async function reachDrop(h: Harness) {
  await reachLift(h);
  await advanceUntil(h, () => h.actions.includes('drop'));
  await advanceUntil(h, () => h.actions.includes('revert'));
  await advanceUntil(h, () => h.cursor.style.opacity === '0');
}

function trustedPointerMove(win: Window) {
  const event = new win.Event('pointermove', { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  win.document.dispatchEvent(event);
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

test('enters from the visible gutter and uses the softened pressed scale', async () => {
  const h = setup();
  const transforms: string[] = [];
  h.guide.play(); await h.flush();
  await h.advance(600);
  transforms.push(h.cursor.style.transform);
  expect(transforms[0]).toContain('translate(50px, 254px)');
  await advanceUntil(h, () => transforms.some((value) => value.endsWith('scale(0.95)')), 10000, () => transforms.push(h.cursor.style.transform));
  expect(transforms.some((value) => value.endsWith('scale(0.7)'))).toBe(false);
  h.guide.destroy();
});

test('maps hit-tested cursor styles and releases the held override when dropping', async () => {
  const h = setup();
  h.setHitCursor('pointer'); h.guide.play(); await h.flush(); await h.advance(600); await h.advance(20);
  expect(h.cursor.dataset.cursorState).toBe('pointer');
  h.setHitCursor('grab'); await h.advance(20);
  expect(h.cursor.dataset.cursorState).toBe('grab');
  await reachLift(h);
  await h.advance(20);
  expect(h.cursor.dataset.cursorState).toBe('grabbing');
  h.setHitCursor('pointer');
  await advanceUntil(h, () => h.actions.includes('drop'));
  await h.advance(20);
  expect(h.cursor.dataset.cursorState).toBe('pointer');
  h.guide.destroy();
});

test('cancelling during the initial wait or drag stops queued actions', async () => {
  const waiting = setup(); waiting.guide.play(); await waiting.flush(); await waiting.advance(300); waiting.guide.stop(); await waiting.advance(5000); expect(waiting.actions.filter((action) => action === 'reveal')).toEqual([]); waiting.guide.destroy();
  const moving = setup(); await reachLift(moving); const moves = moving.actions.filter((action) => action.startsWith('move:')).length; moving.guide.stop(); await moving.advance(5000); expect(moving.actions.filter((action) => action.startsWith('move:')).length).toBe(moves); expect(moving.actions).not.toContain('drop'); moving.guide.destroy();
});

test('long approaches slow into a bounded overshoot and land exactly before acting', async () => {
  const h = setup();
  const positions: Array<{ x: number; y: number }> = [];
  const readPosition = () => {
    const match = h.cursor.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    if (match) positions.push({ x: Number(match[1]), y: Number(match[2]) });
  };
  h.guide.play(); await h.flush();
  await advanceUntil(h, () => h.actions.includes('drop'), 10000, readPosition);
  const beforeRevert = positions.length;
  await advanceUntil(h, () => h.actions.includes('revert'), 10000, readPosition);
  const approach = positions.slice(beforeRevert);
  expect(approach.length).toBeGreaterThan(10);
  const steps = approach.slice(1).map((point, index) => point.x - approach[index].x);
  expect(Math.max(...steps.slice(0, 4))).toBeLessThan(Math.max(...steps));
  expect(Math.max(...approach.map(({ x }) => x))).toBeGreaterThan(702);
  const final = approach[approach.length - 1];
  expect(final.x).toBe(700);
  expect(final.y).toBe(670);
  h.guide.destroy();
});

test('observer auto-starts once, leaving cancels, and destroy keeps Astro markup', async () => {
  const h = setup(); const observer = h.observerInstances[0];
  observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver); for (let i = 0; i < 10; i += 1) await h.flush(); observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver); expect(h.actions.filter((action) => action === 'hide')).toHaveLength(0);
  observer.callback([{ isIntersecting: false } as IntersectionObserverEntry], observer as unknown as IntersectionObserver); h.guide.destroy(); expect(h.root.querySelector('[data-image]')).not.toBeNull(); expect(h.root.querySelector('[data-cursor]')).not.toBeNull();
});

test('reduced motion never changes gaps or order', async () => {
  const h = setup(true); h.guide.play(); await h.flush(); await h.advance(280); await h.advance(700); await h.advance(250); expect(h.actions.filter((action) => action === 'reveal' || action === 'lift' || action === 'drop')).toEqual([]); h.guide.destroy();
});

test('trusted input after completion does not hide a manually reopened gap', async () => {
  const h = setup();
  await reachDrop(h);
  const hides = h.actions.filter((action) => action === 'hide').length;
  h.gaps.reveal(h.imageBlock);
  trustedPointerMove(h.win);
  expect(h.actions.filter((action) => action === 'hide')).toHaveLength(hides);
  h.guide.destroy();
});

test('trusted input after cancellation does not clear a manually reopened gap', async () => {
  const h = setup();
  h.guide.play(); await h.flush(); await h.advance(300); h.guide.stop();
  const hides = h.actions.filter((action) => action === 'hide').length;
  h.gaps.reveal(h.imageBlock);
  trustedPointerMove(h.win);
  expect(h.actions.filter((action) => action === 'hide')).toHaveLength(hides);
  h.guide.destroy();
});
