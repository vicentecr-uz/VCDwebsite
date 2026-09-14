import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { bindProjectImageCarousels, restoreCarouselActiveItem } from '../../src/lib/projectImageCarousel';

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  CSS: window.CSS,
  requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
});

for (const axis of ['horizontal', 'vertical']) {
  test(`${axis}: editing a later slide preserves its dot and restores its scroll position`, () => {
    const document = window.document;
    document.documentElement.classList.add('is-dev-mode');
    const block = document.createElement('div');
    block.dataset.projectImageCarousel = '';
    block.dataset.carouselSettings = JSON.stringify({ orientation: axis });
    block.innerHTML = `<div data-carousel-track>${[0, 1, 2].map((i) =>
      `<div data-carousel-slide data-grid-item-id="item-${i}"></div>`).join('')}</div>
      <div data-carousel-dots><div data-carousel-dot-window><div data-carousel-dot-strip>${[0, 1, 2].map((i) =>
        `<button data-carousel-dot data-carousel-item-id="item-${i}"></button>`).join('')}</div></div></div>
      <div data-carousel-caption-slot>${[0, 1, 2].map((i) =>
        `<span data-carousel-caption data-carousel-item-id="item-${i}">Caption ${i}</span>`).join('')}</div>`;
    document.body.append(block);
    const track = block.querySelector<HTMLElement>('[data-carousel-track]')!;
    const slides = [...block.querySelectorAll<HTMLElement>('[data-carousel-slide]')];
    slides[2].dataset.mobileBleedEligible = 'true';
    slides[2].dataset.mobileInset = 'false';
    let isolated = false;
    slides.forEach((slide, index) => {
      Object.defineProperties(slide, {
        offsetLeft: { get: () => isolated ? 0 : index * 100 },
        offsetTop: { get: () => isolated ? 0 : index * 100 },
        offsetWidth: { get: () => isolated && index !== 2 ? 0 : 100 },
        offsetHeight: { get: () => isolated && index !== 2 ? 0 : 100 },
      });
      slide.getBoundingClientRect = () => ({ height: 100, width: 100 } as DOMRect);
    });
    track.scrollTo = (options: ScrollToOptions) => {
      track.scrollLeft = options.left ?? track.scrollLeft;
      track.scrollTop = options.top ?? track.scrollTop;
    };
    bindProjectImageCarousels(block);
    expect(restoreCarouselActiveItem(block, 'item-2')).toBe(true);
    const dots = [...block.querySelectorAll<HTMLElement>('[data-carousel-dot]')];
    const refresh = () => window.dispatchEvent(new window.CustomEvent('vcd:carousel-refresh', { detail: { block } }));
    const captions = [...block.querySelectorAll<HTMLElement>('[data-carousel-caption]')];
    expect(captions[2].dataset.mobileBleedEligible).toBe('true');
    expect(captions[0].dataset.mobileBleedEligible).toBe('false');
    slides[2].dataset.mobileInset = 'true';

    isolated = true;
    slides[2].classList.add('dev-crop-stage-host');
    refresh();
    expect(captions[2].dataset.mobileInset).toBe('true');
    track.dispatchEvent(new window.Event('scroll'));
    expect(dots[2].getAttribute('aria-current')).toBe('true');
    expect(dots[0].getAttribute('aria-current')).toBe('false');
    expect(block.dataset.activeIndex).toBe('2');

    isolated = false;
    slides[2].classList.remove('dev-crop-stage-host');
    refresh();
    expect(dots[2].getAttribute('aria-current')).toBe('true');
    expect(axis === 'vertical' ? track.scrollTop : track.scrollLeft).toBe(200);
    block.remove();
  });
}

function createSnapTestCarousel(axis: 'horizontal' | 'vertical') {
  const block = window.document.createElement('div');
  block.dataset.projectImageCarousel = '';
  block.dataset.carouselSettings = JSON.stringify({ orientation: axis });
  block.innerHTML = `<div data-carousel-track>${[0, 1, 2].map((i) =>
    `<div data-carousel-slide data-grid-item-id="item-${i}"></div>`).join('')}</div>`;
  window.document.body.append(block);
  const track = block.querySelector<HTMLElement>('[data-carousel-track]')!;
  const slides = [...block.querySelectorAll<HTMLElement>('[data-carousel-slide]')];
  slides.forEach((slide, index) => {
    Object.defineProperties(slide, {
      offsetLeft: { get: () => index * 100 },
      offsetTop: { get: () => index * 100 },
      offsetWidth: { get: () => 100 },
      offsetHeight: { get: () => 100 },
    });
  });
  const calls: ScrollToOptions[] = [];
  track.scrollTo = (options: ScrollToOptions) => {
    calls.push(options);
    track.scrollLeft = options.left ?? track.scrollLeft;
    track.scrollTop = options.top ?? track.scrollTop;
  };
  bindProjectImageCarousels(block);
  return { block, track, calls };
}

function dispatchPointerDown(track: HTMLElement): void {
  const event = new window.Event('pointerdown') as PointerEvent;
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'button', { value: 0 });
  track.dispatchEvent(event);
}

for (const axis of ['horizontal', 'vertical'] as const) {
  test(`${axis}: wheel scrollend does not correct an intermediate native offset`, () => {
    const { block, track, calls } = createSnapTestCarousel(axis);
    if (axis === 'vertical') track.scrollTop = 47;
    else track.scrollLeft = 47;
    track.dispatchEvent(new window.Event('wheel'));
    track.dispatchEvent(new window.Event('scrollend'));
    expect(calls).toHaveLength(0);
    block.remove();
  });

  test(`${axis}: repeated and reversed wheel swipes do not correct intermediate offsets`, () => {
    const { block, track, calls } = createSnapTestCarousel(axis);
    for (const [offset, delta] of [[47, 120], [147, 120], [53, -120]]) {
      if (axis === 'vertical') track.scrollTop = offset;
      else track.scrollLeft = offset;
      const wheel = new window.Event('wheel');
      Object.defineProperty(wheel, axis === 'vertical' ? 'deltaY' : 'deltaX', { value: delta });
      track.dispatchEvent(wheel);
      track.dispatchEvent(new window.Event('scrollend'));
    }
    expect(calls).toHaveLength(0);
    block.remove();
  });
}

test('touch snap ignores scrollend while active and corrects once after touchend', () => {
  const { block, track, calls } = createSnapTestCarousel('horizontal');
  track.dispatchEvent(new window.Event('touchstart'));
  track.scrollLeft = 47;
  track.dispatchEvent(new window.Event('scrollend'));
  expect(calls).toHaveLength(0);
  track.dispatchEvent(new window.Event('touchend'));
  track.dispatchEvent(new window.Event('scrollend'));
  expect(calls).toHaveLength(1);
  expect(calls[0].left).toBe(0);
  track.scrollLeft = 47;
  track.dispatchEvent(new window.Event('scrollend'));
  expect(calls).toHaveLength(1);
  block.remove();
});

test('wheel takeover after touch clears pending correction', () => {
  const { block, track, calls } = createSnapTestCarousel('horizontal');
  track.dispatchEvent(new window.Event('touchstart'));
  track.dispatchEvent(new window.Event('touchend'));
  track.scrollLeft = 47;
  track.dispatchEvent(new window.Event('wheel'));
  track.dispatchEvent(new window.Event('scrollend'));
  expect(calls).toHaveLength(0);
  block.remove();
});

test('mouse drag takeover after touch clears pending correction', () => {
  const { block, track, calls } = createSnapTestCarousel('horizontal');
  track.dispatchEvent(new window.Event('touchstart'));
  track.dispatchEvent(new window.Event('touchend'));
  track.scrollLeft = 47;
  dispatchPointerDown(track);
  track.dispatchEvent(new window.Event('scrollend'));
  expect(calls).toHaveLength(0);
  block.remove();
});
