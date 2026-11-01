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


test('scripted selection preserves the filled input until deletion, without taking focus', () => {
  const root = win.document.createElement('div');
  root.dataset.kind = 'playground';
  root.innerHTML = '<sabi-input><input value="Already filled in"></sabi-input>';
  win.document.body.append(root);
  const input = root.querySelector('input')!;
  const handle = mountSabiDemo(root as unknown as HTMLElement);
  const focus = win.document.activeElement;
  handle.begin();
  handle.selectAll();
  expect(input.value).toBe('Already filled in');
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  expect(input.hasAttribute('data-demo-selected')).toBe(true);
  expect(root.querySelector<HTMLElement>('.sabi-auto-caret')!.hidden).toBe(true);
  expect(win.document.activeElement).toBe(focus);
  handle.text('');
  expect(input.value).toBe('');
  expect(input.hasAttribute('data-demo-selected')).toBe(false);
  handle.text('A');
  expect(input.value).toBe('A');
  expect(root.querySelector<HTMLElement>('.sabi-auto-caret')!.hidden).toBe(false);
  handle.selectAll();
  handle.stop();
  expect(input.hasAttribute('data-demo-selected')).toBe(false);
  handle.destroy(); root.remove();
});


test.each([0.7, 1, 1.4])('the click and caret share a character boundary at scale %s', (scale) => {
  const root = win.document.createElement('div');
  root.dataset.kind = 'playground';
  root.innerHTML = '<div class="sabi-demo-field"><sabi-input><input value="Already filled in"></sabi-input></div>';
  win.document.body.append(root);
  const input = root.querySelector('input')!;
  const field = root.querySelector<HTMLElement>('.sabi-demo-field')!;
  Object.defineProperty(field, 'offsetWidth', { value: 200 });
  field.getBoundingClientRect = () => ({ left: 100, width: 200 * scale }) as DOMRect;
  input.getBoundingClientRect = () => ({ left: 100 + 8 * scale }) as DOMRect;
  const handle = mountSabiDemo(root as unknown as HTMLElement);
  const probe = [...win.document.querySelectorAll('span')].find((span) => span.style.visibility === 'hidden')!;
  probe.getBoundingClientRect = () => ({ width: (probe.textContent?.length ?? 0) * 10 }) as DOMRect;
  const target = handle.caretTarget(.65);
  expect(target.offset).toBe(12);
  expect(target.x).toBeCloseTo(.64);
  handle.begin(target.offset);
  expect(input.value).toBe('Already filled in');
  expect([input.selectionStart, input.selectionEnd]).toEqual([12, 12]);
  expect(input.hasAttribute('data-demo-selected')).toBe(false);
  expect(root.querySelector<HTMLElement>('.sabi-auto-caret')!.style.left).toBe('128px');
  handle.selectAll();
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  handle.destroy(); root.remove();
});
