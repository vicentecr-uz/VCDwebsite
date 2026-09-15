import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { scheduleGlyphReveal, shuffleGlyphs, splitGraphemes, startFontRevealPrototype } from '../../src/scripts/fontRevealPrototype';

const originalGlobals = Object.fromEntries(['window', 'document', 'location', 'NodeFilter', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'innerWidth', 'innerHeight', 'performance'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

const restoreGlobals = () => Object.entries(originalGlobals).forEach(([key, descriptor]) => {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else Reflect.deleteProperty(globalThis, key);
});

const setupDom = (fontLoad: (shorthand: string) => Promise<unknown[]>, frame: 'complete' | 'hold' = 'complete') => {
  const dom = new Window({ url: 'http://localhost/?font-reveal=trickle' });
  const wrapper = dom.document.createElement('main');
  wrapper.id = 'site-wrapper';
  const text = dom.document.createElement('p');
  text.style.fontFamily = 'Hanken Grotesk, system-ui, sans-serif';
  text.style.fontWeight = '400';
  text.getBoundingClientRect = () => ({ top: 0, left: 0, right: 800, bottom: 24, width: 800, height: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  const first = dom.document.createTextNode('a'.repeat(1300));
  const second = dom.document.createTextNode('hello');
  text.append(first, second);
  wrapper.append(text);
  dom.document.body.append(wrapper);
  const overlay = dom.document.createElement('div');
  overlay.id = 'transition-overlay';
  overlay.dataset.vcdInitialReveal = 'complete';
  dom.document.body.append(overlay);
  dom.document.documentElement.dataset.fontRevealPrototype = 'pending';
  Object.defineProperty(dom.document, 'fonts', { configurable: true, value: { load: fontLoad } });
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    NodeFilter: dom.NodeFilter,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    matchMedia: () => ({ matches: false }),
    innerWidth: 1000,
    innerHeight: 800,
    performance: { now: () => 0 },
  });
  Object.assign(globalThis, frame === 'complete'
    ? { requestAnimationFrame: (callback: FrameRequestCallback) => { callback(5000); return 1; }, cancelAnimationFrame: () => {} }
    : { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  return { dom, wrapper, text, first, second };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('splits emoji and combining marks into graphemes', () => {
  expect(splitGraphemes('A👩‍🚀é')).toEqual(['A', '👩‍🚀', 'é']);
});

test('schedules a bounded late-accelerating reveal', () => {
  const schedule = scheduleGlyphReveal(4, 4000);
  expect(schedule).toHaveLength(4);
  expect(schedule[0]).toBe(0);
  expect(schedule[3]).toBeLessThan(4000);
  expect(schedule[1] - schedule[0]).toBeGreaterThan(schedule[3] - schedule[2]);
});

test('shuffles without changing the glyph set', () => {
  expect(shuffleGlyphs(['a', 'b', 'c', 'd'], () => 0)).toEqual(['b', 'c', 'd', 'a']);
});

test('preserves complete text nodes beyond the glyph ceiling and restores wrapped nodes on success', async () => {
  const fixture = setupDom(async () => [{}]);
  try {
    const originalFirst = fixture.first;
    const originalSecond = fixture.second;
    startFontRevealPrototype();
    await settle();
    expect(fixture.text.textContent).toBe(`${'a'.repeat(1300)}hello`);
    expect(fixture.text.childNodes[0]).toBe(originalFirst);
    expect(fixture.text.childNodes[1]).toBe(originalSecond);
    expect(fixture.dom.document.documentElement.dataset.fontRevealPrototype).toBeUndefined();
  } finally {
    restoreGlobals();
  }
});

test('restores original text and removes state on abort during the animation', async () => {
  const fixture = setupDom(async () => [{}], 'hold');
  try {
    const original = fixture.first;
    const prototype = startFontRevealPrototype()!;
    await settle();
    expect(fixture.text.querySelectorAll('span')).toHaveLength(5);
    prototype.abort();
    expect(fixture.text.childNodes[1]).toBe(fixture.second);
    expect(fixture.text.textContent).toBe(`${'a'.repeat(1300)}hello`);
    expect(fixture.text.childNodes[0]).toBe(original);
    expect(fixture.dom.document.documentElement.dataset.fontRevealPrototype).toBeUndefined();
  } finally {
    restoreGlobals();
  }
});

test('fails open without leaving fallback state when a font rejects', async () => {
  const fixture = setupDom(async () => { throw new Error('font failure'); });
  try {
    startFontRevealPrototype();
    await settle();
    expect(fixture.text.textContent).toBe(`${'a'.repeat(1300)}hello`);
    expect(fixture.dom.document.documentElement.dataset.fontRevealPrototype).toBeUndefined();
  } finally {
    restoreGlobals();
  }
});

test('stalled fonts can be aborted without leaving listeners or fallback state', async () => {
  const fixture = setupDom(() => new Promise(() => {}));
  try {
    const prototype = startFontRevealPrototype()!;
    prototype.abort();
    await settle();
    expect(fixture.text.textContent).toBe(`${'a'.repeat(1300)}hello`);
    expect(fixture.dom.document.documentElement.dataset.fontRevealPrototype).toBeUndefined();
  } finally {
    restoreGlobals();
  }
});

 test('reduced motion leaves original text nodes and no temporary glyphs', async () => {
  const fixture = setupDom(async () => [{}], 'hold');
  try {
    Object.assign(globalThis, { matchMedia: () => ({ matches: true }) });
    startFontRevealPrototype();
    await settle();
    expect(fixture.text.childNodes[1]).toBe(fixture.second);
    expect(fixture.text.querySelectorAll('span')).toHaveLength(0);
    expect(fixture.dom.document.documentElement.dataset.fontRevealPrototype).toBeUndefined();
  } finally { restoreGlobals(); }
});
