import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const root = resolve(import.meta.dir, '../..');
const source = readFileSync(resolve(root, 'src/scripts/headerTitleTransition.js'), 'utf8');

function fixture() {
  const win = new Window({ url: 'https://vcd.test/project' });
  const doc = win.document;
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
  const computed = () => ({ font: '400 16px sans-serif', fontSize: '16px', lineHeight: '24px', letterSpacing: '0px', fontKerning: 'auto', fontFeatureSettings: 'normal', opacity: '1' });
  const run = new Function('window', 'document', 'getComputedStyle', source);
  run(win, doc, computed);
  return { win, doc, stack, page, home };
}

test('title transition preserves source animation and creates reusable page and Home masks', () => {
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
  const incomingAnimation = incomingChar.style.animation;
  expect(incomingAnimation).toContain('vcd-header-title-in');
  expect(incomingAnimation).toContain('250ms ease');
  expect(pageMasks[0].style.opacity).toBe('1');
  expect(pageMasks[0].style.getPropertyValue('--char-blur')).toBe('0px');
  expect(sourceChar.parentElement).toBe(f.page);
  expect(sourceChar.style.animation).toBe(sourceAnimation);
  expect(pending.fromGeometry.offsets).toEqual([0, 1, 2, 3, 4, 5, 6]);

  const first = bridge.wordmarkChars(f.home);
  const second = bridge.wordmarkChars(f.home);
  expect(incomingChar.style.animation).toBe(incomingAnimation);
  expect(second).toBe(first);
  expect(first.page).not.toBe(first.home);
  expect(first.page.length).toBe(4);
  expect(first.home.length).toBe(4);
  expect(first.home.every((mask: HTMLElement) => mask.style.opacity === '0')).toBe(true);
  expect(first.home.every((mask: HTMLElement) => mask.style.getPropertyValue('--char-blur') === '4px')).toBe(true);
  expect(f.stack.querySelectorAll('.header-navigation-title-layer').length).toBe(3);
  const visibility = f.stack.style.visibility;
  bridge.cleanup();
  expect(f.stack.querySelector('.header-navigation-title')).toBeNull();
  expect(f.stack.style.visibility).toBe(visibility === 'hidden' ? '' : visibility);
});

test('same-title transition keeps fixed inner letters visible without animation', () => {
  const f = fixture();
  const bridge = (f.win as any).__vcdHeaderTitleTransition({ title: 'Project', targetTitle: 'Project' });
  const layer = f.stack.querySelector<HTMLElement>('.header-navigation-title-layer')!;
  const char = layer.querySelector<HTMLElement>('.header-navigation-title-char')!;
  const mask = layer.querySelector<HTMLElement>('.header-navigation-title-mask')!;
  expect(char.style.animation).toBe('none');
  expect(char.style.opacity).toBe('1');
  expect(mask.style.opacity).toBe('1');
  expect(mask.style.getPropertyValue('--char-blur')).toBe('0px');
  bridge.cleanup();
});
