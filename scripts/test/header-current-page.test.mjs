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

function createHarness({
  stored = false,
  storageThrows = false,
  analytics = true,
  analyticsDomains = 'example.test',
  pathname = '/work',
  hostname = 'example.test',
  analyticsThrows = false,
  analyticsRejects = false,
  analyticsTracker = true,
  analyticsDisabled = false,
  analyticsPending = false,
} = {}) {
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
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
  if (analyticsDisabled) values['umami.disabled'] = '1';
  const analyticsEvents = [];
  const analyticsScript = analytics ? { dataset: { websiteId: 'test', domains: analyticsDomains } } : null;
  const documentListeners = {};
  globalThis.document = {
    hidden: false,
    activeElement: null,
    querySelectorAll: (selector) => selector.includes('[data-current-page]') ? links : notes,
    querySelector: (selector) => selector === 'script[data-website-id]' ? analyticsScript : triggers[0].fallback,
    documentElement: { clientWidth: 1200 },
    fonts: { ready: Promise.resolve() },
    addEventListener: (type, callback) => { (documentListeners[type] ??= []).push(callback); },
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: (key) => storageThrows ? (() => { throw new Error('denied'); })() : values[key] ?? null,
      setItem: (key, value) => { if (storageThrows) throw new Error('denied'); values[key] = value; },
    },
    setTimeout: (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, active: true, due: now + delay }); return id; },
    clearTimeout: (id) => { if (timers.get(id)) timers.get(id).active = false; },
  };
  globalThis.location = { hostname, pathname };
  globalThis.window.umami = analyticsTracker ? {
    track: (...args) => {
      if (analyticsThrows) throw new Error('analytics unavailable');
      analyticsEvents.push(args);
      if (analyticsRejects) return Promise.reject(new Error('analytics rejected'));
      if (analyticsPending) return new Promise(() => {});
      return undefined;
    },
  } : undefined;
  globalThis.CSSTransition = class {};
  globalThis.clearTimeout = window.clearTimeout;
  globalThis.syncMenuSurfaceInlineSize = () => {};
  const transformed = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `const syncMenuSurfaceInlineSize = globalThis.syncMenuSurfaceInlineSize;\n${controllerSource}\nglobalThis.controller = { messageForClick, removeCurrentPage };`,
  );
  const executeController = () => {
    // eslint-disable-next-line no-new-func
    new Function(transformed)(/* no args */);
  };
  // eslint-disable-next-line no-new-func
  executeController();
  const advance = (milliseconds) => {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.active && timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.due;
      timer.callback();
    }
    now = target;
  };
  return { links, notes, items, triggers, timers, values, advance, documentListeners, analyticsEvents, executeController };
}

function click(link, detail = 1) { link.dispatch('click', { detail }); }
function flush(harness) {
  harness.advance(100);
}

{
  const h = createHarness();
  h.triggers[0].dispatch('header:trigger-open');
  click(h.links[0]);
  click(h.links[0]);
  click(h.links[0]);
  flush(h);
  assert.deepEqual(h.analyticsEvents, [
    ['header-story-main-exposed', { sequence: 'main', stage: 'exposed' }],
    ['header-story-main-started', { sequence: 'main', stage: 'started' }],
    ['header-story-main-notice', { sequence: 'main', stage: 'notice' }],
  ]);
  click(h.links[0]);
  flush(h);
  assert.equal(h.analyticsEvents.length, 3);
}

{
  const h = createHarness();
  for (let index = 0; index < 21; index += 1) click(h.links[0]);
  flush(h);
  const holdEvents = h.analyticsEvents.filter(([name]) => name === 'header-story-main-hold');
  assert.equal(holdEvents.length, 1);
  click(h.links[0]); flush(h);
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-main-curious');
}

{
  const h = createHarness();
  for (let index = 0; index < 28; index += 1) click(h.links[0]);
  h.links[0].dispatch('pointerdown', { pointerType: 'mouse', button: 0 });
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-main-completed');
}

{
  const h = createHarness({ stored: true });
  for (let index = 0; index < 6; index += 1) { click(h.links[0]); flush(h); }
  assert.deepEqual(h.analyticsEvents.map(([name]) => name), [
    'header-story-returning-exposed',
    'header-story-returning-started',
    'header-story-returning-notice',
    'header-story-returning-again',
    'header-story-returning-welcome',
  ]);
  click(h.links[0]); flush(h);
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-returning-completed');
}

for (const options of [
  { analytics: false },
  { analyticsDomains: 'other.test' },
  { pathname: '/analytics' },
  { pathname: '/analytics/' },
  { pathname: '/dev/editor' },
  { analyticsDisabled: true },
  { analyticsTracker: false },
]) {
  const h = createHarness(options);
  click(h.links[0]); click(h.links[0]); click(h.links[0]); flush(h);
  assert.equal(h.analyticsEvents.length, 0);
}

for (const options of [{ analyticsThrows: true }, { analyticsRejects: true }]) {
  const h = createHarness(options);
  click(h.links[0]); click(h.links[0]); click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, 'You are on this page');
}

{
  const h = createHarness({ analyticsPending: true });
  click(h.links[0]); click(h.links[0]); click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, 'You are on this page');
  assert.equal(h.analyticsEvents.length, 3);
}

{
  const h = createHarness();
  click(h.links[0]); click(h.links[0]); click(h.links[0]);
  h.triggers[0].dispatch('header:trigger-close');
  h.triggers[0].dispatch('header:trigger-open');
  flush(h);
  assert.equal(h.analyticsEvents.filter(([name]) => name.endsWith('-notice')).length, 1);
}

{
  const h = createHarness();
  for (let index = 0; index < 24; index += 1) click(h.links[0]);
  flush(h);
  h.advance(3200);
  flush(h);
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-main-idle-good-boy');
  click(h.links[0]);
  flush(h);
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-main-idle-hey');
  h.advance(800);
  flush(h);
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-main-not-playing');
}

{
  const h = createHarness();
  for (let index = 0; index < 9; index += 1) { click(h.links[0]); flush(h); }
  click(h.links[0]);
  h.triggers[0].dispatch('header:trigger-close');
  h.advance(100);
  assert.equal(h.analyticsEvents.some(([name]) => name === 'header-story-main-chill'), false);
  h.triggers[0].dispatch('header:trigger-open');
  click(h.links[0]);
  flush(h);
  assert.equal(h.analyticsEvents.filter(([name]) => name === 'header-story-main-chill').length, 1);
}

{
  const h = createHarness();
  for (let index = 0; index < 28; index += 1) { click(h.links[0]); flush(h); }
  const stages = h.analyticsEvents.map(([name]) => name);
  for (const stage of [
    'exposed', 'started', 'notice', 'notice-emphasis', 'notice-strong', 'chill', 'read', 'hold',
    'curious', 'how-long', 'stop', 'not-playing', 'seriously', 'warning', 'last-chance',
  ]) assert.equal(stages.includes(`header-story-main-${stage}`), true, stage);
}

{
  const h = createHarness();
  h.triggers[0].dispatch('header:trigger-open');
  h.executeController();
  h.triggers[0].dispatch('header:trigger-open');
  assert.equal(h.analyticsEvents.filter(([name]) => name === 'header-story-main-exposed').length, 1);
}

{
  const h = createHarness();
  click(h.links[0]); click(h.links[0]);
  document.hidden = true;
  h.documentListeners.visibilitychange.forEach((callback) => callback());
  click(h.links[0]);
  flush(h);
  assert.equal(h.analyticsEvents.length, 2);
  document.hidden = false;
}

{
  const h = createHarness({ stored: true });
  for (let index = 0; index < 6; index += 1) click(h.links[0]);
  click(h.links[0], 0);
  assert.equal(h.analyticsEvents.at(-1)[0], 'header-story-returning-completed');
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

{
  const harness = createHarness();
  for (let index = 0; index < 24; index += 1) click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].textContent, 'well just stop');
  harness.advance(3099);
  assert.equal(harness.notes[0].textContent, 'well just stop');
  harness.advance(1);
  harness.advance(100);
  assert.equal(harness.notes[0].textContent, "who's a good boy?");
  click(harness.links[0]);
  flush(harness);
  assert.equal(harness.notes[0].textContent, 'HEY');
  harness.advance(800);
  harness.advance(100);
  assert.equal(harness.notes[0].textContent, "i'm not playing");
}

{
  const h = createHarness();
  for (let i = 0; i < 12; i++) click(h.links[0]);
  flush(h);
  for (let i = 0; i < 9; i++) { click(h.links[0]); flush(h); assert.equal(h.notes[0].textContent, 'are you dumb?'); }
  click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, "ahh, i see, you're curious");
}

{
  const h = createHarness();
  for (let i = 0; i < 24; i++) click(h.links[0]);
  h.advance(3200);
  assert.equal(h.notes[0].textContent, "who's a good boy?");
  h.advance(2999);
  assert.equal(h.notes[0].classList.contains('is-visible'), true);
  h.advance(101);
  assert.equal(h.notes[0].classList.contains('is-visible'), false);
  click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, "i'm not playing");
}

{
  const h = createHarness();
  for (let i = 0; i < 24; i++) click(h.links[0]);
  h.advance(3200);
  click(h.links[0]); flush(h);
  click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, "i'm not playing");
  click(h.links[0]); flush(h);
  h.advance(1000);
  assert.equal(h.notes[0].textContent, 'seriously');
}

{
  const h = createHarness();
  for (let i = 0; i < 24; i++) click(h.links[0]);
  flush(h);
  delete h.triggers[0].dataset.menuOpen;
  h.triggers[0].dispatch('header:trigger-close');
  h.advance(10000);
  h.triggers[0].dataset.menuOpen = 'true';
  h.triggers[0].dispatch('header:trigger-open');
  assert.equal(h.notes[0].textContent, 'You are on this page');
  assert.equal(h.notes[0].style.fontWeight, '400');
  click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, 'well just stop');
  h.advance(3100);
  assert.equal(h.notes[0].textContent, "who's a good boy?");
}

{
  const h = createHarness();
  for (let i = 0; i < 28; i++) click(h.links[0]);
  flush(h);
  h.triggers[0].dispatch('header:trigger-close');
  h.triggers[0].dispatch('header:trigger-open');
  h.links[0].dispatch('pointerdown', { pointerType: 'mouse', button: 0 });
  assert.equal(h.items[0].classList.contains('is-removing'), false);
  click(h.links[0]); flush(h);
  assert.equal(h.notes[0].textContent, 'go on, click it again, see what happens');
  h.links[0].dispatch('pointerdown', { pointerType: 'mouse', button: 0 });
  assert.equal(h.items[0].classList.contains('is-removing'), true);
}

{
  const h = createHarness();
  for (let i = 0; i < 24; i++) click(h.links[0]);
  flush(h);
  document.hidden = true;
  h.documentListeners.visibilitychange.forEach((callback) => callback());
  h.advance(10000);
  assert.equal(h.notes[0].classList.contains('is-visible'), false);
  assert.notEqual(h.notes[0].textContent, "who's a good boy?");
}

console.log('header-current-page: ok');
