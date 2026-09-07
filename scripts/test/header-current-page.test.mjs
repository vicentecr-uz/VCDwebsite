import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const start = source.indexOf('  const currentPageLinks = [');
const end = source.indexOf('  // DEV-only: Section Editor', start);
const controllerSource = source.slice(start, end).replace('</script>', '');

class FakeElement {
  constructor(kind, parent = null) {
    this.kind = kind;
    this.parent = parent;
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty: (key, value) => { this.style[key] = value; }, getPropertyValue: (key) => this.style[key] ?? '' };
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
      remove: (...values) => values.forEach((value) => this.classList.values.delete(value)),
      contains: (value) => this.classList.values.has(value),
      toggle: (value, enabled) => enabled ? this.classList.values.add(value) : this.classList.values.delete(value),
    };
    this.height = 24;
  }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  dispatch(type, event = {}) { for (const callback of this.listeners[type] ?? []) callback({ preventDefault() {}, ...event }); }
  closest(selector) {
    if (selector === '.header-menu__item') return this.kind === 'item' ? this : this.parent;
    if (selector === '.header-trigger') return this.kind === 'trigger' ? this : this.parent?.trigger;
    return null;
  }
  querySelector(selector) {
    if (selector === '.header-menu__link-label') return this.label;
    if (selector.includes('not([data-current-page])')) return this.fallback ?? this.trigger?.fallback ?? null;
    if (selector === '.header-trigger__panel-bg') return this.panelBg;
    return null;
  }
  querySelectorAll(selector) {
    if (selector.includes('.header-menu__link')) return [this.link, this.note].filter(Boolean);
    return [];
  }
  getAnimations() { return this.animations ?? []; }
  animate() { this.animateCalls = (this.animateCalls ?? 0) + 1; const animation = { cancel() {} }; (this.animations ??= []).push(animation); return animation; }
  getBoundingClientRect() { return { width: this.width ?? 100, height: this.height }; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  matches(selector) { return selector.includes('.is-menu-open') && this.classList.contains('is-menu-open'); }
  focus() { globalThis.document.activeElement = this; this.focused = true; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = null; this.focused = false; }
}
globalThis.HTMLElement = FakeElement;

function createHarness({ stored = false, storageThrows = false } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  const triggers = [new FakeElement('trigger'), new FakeElement('trigger')];
  triggers[0].dataset.menuOpen = 'true';
  const links = triggers.map((trigger) => {
    trigger.panelBg = new FakeElement('panel-bg', trigger);
    trigger.fallback = new FakeElement('fallback', trigger);
    const item = new FakeElement('item', trigger);
    item.trigger = trigger;
    const link = new FakeElement('link', item);
    link.label = new FakeElement('label', link);
    const note = new FakeElement('note', item);
    item.link = link;
    item.note = note;
    trigger.item = item;
    trigger.note = note;
    return link;
  });
  const notes = triggers.map((trigger) => trigger.note);
  const items = triggers.map((trigger) => trigger.item);
  const values = stored ? { 'vcd:header-current-page-message-complete': 'true' } : {};
  globalThis.document = {
    activeElement: null,
    querySelectorAll: (selector) => selector.includes('[data-current-page]') ? links : notes,
    querySelector: () => triggers[0].fallback,
    documentElement: { clientWidth: 1200 },
    fonts: { ready: Promise.resolve() },
    addEventListener: () => {},
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: () => storageThrows ? (() => { throw new Error('denied'); })() : values['vcd:header-current-page-message-complete'],
      setItem: (key, value) => { if (storageThrows) throw new Error('denied'); values[key] = value; },
    },
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, { callback, active: true }); return id; },
    clearTimeout: (id) => { if (timers.get(id)) timers.get(id).active = false; },
  };
  globalThis.CSSTransition = class {};
  globalThis.clearTimeout = window.clearTimeout;
  globalThis.syncMenuSurfaceInlineSize = () => {};
  const transformed = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `const syncMenuSurfaceInlineSize = globalThis.syncMenuSurfaceInlineSize;\n${controllerSource}\nglobalThis.controller = { messageForClick, removeCurrentPage };`,
  );
  // eslint-disable-next-line no-new-func
  new Function(transformed)(/* no args */);
  return { links, notes, items, triggers, timers, values };
}

function click(link, detail = 1) { link.dispatch('click', { detail }); }
function flush(harness) {
  const pending = [...harness.timers.entries()];
  pending.forEach(([id, timer]) => { harness.timers.delete(id); if (timer.active) timer.callback(); });
}

{
  const harness = createHarness();
  const { messageForClick } = globalThis.controller;
  assert.equal(messageForClick(2), null);
  assert.equal(messageForClick(3), 'You are on this page');
  assert.equal(messageForClick(6), 'You are on this page');
  assert.equal(messageForClick(9), 'You are on this page');
  assert.equal(messageForClick(10), 'chill out');
  assert.equal(messageForClick(19), 'are you dumb?');
  assert.equal(messageForClick(22), "ahh, i see, you're curious");
  assert.equal(messageForClick(28), 'go on, click it again, see what happens');
  click(harness.links[0]);
  click(harness.links[0]);
  click(harness.links[0]);
  flush(harness);
  const noteAnimations = harness.notes[0].animateCalls;
  assert.equal(harness.notes[0].style.fontWeight, '400');
  click(harness.links[0]);
  click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].style.fontWeight, '700');
  assert.equal(harness.notes[0].animateCalls, noteAnimations);
  assert.match(harness.notes[0].style.color, /color-mix/);
  click(harness.links[0]);
  click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].style.fontWeight, '900');
  assert.equal(harness.notes[0].animateCalls, noteAnimations);
  assert.equal(harness.notes[0].style.color, 'var(--sys-color-link-soft-hover)');
  click(harness.links[0]);
  click(harness.links[0]);
  click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].style.fontWeight, '400');
  assert.equal(harness.notes[0].textContent, 'chill out');
  assert.equal(harness.notes[0].style.color, '');
  for (let index = 0; index < 12; index += 1) click(harness.links[0]);
  flush(harness);
  assert.equal(harness.links[0].label.classList.contains('is-error-shaking'), false);
  assert.equal(harness.notes[0].textContent, "ahh, i see, you're curious");
  click(harness.links[0]);
  assert.equal(harness.links[0].label.classList.contains('is-error-shaking'), false);
}

{
  const harness = createHarness({ stored: true });
  click(harness.links[0]); flush(harness);
  click(harness.links[0]); flush(harness);
  click(harness.links[0]); flush(harness);
  assert.equal(harness.notes[0].textContent, 'You are on this page');
  click(harness.links[0]); flush(harness);
  assert.equal(harness.notes[0].textContent, 'You are on this page');
  click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].textContent, 'ah, you again');
  assert.equal(harness.links[0].label.classList.contains('is-error-shaking'), false);
  click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].textContent, 'welcome back');
  assert.equal(harness.links[0].label.classList.contains('is-error-shaking'), false);
  click(harness.links[0]);
  flush(harness);
  assert.ok(harness.items.every((item) => item.classList.contains('is-removed')));
  assert.equal(harness.items[0].style['--current-page-row-height'], '24px');
}

{
  const harness = createHarness({ storageThrows: true });
  for (let index = 0; index < 28; index += 1) click(harness.links[0]);
  harness.links[0].dispatch('pointerdown', { pointerType: 'mouse', button: 0 });
  assert.equal(harness.items[0].classList.contains('is-removing'), true);
  flush(harness);
  assert.equal(harness.items[0].classList.contains('is-removed'), true);
}

{
  const harness = createHarness({ stored: true });
  for (let index = 0; index < 6; index += 1) click(harness.links[0]);
  harness.links[0].dispatch('pointerdown', { pointerType: 'mouse', button: 0 });
  assert.equal(harness.items[0].classList.contains('is-removing'), true);
  flush(harness);
  assert.equal(harness.items[0].classList.contains('is-removed'), true);
}

{
  const harness = createHarness();
  click(harness.links[0]);
  click(harness.links[0]);
  click(harness.links[0]);
  click(harness.links[0]);
  harness.triggers[0].dispatch('header:trigger-close');
  harness.triggers[0].dispatch('header:trigger-open');
  flush(harness);
  assert.equal(harness.notes[0].classList.contains('is-visible'), true);
}

console.log('header-current-page: ok');
