import { test, expect, afterAll } from 'bun:test';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/' });
const bindings = {
  window: win, document: win.document, HTMLElement: win.HTMLElement,
  HTMLInputElement: win.HTMLInputElement, customElements: win.customElements,
  MutationObserver: win.MutationObserver, ResizeObserver: win.ResizeObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
};
const previous = Object.fromEntries(Object.keys(bindings).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, bindings);
afterAll(() => {
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const { mountSabiDemo } = await import('../../src/lib/sabi/demo');

test('comparison preserves the same editable input, text and selection', () => {
  const root = win.document.createElement('div');
  root.dataset.kind = 'caret';
  root.innerHTML = '<sabi-input><input value="A long editable value"></sabi-input><button data-choice="before"></button><button data-choice="after"></button>';
  win.document.body.append(root);
  const input = root.querySelector('input')!;
  const handle = mountSabiDemo(root as unknown as HTMLElement);
  input.value = 'The reader’s own words';
  input.setSelectionRange(4, 10);
  handle.choose('before');
  expect(root.querySelector('input')).toBe(input);
  expect(input.value).toBe('The reader’s own words');
  expect([input.selectionStart, input.selectionEnd]).toEqual([4, 10]);
  handle.choose('after');
  expect(root.querySelector('input')).toBe(input);
  expect(input.value).toBe('The reader’s own words');
  expect([input.selectionStart, input.selectionEnd]).toEqual([4, 10]);
  handle.begin();
  handle.stop();
  expect(root.querySelector<HTMLElement>('.sabi-auto-caret')!.hidden).toBe(true);
  handle.destroy();
  root.remove();
  expect(win.document.querySelector('.sabi-auto-caret')).toBeNull();
});

test('handle illustration switches accessible state without claiming native rendering', () => {
  const root = win.document.createElement('div');
  root.dataset.kind = 'handles';
  root.innerHTML = '<div class="handle-example"></div><button data-choice="original">Original</button><button data-choice="container">Container</button>';
  win.document.body.append(root);
  const handle = mountSabiDemo(root as unknown as HTMLElement);
  root.querySelector<HTMLButtonElement>('button[data-choice="original"]')!.click();
  expect(root.querySelector('.handle-example')!.getAttribute('aria-label')).toContain('illustration: Original');
  expect(root.querySelector('button[data-choice="original"]')!.getAttribute('aria-pressed')).toBe('true');
  handle.destroy(); root.remove();
});
