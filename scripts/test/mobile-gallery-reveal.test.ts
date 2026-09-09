import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { bindMobileGalleryReveal } from '../../src/scripts/mobileGalleryReveal';

const window = new Window({ url: 'https://vcd.test/' });
const document = window.document;
let nextTimer = 0;
let clock = 0;
const timers = new Map<number, { at: number; callback: () => void }>();
const media = { matches: true, addEventListener() {}, removeEventListener() {} };

const globalKeys = ['window', 'document', 'MutationObserver', 'Element', 'HTMLElement', 'DOMRect', 'setTimeout', 'clearTimeout'] as const;
const originals = Object.fromEntries(globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;
const originalDateNow = Date.now;
Object.assign(globalThis, {
  window,
  document,
  MutationObserver: window.MutationObserver,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  DOMRect: window.DOMRect,
  setTimeout: (callback: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { at: clock + delay, callback }); return id; },
  clearTimeout: (id: number) => timers.delete(id),
});
Date.now = () => clock;
window.matchMedia = (() => media) as typeof window.matchMedia;
window.innerWidth = 400;
window.innerHeight = 800;

const advance = (duration: number) => {
  const target = clock + duration;
  while (true) {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > target) break;
    clock = next[1].at;
    timers.delete(next[0]);
    next[1].callback();
  }
  clock = target;
};

function addCard(top: number, left: number, hasHover = true) {
  const item = document.createElement('li');
  item.className = 'project-grid__item';
  const card = document.createElement('a');
  card.className = 'project-grid__card';
  const cover = document.createElement('div');
  cover.className = `project-grid__cover${hasHover ? ' project-grid__cover--has-hover' : ''}`;
  const hover = document.createElement('img');
  hover.className = 'project-grid__img--hover';
  Object.defineProperties(hover, {
    complete: { value: hasHover, configurable: true },
    naturalWidth: { value: hasHover ? 400 : 0, configurable: true },
  });
  hover.src = hasHover ? '/hover.webp' : '';
  if (!hasHover) hover.hidden = true;
  cover.append(hover);
  card.append(cover);
  item.append(card);
  Object.defineProperty(card, 'getBoundingClientRect', {
    value: () => ({ top, bottom: top + 200, left, right: left + 180, width: 180, height: 200 }),
  });
  document.body.append(item);
  return { item, card, cover };
}

function touch(type: string, target: Element, touches: Array<Record<string, unknown>>, changedTouches = touches) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
  });
  Object.defineProperty(touches[0] ?? changedTouches[0], 'target', { value: target, configurable: true });
  document.dispatchEvent(event);
  return event;
}

try {
  const first = addCard(20, 10);
  const second = addCard(300, 10);
  const teardown = bindMobileGalleryReveal();
  const point = { identifier: 1, clientX: 15, clientY: 100, target: first.card };
  touch('touchstart', first.card, [point]);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'preview starts on touchstart before any timer or movement');
  advance(1000);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'finger-down reveals without waiting for movement or release');
  point.clientY = 130;
  touch('touchmove', first.card, [point]);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'vertical gesture reveals before release');
  advance(2000);
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'preview stays visible while finger is down and scrolling');
  touch('touchend', first.card, [], [point]);
  const dragClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  first.card.dispatchEvent(dragClick);
  assert.equal(dragClick.defaultPrevented, true, 'drag release cannot navigate the revealed card');
  advance(249);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'preview stays visible through release');
  window.dispatchEvent(new window.Event('scroll'));
  advance(249);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'momentum scroll preserves preview and resets the hold clock');
  advance(1);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'touch origin wins after a drag');
  touch('touchstart', first.card, [point]);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'touching an active preview does not flash back to the cover');
  point.clientY += 30;
  touch('touchmove', first.card, [point]);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'continuing a gesture preserves the same preview');
  touch('touchend', first.card, [], [point]);
  advance(250);
  advance(1599);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'preview remains during its hold');
  advance(1);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), false, 'preview clears after one hold');
  assert.equal(second.cover.classList.contains('is-mobile-preview'), false, 'only one cover is active');

  touch('touchstart', first.card, [point]);
  touch('touchend', first.card, [], [point]);
  advance(250);
  advance(500);
  const other = { identifier: 9, clientX: 20, clientY: 350, target: second.card };
  touch('touchstart', second.card, [other]);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), true, 'previous preview keeps its own countdown');
  assert.equal(second.cover.classList.contains('is-mobile-preview'), true, 'another preview can start simultaneously');
  advance(1100);
  assert.equal(first.cover.classList.contains('is-mobile-preview'), false, 'previous preview expires independently');
  assert.equal(second.cover.classList.contains('is-mobile-preview'), true, 'held preview stays visible after previous one expires');
  touch('touchend', second.card, [], [other]);

  teardown();
  document.body.innerHTML = '';
  media.matches = true;
  const top = addCard(900, 10);
  const visible = addCard(40, 200);
  const fallbackTeardown = bindMobileGalleryReveal();
  const drag = { identifier: 2, clientX: 220, clientY: 100, target: document.body };
  touch('touchstart', document.body, [drag]);
  drag.clientY = 130;
  touch('touchmove', document.body, [drag]);
  assert.equal(visible.cover.classList.contains('is-mobile-preview'), true, 'whitespace gesture reveals before release without actual scrolling');
  touch('touchend', document.body, [], [drag]);
  advance(250);
  assert.equal(visible.cover.classList.contains('is-mobile-preview'), true, 'whitespace drag falls back to visible ranking');
  assert.equal(top.cover.classList.contains('is-mobile-preview'), false, 'offscreen cards are skipped');
  drag.clientY = 100;
  touch('touchstart', document.body, [drag]);
  drag.clientY = 140;
  touch('touchmove', document.body, [drag]);
  touch('touchcancel', document.body, [], [drag]);
  assert.equal(visible.cover.classList.contains('is-mobile-preview'), false, 'cancelled gesture clears early preview');
  advance(2000);
  assert.equal(visible.cover.classList.contains('is-mobile-preview'), false, 'cancelled gesture does not restart preview');
  fallbackTeardown();

  document.body.innerHTML = '';
  media.matches = true;
  const scrollFallback = addCard(30, 10);
  const scrollTeardown = bindMobileGalleryReveal();
  window.dispatchEvent(new window.Event('scroll'));
  advance(250);
  assert.equal(scrollFallback.cover.classList.contains('is-mobile-preview'), false, 'untracked scroll does not reveal an unrelated card');
  scrollTeardown();

  document.body.innerHTML = '';
  const noHover = addCard(30, 10, false);
  const noHoverTeardown = bindMobileGalleryReveal();
  window.dispatchEvent(new window.Event('scroll'));
  advance(250);
  assert.equal(noHover.cover.classList.contains('is-mobile-preview'), false, 'cards without a complete hover image stay untouched');
  noHoverTeardown();

  document.body.innerHTML = '';
  const tap = addCard(20, 10);
  const tapTeardown = bindMobileGalleryReveal();
  const tapPoint = { identifier: 3, clientX: 20, clientY: 100, target: tap.card };
  touch('touchstart', tap.card, [tapPoint]);
  const tapEnd = touch('touchend', tap.card, [], [tapPoint]);
  assert.equal(tapEnd.defaultPrevented, false, 'stationary tap is never prevented');
  assert.equal(tap.cover.classList.contains('is-mobile-preview'), true, 'stationary touch reveals while preserving navigation');
  tapTeardown();

  document.body.innerHTML = '';
  media.matches = false;
  const fine = addCard(20, 10);
  const fineTeardown = bindMobileGalleryReveal();
  const finePoint = { identifier: 4, clientX: 20, clientY: 100, target: fine.card };
  touch('touchstart', fine.card, [finePoint]);
  finePoint.clientY = 130;
  touch('touchmove', fine.card, [finePoint]);
  touch('touchend', fine.card, [], [finePoint]);
  advance(250);
  assert.equal(fine.cover.classList.contains('is-mobile-preview'), false, 'fine pointers never activate mobile reveal');
  fineTeardown();
  document.body.innerHTML = '';
  media.matches = true;
  const initial = addCard(20, 10);
  const overlay = document.createElement('div');
  overlay.id = 'transition-overlay';
  overlay.dataset.vcdInitialReveal = 'running';
  document.body.append(overlay);
  const initialTeardown = bindMobileGalleryReveal();
  advance(2000);
  assert.equal(initial.cover.classList.contains('is-mobile-preview'), false, 'waits for page reveal');
  overlay.dataset.vcdInitialReveal = 'complete';
  window.dispatchEvent(new window.Event('vcd:initial-reveal-complete'));
  advance(999);
  assert.equal(initial.cover.classList.contains('is-mobile-preview'), false);
  advance(1);
  assert.equal(initial.cover.classList.contains('is-mobile-preview'), false, 'page reveal never starts an automatic preview');
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(initial.cover.classList.contains('is-mobile-preview'), false, 'navigation clears active preview');
  initialTeardown();

  const cancelledTeardown = bindMobileGalleryReveal();
  const still = { identifier: 7, clientX: 20, clientY: 100, target: initial.card };
  touch('touchstart', initial.card, [still]);
  touch('touchend', initial.card, [], [still]);
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  initial.card.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false, 'normal card click remains navigation');
  advance(2000);
  assert.equal(initial.cover.classList.contains('is-mobile-preview'), false, 'tap cancels initial preview permanently');
  window.dispatchEvent(new window.Event('scroll'));
  cancelledTeardown();
  advance(2000);
  assert.equal(initial.cover.classList.contains('is-mobile-preview'), false, 'teardown cancels pending scroll preview');
  assert.equal(timers.size, 0, 'teardown leaves no pending timers');
  document.body.innerHTML = '';
  const underVeil = addCard(20, 10);
  const intro = document.createElement('div');
  intro.setAttribute('data-home-intro-surface', '');
  intro.dataset.state = 'active';
  document.body.append(intro);
  underVeil.item.setAttribute('inert', '');
  const veilTeardown = bindMobileGalleryReveal();
  advance(2000);
  assert.equal(underVeil.cover.classList.contains('is-mobile-preview'), false, 'initial reveal waits behind intro veil');
  const veilTouch = { identifier: 8, clientX: 20, clientY: 100, target: intro };
  touch('touchstart', intro, [veilTouch]);
  touch('touchend', intro, [], [veilTouch]);
  intro.hidden = true;
  intro.dataset.state = 'dismissed';
  window.dispatchEvent(new window.Event('scroll'));
  advance(250);
  assert.equal(underVeil.cover.classList.contains('is-mobile-preview'), false, 'inert projects cannot preview');
  underVeil.item.removeAttribute('inert');
  window.dispatchEvent(new window.Event('vcd:home-intro-dismissed'));
  advance(999);
  assert.equal(underVeil.cover.classList.contains('is-mobile-preview'), false);
  advance(1);
  assert.equal(underVeil.cover.classList.contains('is-mobile-preview'), false, 'intro dismissal never starts an automatic preview');
  veilTeardown();
  console.log('mobile-gallery-reveal: passed (selection, gesture, timing, navigation, teardown)');
} finally {
  timers.clear();
  Date.now = originalDateNow;
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  window.innerWidth = originalInnerWidth;
  window.innerHeight = originalInnerHeight;
}
