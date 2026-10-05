import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const root = resolve(import.meta.dir, '../..');
const source = readFileSync(resolve(root, 'src/scripts/headerTitleTransition.js'), 'utf8');

function fixture() {
  const win = new Window({ url: 'https://vcd.test/project' });
  const doc = win.document;
  const animateCalls: Array<{ element: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: any }> = [];
  const chars = (text: string, animation = '') => [...text].map((char) => `<span class="header-trigger__char" style="animation:${animation}">${char}</span>`).join('');
  doc.body.innerHTML = `<div class="header-trigger__wordmark-stack"><h1 class="header-trigger__wordmark header-trigger__wordmark--page" aria-hidden="false">${chars('Project', 'page-in 1s')}</h1><span class="header-trigger__wordmark header-trigger__wordmark--home" aria-hidden="true">${chars('Home', 'home-in 1s')}</span></div>`;
  const stack = doc.querySelector<HTMLElement>('.header-trigger__wordmark-stack')!;
  const page = doc.querySelector<HTMLElement>('.header-trigger__wordmark--page')!;
  const home = doc.querySelector<HTMLElement>('.header-trigger__wordmark--home')!;
  const rects = new WeakMap<Element, { left: number; top: number; width: number; height: number }>();
  rects.set(stack, { left: 100, top: 20, width: 160, height: 24 });
  rects.set(page, { left: 100, top: 20, width: 112, height: 24 });
  rects.set(home, { left: 100, top: 20, width: 64, height: 24 });
  [...page.querySelectorAll<HTMLElement>('.header-trigger__char')].forEach((char, index) => rects.set(char, { left: 100 + index * 16, top: 20, width: 16, height: 24 }));
  [...home.querySelectorAll<HTMLElement>('.header-trigger__char')].forEach((char, index) => rects.set(char, { left: 100 + index * 16, top: 20, width: 16, height: 24 }));
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    return rects.get(this) ?? { left: 0, top: 0, width: this.textContent?.length ? this.textContent.length * 16 : 64, height: 24 };
  };
  win.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 64, height: 24 });
  win.HTMLElement.prototype.animate = function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let finish!: () => void;
    let cancel!: (reason: Error) => void;
    const finished = new Promise<void>((resolve, reject) => { finish = resolve; cancel = reject; });
    const animation = { id: '', startTime: null, finished, finish, cancel() { this.cancelled = true; cancel(new Error('canceled')); }, cancelled: false } as any;
    animateCalls.push({ element: this, keyframes, options, animation });
    return animation;
  };
  Object.defineProperty(doc, 'timeline', { configurable: true, value: { currentTime: 5000 } });
  const computed = (element: HTMLElement) => ({ font: '400 16px sans-serif', fontSize: '16px', lineHeight: '24px', letterSpacing: '0px', fontKerning: 'auto', fontFeatureSettings: 'normal', opacity: element?.style.opacity || '1', filter: element?.style.filter || 'none' });
  const run = new Function('window', 'document', 'getComputedStyle', source);
  run(win, doc, computed);
  return { win, doc, stack, page, home, animateCalls };
}

test('title transition preserves shared zero-delay effects and descender bounds', () => {
  const f = fixture();
  const sourceChar = f.page.querySelector<HTMLElement>('.header-trigger__char')!;
  const sourceAnimation = sourceChar.style.animation;
  const pending = { title: 'Project', targetTitle: 'Play' };
  const bridge = (f.win as any).__vcdHeaderTitleTransition(pending);
  expect(bridge).toBeTruthy();
  const pageLayer = [...f.stack.querySelectorAll<HTMLElement>('.header-navigation-title-layer')].at(-1)!;
  const pageMasks = pageLayer.querySelectorAll('.header-navigation-title-mask');
  expect(pageMasks.length).toBe(4);
  expect(pageLayer.style.left).toBe('0em');
  expect(pageLayer.style.top).toBe('0em');
  const incomingChar = pageLayer.querySelector<HTMLElement>('.header-navigation-title-char')!;
  expect(incomingChar.style.animation).toBe('none');
  expect(incomingChar.style.opacity).toBe('0');
  expect(incomingChar.style.filter).toBe('blur(4px)');
  expect(incomingChar.style.transition).toBe('none');
  expect(incomingChar.style.paddingBlock).toBe('var(--wordmark-trim, 0.1515em)');
  expect(incomingChar.style.marginBlock).toBe('calc(-1 * var(--wordmark-trim, 0.1515em))');
  expect([...pageMasks].every((mask) => mask.style.opacity === '1')).toBe(true);
  expect([...pageMasks].every((mask) => mask.style.getPropertyValue('--char-blur') === '0px')).toBe(true);
  expect([...pageMasks].every((mask) => mask.style.getPropertyValue('--char-filter') === 'none')).toBe(true);
  expect(sourceChar.parentElement).toBe(f.page);
  expect(sourceChar.style.animation).toBe(sourceAnimation);
  expect(pending.fromGeometry.offsets).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(f.animateCalls.length).toBe(11);
  const incomingCall = f.animateCalls.find(({ animation }) => animation.id === 'vcd-header-title-in-0')!;
  expect(incomingCall.options).toEqual({ duration: 250, delay: 0, easing: 'linear', fill: 'both' });
  expect(incomingCall.keyframes[0]).toEqual({ opacity: '0', filter: 'blur(4px)', offset: 0, easing: 'ease' });
  expect(incomingCall.keyframes[1]).toEqual({ opacity: '1', filter: 'none', offset: 1 });
  expect(incomingCall.animation.id).toBe('vcd-header-title-in-0');
  const delayedIncoming = f.animateCalls.find(({ animation }) => animation.id === 'vcd-header-title-in-1')!;
  expect(delayedIncoming.options).toEqual({ duration: 290, delay: 0, easing: 'linear', fill: 'both' });
  expect(delayedIncoming.keyframes).toHaveLength(3);
  expect(delayedIncoming.keyframes[0]).toEqual({ opacity: '0', filter: 'blur(4px)', offset: 0 });
  expect(delayedIncoming.keyframes[1]).toEqual({ opacity: '0', filter: 'blur(4px)', offset: 40 / 290, easing: 'ease' });
  expect(delayedIncoming.keyframes[2]).toEqual({ opacity: '1', filter: 'none', offset: 1 });
  expect(incomingCall.animation.startTime).toBeLessThanOrEqual(5000);
  expect(f.animateCalls.every(({ animation }) => animation.startTime === incomingCall.animation.startTime)).toBe(true);

  const visibility = f.stack.style.visibility;
  bridge.cleanup();
  expect(f.animateCalls.every(({ animation }) => animation.cancelled)).toBe(true);
  expect(f.stack.querySelector('.header-navigation-title')).toBeNull();
  expect(f.stack.style.visibility).toBe(visibility === 'hidden' ? '' : visibility);
});

test('title completion waits for the last native letter effect', async () => {
  const f = fixture();
  const bridge = (f.win as any).__vcdHeaderTitleTransition({ title: 'Project', targetTitle: 'Play' });
  let complete = false;
  void bridge.finished.then((finished: boolean) => { complete = finished; });
  for (const { animation } of f.animateCalls.slice(0, -1)) animation.finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).toBe(false);
  f.animateCalls.at(-1)!.animation.finish();
  expect(await bridge.finished).toBe(true);
  bridge.cleanup();
});

test('canceled title completion cannot authorize a queued hover', async () => {
  const f = fixture();
  const bridge = (f.win as any).__vcdHeaderTitleTransition({ title: 'Project', targetTitle: 'Play' });
  bridge.cleanup();
  expect(await bridge.finished).toBe(false);
  expect(f.stack.querySelector('.header-navigation-title')).toBeNull();
});

test('negative measured delay resumes against the same timeline anchor', () => {
  const f = fixture();
  f.home.setAttribute('aria-hidden', 'false');
  f.page.setAttribute('aria-hidden', 'true');
  f.home.querySelector<HTMLElement>('.header-trigger__char')!.style.opacity = '0.5';
  [...f.page.querySelectorAll<HTMLElement>('.header-trigger__char')].forEach((char) => {
    char.getAnimations = () => [{
      transitionProperty: 'opacity',
      currentTime: 200,
      effect: { getTiming: () => ({ duration: 150, delay: 100 }) },
    }] as any;
  });
  const bridge = (f.win as any).__vcdHeaderTitleTransition({ title: 'Home', targetTitle: 'Home' });
  expect(bridge).toBeTruthy();
  const outgoing = f.animateCalls.find(({ animation }) => animation.id === 'vcd-header-title-out-0')!;
  const incoming = f.animateCalls.find(({ animation }) => animation.id === 'vcd-header-title-in-0')!;
  expect(outgoing.options).toEqual({ duration: 150, delay: 0, easing: 'linear', fill: 'both' });
  expect(outgoing.keyframes).toHaveLength(2);
  expect(outgoing.keyframes[0]).toMatchObject({ opacity: '1', filter: 'none', easing: 'ease' });
  expect(outgoing.animation.startTime).toBe(incoming.animation.startTime - 100);
  bridge.cleanup();
});

test('settled title stays untouched while partially faded Home still transitions', () => {
  const fixed = fixture();
  const fixedBridge = (fixed.win as any).__vcdHeaderTitleTransition({ title: 'Project', targetTitle: 'Project' });
  expect(fixedBridge).toBeNull();
  expect(fixed.animateCalls).toHaveLength(0);

  const settled = fixture();
  [...settled.page.querySelectorAll<HTMLElement>('.header-trigger__char')].forEach((char) => {
    char.getAnimations = () => [{
      transitionProperty: 'opacity',
      currentTime: 150,
      effect: { getTiming: () => ({ duration: 0, delay: 0 }) },
    }] as any;
  });
  settled.home.setAttribute('aria-hidden', 'false');
  settled.page.setAttribute('aria-hidden', 'true');
  settled.home.querySelector<HTMLElement>('.header-trigger__char')!.style.opacity = '0.5';
  const settledBridge = (settled.win as any).__vcdHeaderTitleTransition({ title: 'Home', targetTitle: 'Home' });
  expect(settledBridge).toBeTruthy();
  expect(settled.animateCalls.filter(({ animation }) => animation.id.startsWith('vcd-header-title-out-'))).toHaveLength(0);
  settledBridge.cleanup();
});
