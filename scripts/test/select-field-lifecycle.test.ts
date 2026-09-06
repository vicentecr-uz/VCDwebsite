import assert from 'node:assert/strict';
import { initSelectFields } from '../../src/lib/selectField';

class TestElement extends EventTarget {
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  classes = new Set<string>();
  isConnected = true;
  textContent = '';
  innerHTML = '';
  disabled = false;
  classList = {
    contains: (name: string) => this.classes.has(name),
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
  };
  wrapper: TestElement = this;
  children = new Map<string, TestElement>();
  items: TestElement[] = [];
  closest() { return this.wrapper; }
  querySelector(selector: string) { return this.children.get(selector) ?? null; }
  querySelectorAll() { return this.items; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  matches() { return false; }
}

class TestSelect extends TestElement {
  options = [{ value: 'left', textContent: 'Left' }, { value: 'center', textContent: 'Centre' }, { value: 'right', textContent: 'Right' }];
  form = new EventTarget();
  nativeIndex = 1;
  get value() { return this.options[this.nativeIndex]?.value ?? ''; }
  set value(value: string) { this.nativeIndex = this.options.findIndex((option) => option.value === value); }
  get selectedIndex() { return this.nativeIndex; }
  set selectedIndex(value: number) { this.nativeIndex = value; }
}

const observers: TestObserver[] = [];
class TestObserver {
  disconnected = false;
  constructor(public callback: (records: unknown[]) => void) { observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
}

const fixture = () => {
  const wrapper = new TestElement();
  const select = new TestSelect();
  const trigger = new TestElement();
  const listbox = new TestElement();
  const label = new TestElement();
  trigger.children.set('[data-dev-select-label]', label);
  trigger.children.set('[data-dev-select-icon]', new TestElement());
  wrapper.children.set('select.dev-select__native', select);
  wrapper.children.set('button.dev-select__trigger', trigger);
  wrapper.children.set('ul.dev-select__listbox', listbox);
  select.wrapper = trigger.wrapper = listbox.wrapper = wrapper;
  listbox.items = select.options.map((option) => {
    const row = new TestElement();
    const text = new TestElement();
    text.textContent = option.textContent;
    row.dataset.value = option.value;
    row.children.set('.dev-select__option-label', text);
    return row;
  });
  return { wrapper, select, trigger, listbox, label };
};

const a = fixture();
const b = fixture();
const document = Object.assign(new EventTarget(), {
  documentElement: new TestElement(),
  querySelectorAll: () => [a.select, b.select],
});
const overrides = {
  document,
  window: Object.assign(new EventTarget(), { clearTimeout, setTimeout }),
  MutationObserver: TestObserver,
  HTMLSelectElement: TestSelect,
  HTMLElement: TestElement,
  Element: TestElement,
};
const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });

try {
  const dispose = initSelectFields();
  assert.equal(a.label.textContent, 'Centre');
  a.select.value = 'right';
  assert.equal(a.label.textContent, 'Right');
  assert.equal(b.label.textContent, 'Centre');
  b.select.selectedIndex = 0;
  assert.equal(b.label.textContent, 'Left');

  a.select.nativeIndex = 1; // Native form reset bypasses the JS property setter.
  const reset = new Event('reset');
  Object.defineProperty(reset, 'target', { value: a.select.form });
  document.dispatchEvent(reset);
  await Promise.resolve();
  assert.equal(a.label.textContent, 'Centre');
  assert.equal(b.label.textContent, 'Left', 'reset is confined to its form');

  a.wrapper.isConnected = false;
  observers.at(-1)!.callback([{ addedNodes: [] }]);
  assert.equal(Object.hasOwn(a.select, 'value'), false, 'removal restores native descriptors');
  assert.equal(observers[0].disconnected, true);
  assert.equal(Object.hasOwn(b.select, 'value'), true);

  b.select.nativeIndex = 1;
  const pending = new Event('reset');
  Object.defineProperty(pending, 'target', { value: b.select.form });
  document.dispatchEvent(pending);
  dispose();
  await Promise.resolve();
  assert.equal(b.label.textContent, 'Left', 'queued reset cannot mutate a disposed control');
  assert.equal(Object.hasOwn(b.select, 'value'), false);
  assert.equal(Object.hasOwn(b.select, 'selectedIndex'), false);
  assert.ok(observers.every((observer) => observer.disconnected));

  b.wrapper.isConnected = true;
  const remount = initSelectFields();
  b.select.value = 'right';
  assert.equal(b.label.textContent, 'Right', 'the same fixture can remount');
  remount();
  console.log('select-field-lifecycle: passed (native sync, scoped reset, removal, queued reset, remount)');
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
