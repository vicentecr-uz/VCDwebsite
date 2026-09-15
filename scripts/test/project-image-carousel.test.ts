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
  cancelAnimationFrame: () => {},
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
  let capturedPointerId: number | null = null;
  track.hasPointerCapture = (pointerId: number) => capturedPointerId === pointerId;
  track.setPointerCapture = (pointerId: number) => { capturedPointerId = pointerId; };
  track.releasePointerCapture = (pointerId: number) => {
    if (capturedPointerId === pointerId) capturedPointerId = null;
  };
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
  Object.defineProperty(event, 'pointerId', { value: 1 });
  track.dispatchEvent(event);
}

function dispatchMousePointer(track: HTMLElement, type: string, pointerId = 1, clientX = 0, clientY = 0, timeStamp?: number) {
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerType: { value: 'mouse' },
    button: { value: 0 },
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  track.dispatchEvent(event);
  return event;
}

function withQueuedAnimationFrames(run: (queue: Array<FrameRequestCallback>, base: number) => void): void {
  const original = globalThis.requestAnimationFrame;
  const queue: Array<FrameRequestCallback> = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  }) as typeof requestAnimationFrame;
  try {
    run(queue, performance.now() + 1);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
}

function flushAnimationFrames(queue: Array<FrameRequestCallback>, base: number): void {
  for (let frame = 1; frame <= 100 && queue.length; frame += 1) {
    queue.shift()!(base + frame * 16);
  }
}

test('mouse image drag cancels native image dragging for an accepted pointerdown', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  const image = window.document.createElement('img');
  track.querySelector('[data-carousel-slide]')!.append(image);

  dispatchMousePointer(track, 'pointerdown', 11, 100);
  const beforeMove = new window.Event('dragstart', { bubbles: true, cancelable: true });
  image.dispatchEvent(beforeMove);
  expect(beforeMove.defaultPrevented).toBe(true);

  dispatchMousePointer(track, 'pointermove', 11, 94);
  const afterMove = new window.Event('dragstart', { bubbles: true, cancelable: true });
  image.dispatchEvent(afterMove);
  expect(afterMove.defaultPrevented).toBe(true);
  dispatchMousePointer(track, 'pointerup', 11, 94);
  block.remove();
});

test('accepted pointerdown cancels immediate and cross-axis native image drags', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  const image = window.document.createElement('img');
  track.querySelector('[data-carousel-slide]')!.append(image);

  dispatchMousePointer(track, 'pointerdown', 15, 100, 100);
  const immediate = new window.Event('dragstart', { bubbles: true, cancelable: true });
  image.dispatchEvent(immediate);
  expect(immediate.defaultPrevented).toBe(true);

  dispatchMousePointer(track, 'pointermove', 15, 100, 94);
  const crossAxis = new window.Event('dragstart', { bubbles: true, cancelable: true });
  image.dispatchEvent(crossAxis);
  expect(crossAxis.defaultPrevented).toBe(true);
  dispatchMousePointer(track, 'pointerup', 15, 100, 94);
  block.remove();
});

test('ordinary image click remains available while a dragged image click is suppressed', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  const image = window.document.createElement('img');
  track.querySelector('[data-carousel-slide]')!.append(image);
  let clicks = 0;
  image.addEventListener('click', () => { clicks += 1; });

  dispatchMousePointer(track, 'pointerdown', 12, 100);
  dispatchMousePointer(track, 'pointerup', 12, 100);
  const ordinaryClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  image.dispatchEvent(ordinaryClick);
  expect(ordinaryClick.defaultPrevented).toBe(false);
  expect(clicks).toBe(1);

  dispatchMousePointer(track, 'pointerdown', 13, 100);
  dispatchMousePointer(track, 'pointermove', 13, 94);
  dispatchMousePointer(track, 'pointerup', 13, 94);
  const draggedClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  image.dispatchEvent(draggedClick);
  expect(draggedClick.defaultPrevented).toBe(true);
  expect(clicks).toBe(1);
  block.remove();
});

test('cancelled mouse drag clears carousel drag state and snap override', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  dispatchMousePointer(track, 'pointerdown', 14, 100);
  dispatchMousePointer(track, 'pointermove', 14, 94);
  expect(track.classList.contains('is-dragging')).toBe(true);
  expect(track.style.scrollSnapType).toBe('none');
  dispatchMousePointer(track, 'pointercancel', 14, 94);
  expect(track.classList.contains('is-dragging')).toBe(false);
  expect(track.style.scrollSnapType).toBe('');
  block.remove();
});

test('mouse release carries velocity toward the next real slide before settling', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  withQueuedAnimationFrames((queue, base) => {
    dispatchMousePointer(track, 'pointerdown', 16, 100, 0, 1);
    dispatchMousePointer(track, 'pointermove', 16, 0, 0, 101);
    dispatchMousePointer(track, 'pointerup', 16, 0, 0, 111);
    expect(track.style.scrollSnapType).toBe('none');
    flushAnimationFrames(queue, base);
    expect(track.scrollLeft).toBe(200);
    expect(track.style.scrollSnapType).toBe('');
  });
  block.remove();
});

test('settling clamps projected and chosen offsets to the actual scroll bound', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  Object.defineProperties(track, {
    scrollWidth: { configurable: true, value: 250 },
    clientWidth: { configurable: true, value: 100 },
  });
  withQueuedAnimationFrames((queue, base) => {
    dispatchMousePointer(track, 'pointerdown', 31, 100, 0, 1);
    dispatchMousePointer(track, 'pointermove', 31, -100, 0, 101);
    dispatchMousePointer(track, 'pointerup', 31, -100, 0, 111);
    flushAnimationFrames(queue, base);
    expect(track.scrollLeft).toBeLessThanOrEqual(150);
    expect(track.scrollLeft).toBeGreaterThanOrEqual(0);
  });
  block.remove();
});

test('reduced motion settles synchronously without scheduling animation frames', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = (() => ({ matches: true })) as typeof window.matchMedia;
  try {
    withQueuedAnimationFrames((queue) => {
      dispatchMousePointer(track, 'pointerdown', 32, 100, 0, 1);
      dispatchMousePointer(track, 'pointermove', 32, 0, 0, 101);
      dispatchMousePointer(track, 'pointerup', 32, 0, 0, 111);
      expect(queue).toHaveLength(0);
      expect(track.style.scrollSnapType).toBe('');
    });
  } finally {
    window.matchMedia = previousMatchMedia;
  }
  block.remove();
});

test('stale mouse release velocity does not carry momentum', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  withQueuedAnimationFrames((queue, base) => {
    dispatchMousePointer(track, 'pointerdown', 17, 100, 0, 1);
    dispatchMousePointer(track, 'pointermove', 17, 0, 0, 101);
    dispatchMousePointer(track, 'pointerup', 17, 0, 0, 401);
    flushAnimationFrames(queue, base);
    expect(track.scrollLeft).toBe(100);
  });
  block.remove();
});

test('mouse release clamps momentum to the carousel edge and wheel interrupts it', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  withQueuedAnimationFrames((queue) => {
    track.scrollLeft = 200;
    dispatchMousePointer(track, 'pointerdown', 18, 100, 0, 1);
    dispatchMousePointer(track, 'pointermove', 18, -100, 0, 101);
    dispatchMousePointer(track, 'pointerup', 18, -100, 0, 111);
    expect(track.style.scrollSnapType).toBe('none');
    track.dispatchEvent(new window.Event('wheel'));
    expect(track.style.scrollSnapType).toBe('');
    queue.length = 0;
  });
  expect(track.scrollLeft).toBeGreaterThanOrEqual(200);
  block.remove();
});

test('vertical mouse release carries velocity along the vertical axis', () => {
  const { block, track } = createSnapTestCarousel('vertical');
  withQueuedAnimationFrames((queue, base) => {
    dispatchMousePointer(track, 'pointerdown', 19, 0, 100, 1);
    dispatchMousePointer(track, 'pointermove', 19, 0, 0, 101);
    dispatchMousePointer(track, 'pointerup', 19, 0, 0, 111);
    flushAnimationFrames(queue, base);
    expect(track.scrollTop).toBe(200);
    expect(track.style.scrollSnapType).toBe('');
  });
  block.remove();
});

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

for (const axis of ['horizontal', 'vertical'] as const) {
  for (const custom of [false, true]) {
    test(`${axis}: ${custom ? 'custom' : 'native'} video controls keep pointer and arrow-key ownership`, () => {
      const { block, track, calls } = createSnapTestCarousel(axis);
      const video = window.document.createElement('video');
      const controller = window.document.createElement('media-controller');
      const volume = window.document.createElement('media-volume-range');
      controller.append(video, volume);
      track.querySelector('[data-carousel-slide]')!.append(custom ? controller : video);
      const input = window.document.createElement('input');
      input.type = 'range';
      volume.attachShadow({ mode: 'open' }).append(input);
      const control = custom ? input : video;
      const pointer = new window.Event('pointerdown', { bubbles: true, composed: true });
      Object.defineProperties(pointer, { pointerType: { value: 'mouse' }, button: { value: 0 } });
      control.dispatchEvent(pointer);
      expect(track.classList.contains('is-dragging')).toBe(false);
      const arrow = new window.KeyboardEvent('keydown', {
        key: axis === 'vertical' ? 'ArrowUp' : 'ArrowRight',
        bubbles: true, composed: true, cancelable: true,
      });
      control.dispatchEvent(arrow);
      expect(arrow.defaultPrevented).toBe(false);
      expect(calls).toHaveLength(0);
      block.remove();
    });
  }
}

test('video dot placement follows image–video–image swipe progress and reversal', () => {
  const { block, track } = createSnapTestCarousel('horizontal');
  const video = window.document.createElement('video');
  block.querySelectorAll('[data-carousel-slide]')[1].append(video);
  for (const [offset, expected] of [[0, 0], [25, 0.25], [50, 0.5], [100, 1], [150, 0.5], [200, 0], [150, 0.5], [100, 1], [50, 0.5]]) {
    track.scrollLeft = offset;
    track.dispatchEvent(new window.Event('scroll'));
    expect(Number(block.style.getPropertyValue('--project-carousel-video-progress'))).toBe(expected);
  }
  video.replaceWith(window.document.createElement('img'));
  window.dispatchEvent(new window.CustomEvent('vcd:carousel-refresh', { detail: { block } }));
  expect(Number(block.style.getPropertyValue('--project-carousel-video-progress'))).toBe(0);
  block.remove();
});
