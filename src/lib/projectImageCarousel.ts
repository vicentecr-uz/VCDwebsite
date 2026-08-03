/**
 * Image carousel behaviour: active-slide tracking, the 5-slot dot window, and
 * height easing. Scrolling itself is native (`overflow` + `scroll-snap`) so a
 * trackpad swipe only moves the carousel while the pointer is over it, and the
 * page keeps its own scroll on the cross axis.
 */

type Axis = 'horizontal' | 'vertical';

interface Carousel {
  block: HTMLElement;
  track: HTMLElement;
  slides: HTMLElement[];
  dotStrip: HTMLElement | null;
  dotWindow: HTMLElement | null;
  dots: HTMLElement[];
  captions: HTMLElement[];
  axis: Axis;
  heightMode: string;
  active: number;
}

const scrollPos = (carousel: Carousel) => (
  carousel.axis === 'vertical' ? carousel.track.scrollTop : carousel.track.scrollLeft
);

const slideOffset = (carousel: Carousel, slide: HTMLElement) => (
  carousel.axis === 'vertical' ? slide.offsetTop : slide.offsetLeft
);

/** Nearest slide to the current scroll offset — works with or without gaps. */
function activeIndexFor(carousel: Carousel): number {
  const position = scrollPos(carousel);
  let best = 0;
  let bestDistance = Infinity;
  carousel.slides.forEach((slide, index) => {
    const distance = Math.abs(slideOffset(carousel, slide) - position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * Five slots at most: three full-size dots centred on the active one, plus a
 * shrunken preview dot at each end while there are more images that way.
 */
function renderDots(carousel: Carousel): void {
  const { dots, dotStrip, dotWindow } = carousel;
  const count = dots.length;
  if (!count || !dotStrip || !dotWindow) return;

  const centre = Math.min(Math.max(carousel.active, 1), Math.max(count - 2, 1));
  const first = Math.max(0, centre - 2);
  const last = Math.min(count - 1, centre + 2);

  dots.forEach((dot, index) => {
    let state = 'out';
    if (index === carousel.active) state = 'active';
    else if (index >= centre - 1 && index <= centre + 1) state = 'near';
    else if (index === first || index === last) state = 'edge';
    dot.dataset.dotState = state;
    dot.setAttribute('aria-current', index === carousel.active ? 'true' : 'false');
  });

  dotWindow.style.setProperty('--project-carousel-dot-count', String(last - first + 1));
  dotStrip.style.setProperty('--project-carousel-dot-offset', String(first));
}

function renderCaptions(carousel: Carousel): void {
  carousel.captions.forEach((caption, index) => {
    caption.classList.toggle('is-active', index === carousel.active);
  });
}

/** Ease the block to the active slide's height (or pin it to the tallest). */
function applyHeight(carousel: Carousel): void {
  const { block, track, heightMode, axis } = carousel;
  if (heightMode === 'tallest' && axis === 'horizontal') {
    block.style.removeProperty('--project-carousel-track-size');
    return;
  }

  const measure = (slide: HTMLElement) => {
    const frame = slide.querySelector<HTMLElement>('[data-carousel-frame]') ?? slide;
    return frame.getBoundingClientRect().height;
  };

  const size = heightMode === 'dynamic'
    ? measure(carousel.slides[carousel.active] ?? carousel.slides[0])
    : Math.max(0, ...carousel.slides.map(measure));
  if (!size) return;
  block.style.setProperty('--project-carousel-track-size', `${Math.round(size)}px`);
  // Vertical tracks need a bounded height before they can scroll at all.
  if (axis === 'vertical') track.style.height = `${Math.round(size)}px`;
}

function sync(carousel: Carousel): void {
  const next = activeIndexFor(carousel);
  if (next !== carousel.active) {
    carousel.active = next;
    carousel.block.dataset.activeIndex = String(next);
    renderDots(carousel);
    renderCaptions(carousel);
  }
  applyHeight(carousel);
}

function scrollToIndex(carousel: Carousel, index: number, smooth = true): void {
  const slide = carousel.slides[Math.min(Math.max(index, 0), carousel.slides.length - 1)];
  if (!slide) return;
  const offset = slideOffset(carousel, slide);
  carousel.track.scrollTo({
    [carousel.axis === 'vertical' ? 'top' : 'left']: offset,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

/** Mouse users get click-drag; touch and trackpad already work natively. */
function bindDrag(carousel: Carousel): void {
  const { track } = carousel;
  let dragging = false;
  let start = 0;
  let startScroll = 0;
  let moved = 0;

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a, [contenteditable="true"]')) return;
    dragging = true;
    moved = 0;
    start = carousel.axis === 'vertical' ? event.clientY : event.clientX;
    startScroll = scrollPos(carousel);
    track.classList.add('is-dragging');
    track.style.scrollSnapType = 'none';
  });

  track.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const current = carousel.axis === 'vertical' ? event.clientY : event.clientX;
    const delta = start - current;
    moved = Math.max(moved, Math.abs(delta));
    if (moved > 3 && !track.hasPointerCapture(event.pointerId)) {
      track.setPointerCapture(event.pointerId);
    }
    if (carousel.axis === 'vertical') track.scrollTop = startScroll + delta;
    else track.scrollLeft = startScroll + delta;
  });

  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-dragging');
    track.style.removeProperty('scroll-snap-type');
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    if (moved > 3) scrollToIndex(carousel, activeIndexFor(carousel));
  };

  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
}

function initCarousel(block: HTMLElement): void {
  if (block.dataset.carouselInitialized === 'true') return;
  const track = block.querySelector<HTMLElement>('[data-carousel-track]');
  if (!track) return;
  block.dataset.carouselInitialized = 'true';

  const carousel: Carousel = {
    block,
    track,
    slides: [...block.querySelectorAll<HTMLElement>('[data-carousel-slide]')],
    dotStrip: block.querySelector<HTMLElement>('[data-carousel-dot-strip]'),
    dotWindow: block.querySelector<HTMLElement>('[data-carousel-dot-window]'),
    dots: [...block.querySelectorAll<HTMLElement>('[data-carousel-dot]')],
    captions: [...block.querySelectorAll<HTMLElement>('[data-carousel-caption]')],
    axis: block.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal',
    heightMode: block.dataset.heightMode || 'dynamic',
    active: 0,
  };

  block.dataset.activeIndex = '0';
  renderDots(carousel);
  renderCaptions(carousel);
  applyHeight(carousel);
  // Only ease height once the first measurement has landed, so there is no
  // opening slide-down from `auto`.
  requestAnimationFrame(() => block.classList.add('is-carousel-ready'));

  let frame = 0;
  track.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync(carousel);
    });
  }, { passive: true });

  carousel.dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      scrollToIndex(carousel, Number(dot.dataset.carouselIndex) || 0);
    });
  });

  track.addEventListener('keydown', (event) => {
    const back = carousel.axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const forward = carousel.axis === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    scrollToIndex(carousel, carousel.active + (event.key === forward ? 1 : -1));
  });

  bindDrag(carousel);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => applyHeight(carousel));
    observer.observe(track);
    carousel.slides.forEach((slide) => observer.observe(slide));
  }
  block.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (image.complete) return;
    image.addEventListener('load', () => applyHeight(carousel), { once: true });
  });
}

export function bindProjectImageCarousels(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-project-image-carousel]').forEach(initCarousel);
}
