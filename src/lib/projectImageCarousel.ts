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
  /** Fractional slide position — drives the dots between snap points. */
  progress: number;
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
    // Dev cropping isolates one slide; hidden ones all report offset 0.
    if (!slide.offsetWidth && !slide.offsetHeight) return;
    const distance = Math.abs(slideOffset(carousel, slide) - position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** Fractional position between slide offsets, for continuous dot tracking. */
function progressFor(carousel: Carousel): number {
  const position = scrollPos(carousel);
  const offsets = carousel.slides.map((slide) => slideOffset(carousel, slide));
  if (offsets.length < 2 || position <= offsets[0]) return 0;
  for (let i = 0; i < offsets.length - 1; i += 1) {
    if (position >= offsets[i + 1]) continue;
    const span = offsets[i + 1] - offsets[i];
    return span > 0 ? i + (position - offsets[i]) / span : i;
  }
  return offsets.length - 1;
}

/**
 * Five slots at most: three full-size dots centred on the active one, plus a
 * shrunken preview dot at each end while there are more images that way.
 * `progress` is fractional, so the window slides with the images rather than
 * jumping when one snaps into place. Shared with SSR so the first paint matches.
 */
export function carouselDotGeometry(progress: number, count: number) {
  const centre = Math.min(Math.max(progress, 1), Math.max(count - 2, 1));
  const first = Math.max(0, centre - 2);
  const last = Math.min(count - 1, centre + 2);
  return { centre, first, span: last - first + 1 };
}

/** `activeness` 0–1 mixes the fill; `scale` shrinks toward the window edges. */
export function carouselDotAppearance(index: number, progress: number, centre: number) {
  const fromCentre = Math.abs(index - centre);
  return {
    activeness: Math.max(0, 1 - Math.abs(index - progress)),
    scale: fromCentre <= 1
      ? 1
      : Math.max(0, 1 - 0.4 * Math.min(fromCentre - 1, 1) - 1.2 * Math.max(0, fromCentre - 2)),
  };
}

function renderDots(carousel: Carousel): void {
  const { dots, dotStrip, dotWindow } = carousel;
  const count = dots.length;
  if (!count || !dotStrip || !dotWindow) return;

  const { centre, first, span } = carouselDotGeometry(carousel.progress, count);
  const activeIndex = Math.round(carousel.progress);

  dots.forEach((dot, index) => {
    const { activeness, scale } = carouselDotAppearance(index, carousel.progress, centre);
    dot.style.setProperty('--project-carousel-dot-activeness', activeness.toFixed(3));
    dot.style.setProperty('--project-carousel-dot-scale', scale.toFixed(3));
    dot.setAttribute('aria-current', index === activeIndex ? 'true' : 'false');
  });

  dotWindow.style.setProperty('--project-carousel-dot-count', span.toFixed(4));
  dotStrip.style.setProperty('--project-carousel-dot-offset', first.toFixed(4));
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
  carousel.progress = progressFor(carousel);
  renderDots(carousel);
  const next = activeIndexFor(carousel);
  if (next !== carousel.active) {
    carousel.active = next;
    carousel.block.dataset.activeIndex = String(next);
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
    // Crop stage owns the pointer — don't steal capture mid-pan.
    if ((event.target as HTMLElement).closest('.dev-crop-stage, .dev-crop-stage-host')) return;
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

const registry = new Map<HTMLElement, Carousel>();

const isParked = (el: HTMLElement) => el.dataset.carouselParked === 'true';

/** Visible slides/dots/captions only — parked ones stay in the DOM for the tuner. */
function collectVisible(carousel: Carousel): void {
  carousel.slides = [...carousel.block.querySelectorAll<HTMLElement>('[data-carousel-slide]')]
    .filter((slide) => !isParked(slide));
  carousel.dots = [...carousel.block.querySelectorAll<HTMLElement>('[data-carousel-dot]')]
    .filter((dot) => !isParked(dot));
  carousel.captions = [...carousel.block.querySelectorAll<HTMLElement>('[data-carousel-caption]')]
    .filter((caption) => !isParked(caption));

  carousel.slides.forEach((slide, index) => {
    slide.dataset.carouselIndex = String(index);
  });
  carousel.dots.forEach((dot, index) => {
    dot.dataset.carouselIndex = String(index);
    dot.setAttribute('aria-label', `Go to image ${index + 1}`);
  });
  carousel.captions.forEach((caption, index) => {
    caption.dataset.carouselIndex = String(index);
  });

  const dotsRoot = carousel.block.querySelector<HTMLElement>('[data-carousel-dots]');
  if (dotsRoot) dotsRoot.hidden = carousel.slides.length < 2;
}

/**
 * Re-read the settings the tuner writes onto the block, then re-measure. The
 * axis can flip under us, so the track's own height override is cleared first.
 * Also re-collects slides after a live reorder/park.
 */
function refreshSettings(carousel: Carousel): void {
  carousel.axis = carousel.block.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal';
  carousel.heightMode = carousel.block.dataset.heightMode || 'dynamic';
  collectVisible(carousel);
  carousel.active = Math.min(carousel.active, Math.max(0, carousel.slides.length - 1));
  carousel.track.style.removeProperty('height');
  applyHeight(carousel);
  scrollToIndex(carousel, carousel.active, false);
  carousel.progress = progressFor(carousel);
  carousel.block.dataset.activeIndex = String(carousel.active);
  renderDots(carousel);
  renderCaptions(carousel);
}

function initCarousel(block: HTMLElement): void {
  if (block.dataset.carouselInitialized === 'true') return;
  const track = block.querySelector<HTMLElement>('[data-carousel-track]');
  if (!track) return;
  block.dataset.carouselInitialized = 'true';

  const carousel: Carousel = {
    block,
    track,
    slides: [],
    dotStrip: block.querySelector<HTMLElement>('[data-carousel-dot-strip]'),
    dotWindow: block.querySelector<HTMLElement>('[data-carousel-dot-window]'),
    dots: [],
    captions: [],
    axis: block.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal',
    heightMode: block.dataset.heightMode || 'dynamic',
    active: 0,
    progress: 0,
  };
  collectVisible(carousel);

  registry.set(block, carousel);
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

let refreshBound = false;

export function bindProjectImageCarousels(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-project-image-carousel]').forEach(initCarousel);
  if (refreshBound) return;
  refreshBound = true;
  // Dev tuner writes orientation/height mode onto the block, then fires this.
  window.addEventListener('vcd:carousel-refresh', ((event: CustomEvent) => {
    const only = event.detail?.block as HTMLElement | undefined;
    registry.forEach((carousel, block) => {
      if (only && block !== only) return;
      refreshSettings(carousel);
    });
  }) as EventListener);
}
