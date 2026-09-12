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
        `<button data-carousel-dot data-carousel-item-id="item-${i}"></button>`).join('')}</div></div></div>`;
    document.body.append(block);
    const track = block.querySelector<HTMLElement>('[data-carousel-track]')!;
    const slides = [...block.querySelectorAll<HTMLElement>('[data-carousel-slide]')];
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

    isolated = true;
    slides[2].classList.add('dev-crop-stage-host');
    refresh();
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
