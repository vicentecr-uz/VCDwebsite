import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const window = new Window();
const realCreateElement = window.document.createElement.bind(window.document);
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  getComputedStyle: (element: HTMLElement) => ({
    backgroundColor: element.dataset.background ?? 'transparent',
  }),
});

window.document.createElement = ((name: string) => {
  if (name !== 'canvas') return realCreateElement(name);
  let fillStyle = 'transparent';
  return {
    width: 1,
    height: 1,
    getContext: () => ({
      set fillStyle(value: string) { fillStyle = value; },
      fillRect() {},
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, fillStyle === 'transparent' ? 0 : 255]) }),
    }),
  } as unknown as HTMLCanvasElement;
}) as typeof window.document.createElement;

const { opaqueBackground } = await import('../../src/scripts/adaptiveMediaInk');

test('carousel media ink resolves through a transparent frame to the page background', () => {
  window.document.body.innerHTML = '<main data-background="rgb(246, 246, 246)"><div data-background="transparent"><div data-frame></div></div></main>';
  const frame = window.document.querySelector<HTMLElement>('[data-frame]')!;
  expect(opaqueBackground(frame)).toBe('rgb(246, 246, 246)');
});

test('carousel media ink keeps a custom opaque frame background', () => {
  window.document.body.innerHTML = '<main data-background="rgb(246, 246, 246)"><div data-background="rgb(24, 24, 24)"><div data-frame></div></div></main>';
  const frame = window.document.querySelector<HTMLElement>('[data-frame]')!;
  expect(opaqueBackground(frame)).toBe('rgb(24, 24, 24)');
});
