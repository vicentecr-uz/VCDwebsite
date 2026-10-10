import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createHeaderMenuDemo } from '../../src/lib/headerMenuDemo';

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness({ reveal = false, intro = false, mobile = false, reduced = false } = {}) {
  const win = new Window({ url: 'http://localhost:4323/' });
  const doc = win.document;
  const media = { matches: mobile, addEventListener() {}, removeEventListener() {} };
  const reduce = { matches: reduced, addEventListener() {}, removeEventListener() {} };
  win.matchMedia = ((query: string) => query.includes('40em') ? media : reduce) as typeof win.matchMedia;
  Object.defineProperty(win, 'innerWidth', { value: 1200, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  doc.body.innerHTML = `${reveal ? '<div data-vcd-initial-reveal="running"></div>' : ''}${intro ? '<div data-home-intro-surface></div>' : ''}<div class="header-trigger header-trigger--start"><div class="header-trigger__brand"></div><div class="header-trigger__panel"><div class="header-menu"></div></div></div>`;
  const trigger = doc.querySelector<HTMLElement>('.header-trigger')!;
  trigger.dataset.menuOpen = '';
  trigger.querySelector<HTMLElement>('.header-trigger__brand')!.getBoundingClientRect = () => ({ left: 100, top: 20, width: 100, height: 30, right: 200, bottom: 50 } as DOMRect);
  let expanded = false;
  trigger.querySelector<HTMLElement>('.header-trigger__panel')!.getBoundingClientRect = () => (expanded
    ? { left: 80, top: 10, width: 320, height: 590, right: 400, bottom: 600 }
    : { left: 80, top: 10, width: 240, height: 180, right: 320, bottom: 190 }) as DOMRect;
  const template = doc.createElement('template');
  template.innerHTML = '<div class="header-menu-demo-overlay"><span data-header-menu-demo-cursor></span><div class="hint-pointer" data-header-menu-demo-finger><span class="hint-finger"></span></div></div>';
  const opened: string[] = [];
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;
  Object.assign(globalThis, { window: win, document: doc, Node: win.Node });
  return { win, doc, trigger, template, opened, setExpanded: (value: boolean) => { expanded = value; }, restore() { Object.assign(globalThis, { window: originalWindow, document: originalDocument, Node: originalNode }); } };
}

test('cancelling during the reveal prevents the delayed demo', async () => {
  const h = harness({ reveal: true });
  let opens = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opens++; }, close() {}, isEditing: () => false });
  demo.start();
  h.win.dispatchEvent(new h.win.Event('click', { bubbles: true }));
  h.win.dispatchEvent(new h.win.Event('vcd:initial-reveal-complete'));
  await settle();
  expect(opens).toBe(0);
  expect(h.win.sessionStorage.getItem('vcd:header-menu-demo-seen')).toBeNull();
  h.restore();
});

test('intro dismissal starts the demo once and keeps its overlay hidden beforehand', async () => {
  const h = harness({ intro: true });
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  h.win.HTMLElement.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {} } as unknown as Animation; };
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let opens = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opens++; h.trigger.dataset.menuOpen = 'true'; }, close() {}, isEditing: () => false });
  demo.start();
  h.win.dispatchEvent(new h.win.Event('click', { bubbles: true }));
  expect(h.doc.querySelector('.header-menu-demo-overlay')).toBeNull();
  h.doc.querySelector<HTMLElement>('[data-home-intro-surface]')!.hidden = true;
  h.win.dispatchEvent(new h.win.Event('vcd:home-intro-dismissed'));
  await settle();
  expect(opens).toBe(1);
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  h.restore();
});

test('the seen marker prevents a second controller in the same session', async () => {
  const h = harness();
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  h.win.HTMLElement.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {} } as unknown as Animation; };
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let opens = 0;
  const options = { trigger: h.trigger, template: h.template, open: () => { opens++; h.trigger.dataset.menuOpen = 'true'; }, close() {}, isEditing: () => false };
  createHeaderMenuDemo(options).start();
  await settle();
  createHeaderMenuDemo(options).start();
  await settle();
  expect(opens).toBe(1);
  expect(h.win.sessionStorage.getItem('vcd:header-menu-demo-seen')).toBe('true');
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  h.restore();
});

test('desktop demo uses a composited travel and owns the real menu lifecycle', async () => {
  const h = harness();
  const keyframes: Keyframe[][] = [];
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  h.win.HTMLElement.prototype.animate = function (frames: Keyframe[]) {
    keyframes.push(frames);
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  };
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let opened = 0;
  let closed = 0;
  const demo = createHeaderMenuDemo({
    trigger: h.trigger,
    template: h.template,
    open: () => { opened++; h.trigger.dataset.menuOpen = 'true'; },
    close: () => { closed++; },
    isEditing: () => false,
  });
  demo.start();
  await settle();
  expect(opened).toBe(1);
  expect(closed).toBe(1);
  expect(keyframes.some((frames) => String(frames[0]?.transform).includes('translate'))).toBe(true);
  expect(keyframes.some((frames) => frames[0]?.opacity === 0 && frames[1]?.opacity === 1)).toBe(true);
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  h.restore();
});

test('mobile demo uses the finger path and closes only its opened menu', async () => {
  const h = harness({ mobile: true });
  const keyframes: Keyframe[][] = [];
  const options: KeyframeAnimationOptions[] = [];
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  const oldRandom = Math.random;
  Math.random = () => 0.75;
  h.win.HTMLElement.prototype.animate = function (frames: Keyframe[], animationOptions: KeyframeAnimationOptions) {
    keyframes.push(frames);
    options.push(animationOptions);
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  };
  const delays: number[] = [];
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => { delays.push(delay ?? 0); if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let opened = 0;
  let closed = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opened++; h.setExpanded(true); h.trigger.dataset.menuOpen = 'true'; }, close: () => { closed++; }, isEditing: () => false });
  demo.start();
  await settle();
  expect(keyframes.some((frames) => frames[0]?.transform === 'translate(648px, 432px)' && frames[1]?.transform === 'translate(150px, 35px)')).toBe(true);
  expect(opened).toBe(1);
  expect(closed).toBe(1);
  expect(keyframes.some((frames) => frames.some((frame) => String(frame.transform).includes('scale(.88)')))).toBe(true);
  expect(keyframes.some((frames) => frames.some((frame) => String(frame.transform).includes('translate(448px, 648px)')))).toBe(true);
  expect(delays).toContain(150);
  expect(options.filter((option) => option.easing === 'cubic-bezier(.645,.045,.355,1)')).toHaveLength(2);
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  Math.random = oldRandom;
  h.restore();
});

test('reduced motion indicates the target without travel or scale', async () => {
  const h = harness({ reduced: true });
  const keyframes: Keyframe[][] = [];
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  h.win.HTMLElement.prototype.animate = function (frames: Keyframe[]) {
    keyframes.push(frames);
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  };
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let opened = 0;
  let closed = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opened++; h.trigger.dataset.menuOpen = 'true'; }, close: () => { closed++; }, isEditing: () => false });
  demo.start();
  await settle();
  expect(opened).toBe(1);
  expect(closed).toBe(1);
  expect(keyframes.every((frames) => !frames.some((frame) => String(frame.transform).includes('scale')))).toBe(true);
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  h.restore();
});

test('cancelling while fonts are pending prevents a later run', async () => {
  const h = harness();
  let resolveFonts!: () => void;
  Object.defineProperty(h.doc, 'fonts', { value: { ready: new Promise<void>((resolve) => { resolveFonts = resolve; }) }, configurable: true });
  let opens = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opens++; }, close() {}, isEditing: () => false });
  demo.start();
  h.win.dispatchEvent(new h.win.Event('click', { bubbles: true }));
  resolveFonts();
  await settle();
  expect(opens).toBe(0);
  h.restore();
});

test('passive pointer, wheel, scroll, and key events do not cancel pending readiness', async () => {
  const h = harness();
  let resolveFonts!: () => void;
  Object.defineProperty(h.doc, 'fonts', { value: { ready: new Promise<void>((resolve) => { resolveFonts = resolve; }) }, configurable: true });
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  h.win.HTMLElement.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {} } as unknown as Animation; };
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let opens = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opens++; h.trigger.dataset.menuOpen = 'true'; }, close() {}, isEditing: () => false });
  demo.start();
  for (const type of ['pointermove', 'wheel', 'scroll', 'keydown']) h.win.dispatchEvent(new h.win.Event(type, { bubbles: true }));
  resolveFonts();
  await settle();
  expect(opens).toBe(1);
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  h.restore();
});

test('cancelling a rejected animation does not reopen the demo', async () => {
  const h = harness();
  const oldTimer = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let rejectAnimation!: (reason?: unknown) => void;
  let animationCalls = 0;
  h.win.HTMLElement.prototype.animate = function () {
    animationCalls++;
    if (animationCalls <= 2) return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
    return { finished: new Promise<void>((_resolve, reject) => { rejectAnimation = reject; }), cancel() {} } as unknown as Animation;
  };
  let opens = 0;
  let closes = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { opens++; h.trigger.dataset.menuOpen = 'true'; }, close: () => { closes++; }, isEditing: () => false });
  demo.start();
  await settle();
  h.win.dispatchEvent(new h.win.Event('click', { bubbles: true }));
  rejectAnimation(new Error('cancelled'));
  await settle();
  expect(opens).toBe(1);
  expect(closes).toBe(1);
  globalThis.setTimeout = oldTimer;
  h.restore();
});

test('a real click inside the trigger preserves the demo-owned menu', async () => {
  const h = harness();
  const oldAnimate = h.win.HTMLElement.prototype.animate;
  const oldTimer = globalThis.setTimeout;
  let animationCalls = 0;
  h.win.HTMLElement.prototype.animate = function () {
    animationCalls++;
    if (animationCalls <= 2) return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
    return { finished: new Promise<void>(() => {}), cancel() {} } as unknown as Animation;
  };
  globalThis.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') callback(); return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  let closes = 0;
  const demo = createHeaderMenuDemo({ trigger: h.trigger, template: h.template, open: () => { h.trigger.dataset.menuOpen = 'true'; }, close: () => { closes++; }, isEditing: () => false });
  demo.start();
  await settle();
  h.trigger.querySelector<HTMLElement>('.header-trigger__brand')!.dispatchEvent(new h.win.Event('click', { bubbles: true }));
  expect(closes).toBe(0);
  h.win.HTMLElement.prototype.animate = oldAnimate;
  globalThis.setTimeout = oldTimer;
  h.restore();
});
