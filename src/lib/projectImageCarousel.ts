/**
 * Image carousel behaviour: active-slide tracking, the 5-slot dot window, and
 * height easing. Scrolling itself is native (`overflow` + `scroll-snap`) so a
 * trackpad swipe only moves the carousel while the pointer is over it, and the
 * page keeps its own scroll on the cross axis.
 */

import {
  matchCarouselViewport,
  resolveCarouselSettings,
  type CarouselSettingsSource,
  type ImageViewport,
} from './projectImageCarouselSettings';
import {
  applyMediaGround,
  cropHostFor,
  groundForBox,
  lumaGridFor,
  opaqueBackground,
  readCropVars,
} from '../scripts/adaptiveMediaInk';

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
  /** Last viewport whose breakpoint settings were applied. */
  viewport: ImageViewport;
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
  if (document.documentElement.classList.contains('is-dev-mode')) {
    const isolated = carousel.slides.findIndex((slide) => slide.classList.contains('dev-crop-stage-host'));
    if (isolated >= 0) return isolated;
  }
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

/**
 * Scroll-linked below-caption opacity. Fully gone by `fadeEnd` of the way to
 * the neighbour, so mid-swipe has a gap where neither caption is visible
 * (unlike dots, which crossfade through the midpoint).
 */
export function carouselCaptionOpacity(slideIndex: number, progress: number, fadeEnd = 0.35): number {
  if (fadeEnd <= 0) return Math.abs(progress - slideIndex) < 0.5 ? 1 : 0;
  return Math.max(0, 1 - Math.abs(progress - slideIndex) / fadeEnd);
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

const mediaInkGeneration = new WeakMap<Carousel, number>();

function clearCarouselMediaInk(dots: HTMLElement): void {
  dots.style.removeProperty('--media-ink');
  dots.style.removeProperty('--media-ink-subtle');
  delete dots.dataset.mediaGround;
}

async function refreshCarouselMediaInk(carousel: Carousel): Promise<void> {
  const generation = (mediaInkGeneration.get(carousel) || 0) + 1;
  mediaInkGeneration.set(carousel, generation);
  const dots = carousel.dotWindow;
  if (!dots) return;

  if (carousel.block.dataset.dotsPlacement !== 'over') {
    clearCarouselMediaInk(dots);
    return;
  }

  const slide = carousel.slides[carousel.active];
  const frame = slide?.querySelector<HTMLElement>('[data-carousel-frame]');
  const image = frame?.querySelector<HTMLImageElement>('.project-image-grid__image');
  if (!frame || !image || !dots.getBoundingClientRect().width) {
    clearCarouselMediaInk(dots);
    return;
  }

  const src = image.currentSrc || image.src;
  if (slide?.classList.contains('project-media--placeholder')) {
    clearCarouselMediaInk(dots);
    return;
  }
  const decoded = src ? await lumaGridFor(src) : null;
  if (generation !== mediaInkGeneration.get(carousel)) return;
  if (!decoded) {
    clearCarouselMediaInk(dots);
    return;
  }

  const naturalWidth = Number((decoded as HTMLImageElement).naturalWidth) || 0;
  const naturalHeight = Number((decoded as HTMLImageElement).naturalHeight) || 0;
  const frameRect = frame.getBoundingClientRect();
  const background = opaqueBackground(frame) ?? '#fff';
  const ground = groundForBox(
    dots,
    frame,
    decoded,
    { width: frameRect.width, height: frameRect.height },
    { width: naturalWidth, height: naturalHeight },
    readCropVars(cropHostFor(frame) ?? frame, false),
    background,
  );
  if (generation === mediaInkGeneration.get(carousel) && ground) {
    applyMediaGround(dots, ground);
  }
}

function slideForCaption(carousel: Carousel, caption: HTMLElement): HTMLElement | undefined {
  const id = caption.dataset.carouselItemId || '';
  return carousel.slides.find((slide) => slide.dataset.gridItemId === id);
}

function surfaceWidthForSlide(slide: HTMLElement): number {
  const surface = slide.querySelector<HTMLElement>('.project-image-carousel__surface')
    ?? slide.querySelector<HTMLElement>('[data-carousel-frame]')
    ?? slide;
  return Math.round(surface.getBoundingClientRect().width);
}

let textBoxTrimSupported: boolean | null = null;
const canTrimTextBoxToCap = () => {
  if (textBoxTrimSupported == null) {
    textBoxTrimSupported = typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('text-box-trim', 'trim-start');
  }
  return textBoxTrimSupported;
};

const capMeasureCanvas = typeof document !== 'undefined'
  ? document.createElement('canvas')
  : null;

/**
 * Space from the line-box top down to the capital-letter cap line — used when
 * `text-box-trim` isn't available so dots↔caption padding can still land on caps.
 */
function measureCapTrimPx(el: HTMLElement): number {
  const ctx = capMeasureCanvas?.getContext('2d');
  if (!ctx) return 0;
  const style = getComputedStyle(el);
  ctx.font = style.font;
  const metrics = ctx.measureText('H');
  const fontAscent = metrics.fontBoundingBoxAscent;
  const fontDescent = metrics.fontBoundingBoxDescent;
  const cap = metrics.actualBoundingBoxAscent;
  if (![fontAscent, fontDescent, cap].every(Number.isFinite)) return 0;

  const fontSize = Number.parseFloat(style.fontSize) || 16;
  let lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.45;
  const halfLeading = Math.max(0, (lineHeight - (fontAscent + fontDescent)) / 2);
  return Math.max(0, halfLeading + (fontAscent - cap));
}

function captionHeightForSlide(carousel: Carousel, slideIndex: number): number {
  const slide = carousel.slides[slideIndex];
  if (!slide) return 0;
  const id = slide.dataset.gridItemId || '';
  const caption = carousel.captions.find((node) => node.dataset.carouselItemId === id);
  if (!caption) return 0;
  // text-box-trim already shrinks the box to the cap; the canvas fallback pulls
  // the glyph up with a negative top, so subtract that trim from reserved height.
  const trim = canTrimTextBoxToCap()
    ? 0
    : Number(caption.dataset.capTrim || 0);
  return Math.max(0, caption.scrollHeight - trim);
}

/** Lerp a per-slide value across fractional scroll progress (same basis as dots). */
function lerpByProgress(carousel: Carousel, valueAt: (index: number) => number): number {
  const count = carousel.slides.length;
  if (count <= 0) return 0;
  if (count === 1) return valueAt(0);
  const progress = Math.min(Math.max(carousel.progress, 0), count - 1);
  const left = Math.floor(progress);
  const right = Math.min(left + 1, count - 1);
  const t = progress - left;
  if (t <= 0 || left === right) return valueAt(left);
  if (t >= 1) return valueAt(right);
  return valueAt(left) * (1 - t) + valueAt(right) * t;
}

/**
 * Scroll-linked caption opacity (with a mid-swipe gap), per-image caption
 * widths so fading copy doesn't jump, and caption-slot height lerped with
 * scroll — same continuous progress as the track / dots.
 *
 * Dev mode may leave `data-caption-editing` on after Save so the caption stays
 * contenteditable. Only pin opacity/slot height while that slide is still the
 * nearest one — otherwise a staged caption stays stuck at full opacity and
 * stacks on its neighbour until a full reload.
 */
function syncCaptions(carousel: Carousel): void {
  const slot = carousel.block.querySelector<HTMLElement>('[data-carousel-caption-slot]');
  if (!slot) return;

  const editingId = carousel.captions.find((caption) => caption.dataset.captionEditing === 'true')
    ?.dataset.carouselItemId;
  const editingSlideIndex = editingId
    ? Number(
      carousel.slides.find((slide) => slide.dataset.gridItemId === editingId)?.dataset.carouselIndex,
    )
    : NaN;
  const pinEditing = Number.isFinite(editingSlideIndex)
    && Math.abs(carousel.progress - editingSlideIndex) < 0.5;
  const trimSupported = canTrimTextBoxToCap();

  carousel.captions.forEach((caption) => {
    const slide = slideForCaption(carousel, caption);
    const slideIndex = slide ? Number(slide.dataset.carouselIndex) : Number(caption.dataset.carouselIndex);
    if (!Number.isFinite(slideIndex)) return;

    if (slide) {
      caption.dataset.mobileBleedEligible = slide.dataset.mobileBleedEligible ?? 'false';
      caption.dataset.mobileInset = slide.dataset.mobileInset ?? 'false';
      const width = surfaceWidthForSlide(slide);
      if (width > 0) {
        // Own image width — never retarget to the neighbour mid-fade.
        caption.style.width = `${width}px`;
        caption.style.maxWidth = `${width}px`;
      }
    }

    if (trimSupported) {
      caption.style.removeProperty('top');
      delete caption.dataset.capTrim;
    } else {
      const trim = measureCapTrimPx(caption);
      caption.dataset.capTrim = trim.toFixed(2);
      caption.style.top = `${-trim}px`;
    }

    const editing = editingId != null && caption.dataset.carouselItemId === editingId;
    const pin = editing && pinEditing;
    const opacity = pin ? 1 : carouselCaptionOpacity(slideIndex, carousel.progress);
    caption.style.opacity = opacity.toFixed(3);
    caption.classList.toggle('is-active', opacity > 0.5 || pin);
    caption.style.pointerEvents = opacity > 0.5 || pin ? 'auto' : 'none';
  });

  const targetHeight = pinEditing
    ? captionHeightForSlide(carousel, editingSlideIndex)
    : lerpByProgress(carousel, (index) => captionHeightForSlide(carousel, index));
  slot.hidden = false;
  slot.style.height = `${Math.round(targetHeight)}px`;
}

/**
 * Dynamic height: lerp the visible clip (`--project-carousel-track-size` on
 * `[data-carousel-clip]`) while the scrollport stays at the tallest slide
 * (`--project-carousel-track-port-size`). The clip must not wrap the dots —
 * putting the height on `__media` flex-shrunk the track and broke iOS snap.
 */
function applyHeight(carousel: Carousel): void {
  const { block, track, heightMode, axis } = carousel;
  if (heightMode === 'tallest' && axis === 'horizontal') {
    block.style.removeProperty('--project-carousel-track-size');
    block.style.removeProperty('--project-carousel-track-port-size');
    track.style.removeProperty('height');
    return;
  }

  const measure = (slide: HTMLElement | undefined) => {
    if (!slide) return 0;
    const frame = slide.querySelector<HTMLElement>('[data-carousel-frame]') ?? slide;
    return frame.getBoundingClientRect().height;
  };

  const sizes = carousel.slides.map(measure);
  const tallest = Math.max(0, ...sizes);
  const size = heightMode === 'dynamic'
    ? lerpByProgress(carousel, (index) => sizes[index] ?? 0)
    : tallest;
  if (!size && !tallest) return;

  block.style.setProperty('--project-carousel-track-size', `${Math.round(size || tallest)}px`);
  if (axis === 'horizontal') {
    // Stable scrollport so mandatory snap can finish without a JS re-scroll.
    block.style.setProperty('--project-carousel-track-port-size', `${Math.round(tallest || size)}px`);
    track.style.removeProperty('height');
    return;
  }

  block.style.removeProperty('--project-carousel-track-port-size');
  // Vertical tracks need a bounded height before they can scroll at all.
  track.style.height = `${Math.round(size || tallest)}px`;
}

function sync(carousel: Carousel): void {
  carousel.progress = progressFor(carousel);
  const next = activeIndexFor(carousel);
  if (next !== carousel.active) {
    carousel.active = next;
    carousel.block.dataset.activeIndex = String(next);
  }
  renderDots(carousel);
  syncCaptions(carousel);
  applyHeight(carousel);
  void refreshCarouselMediaInk(carousel);
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

/** Restore a remounted carousel to the same visible item without replaying slide-one motion. */
export function restoreCarouselActiveItem(block: HTMLElement, itemId: string): boolean {
  const carousel = registry.get(block);
  if (!carousel || !itemId) return false;
  const index = carousel.slides.findIndex((slide) => slide.dataset.gridItemId === itemId);
  if (index < 0) return false;
  carousel.active = index;
  carousel.progress = index;
  block.dataset.activeIndex = String(index);
  scrollToIndex(carousel, index, false);
  renderDots(carousel);
  syncCaptions(carousel);
  applyHeight(carousel);
  return true;
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

/**
 * Last-resort correction if native snap leaves us in the inter-slide gap.
 * Instant only — a second smooth scrollTo is what felt like slow-then-speed-up.
 */
function bindTouchSnap(carousel: Carousel): void {
  const { track } = carousel;
  let touching = false;
  let pendingTouchSnap = false;

  const settle = () => {
    if (touching) return;
    if (!pendingTouchSnap) return;
    pendingTouchSnap = false;
    const index = activeIndexFor(carousel);
    const slide = carousel.slides[index];
    if (!slide) return;
    const delta = Math.abs(scrollPos(carousel) - slideOffset(carousel, slide));
    if (delta <= 2) return;
    scrollToIndex(carousel, index, false);
  };

  track.addEventListener('touchstart', () => {
    touching = true;
    pendingTouchSnap = true;
  }, { passive: true });

  track.addEventListener('touchend', () => {
    touching = false;
  }, { passive: true });

  track.addEventListener('touchcancel', () => {
    touching = false;
  }, { passive: true });

  track.addEventListener('wheel', () => {
    pendingTouchSnap = false;
  }, { passive: true });

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') pendingTouchSnap = false;
  }, { passive: true });

  track.addEventListener('scrollend', settle, { passive: true });
}

const registry = new Map<HTMLElement, Carousel>();

const isParked = (el: HTMLElement) => el.dataset.carouselParked === 'true';

function readSettingsSource(block: HTMLElement): CarouselSettingsSource {
  try {
    const raw = block.dataset.carouselSettings || block.dataset.devCarouselSettings || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as CarouselSettingsSource : {};
  } catch {
    return {};
  }
}

function itemIdsForBlock(block: HTMLElement): string[] {
  return [...block.querySelectorAll<HTMLElement>('[data-carousel-slide][data-grid-item-id]')]
    .map((slide) => slide.dataset.gridItemId || '')
    .filter(Boolean);
}

/**
 * Apply the resolved settings for one viewport onto live data-attrs / parking.
 * Used on resize and when the tuner previews a breakpoint.
 */
export function applyCarouselViewportSettings(
  block: HTMLElement,
  viewport: ImageViewport = matchCarouselViewport(),
): void {
  const itemIds = itemIdsForBlock(block);
  const resolved = resolveCarouselSettings(readSettingsSource(block), itemIds);
  const live = resolved.byViewport[viewport];

  block.dataset.orientation = resolved.orientation;
  block.dataset.heightMode = live.heightMode;
  block.dataset.scrollPinned = live.scrollPinned ? 'true' : 'false';
  block.dataset.dotsPlacement = live.dotsPlacement;
  block.dataset.devCarouselOrientation = resolved.orientation;
  block.dataset.devCarouselHeightMode = live.heightMode;
  block.dataset.devCarouselScrollPinned = live.scrollPinned ? 'true' : 'false';
  block.dataset.devCarouselDotsPlacement = live.dotsPlacement;
  block.dataset.devCarouselVisible = JSON.stringify(live.visible);
  if (live.maxHeightVh) {
    block.style.setProperty('--project-carousel-max-vh', String(live.maxHeightVh));
    block.dataset.devCarouselMaxVh = String(live.maxHeightVh);
  } else {
    block.style.removeProperty('--project-carousel-max-vh');
    block.dataset.devCarouselMaxVh = '';
  }

  const visibleSet = new Set(live.visible);
  const track = block.querySelector<HTMLElement>('[data-carousel-track]');
  const strip = block.querySelector<HTMLElement>('[data-carousel-dot-strip]');
  const captionSlot = block.querySelector<HTMLElement>('[data-carousel-caption-slot]');
  const order = [
    ...live.visible,
    ...itemIds.filter((id) => !visibleSet.has(id)),
  ];

  order.forEach((id) => {
    const parked = !visibleSet.has(id);
    const slide = block.querySelector<HTMLElement>(`[data-carousel-slide][data-grid-item-id="${CSS.escape(id)}"]`);
    if (slide && track) {
      if (parked) slide.dataset.carouselParked = 'true';
      else delete slide.dataset.carouselParked;
      track.append(slide);
    }
    const dot = block.querySelector<HTMLElement>(`[data-carousel-dot][data-carousel-item-id="${CSS.escape(id)}"]`);
    if (dot && strip) {
      if (parked) {
        dot.dataset.carouselParked = 'true';
        dot.setAttribute('aria-hidden', 'true');
        dot.tabIndex = -1;
      } else {
        delete dot.dataset.carouselParked;
        dot.removeAttribute('aria-hidden');
        dot.tabIndex = 0;
      }
      strip.append(dot);
    }
    const caption = block.querySelector<HTMLElement>(`[data-carousel-caption][data-carousel-item-id="${CSS.escape(id)}"]`);
    if (caption && captionSlot) {
      if (parked) caption.dataset.carouselParked = 'true';
      else delete caption.dataset.carouselParked;
      captionSlot.append(caption);
    }
  });
}

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
  // Captions are sparse (only below-caption slides) — index them by their slide.
  const slideIndexById = new Map(
    carousel.slides.map((slide, index) => [slide.dataset.gridItemId || '', index]),
  );
  carousel.captions.forEach((caption) => {
    const slideIndex = slideIndexById.get(caption.dataset.carouselItemId || '');
    if (slideIndex !== undefined) caption.dataset.carouselIndex = String(slideIndex);
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
  const isolated = document.documentElement.classList.contains('is-dev-mode')
    ? carousel.slides.findIndex((slide) => slide.classList.contains('dev-crop-stage-host'))
    : -1;
  carousel.active = isolated >= 0
    ? isolated
    : Math.min(carousel.active, Math.max(0, carousel.slides.length - 1));
  carousel.track.style.removeProperty('height');
  carousel.block.style.removeProperty('--project-carousel-track-port-size');
  carousel.block.dataset.activeIndex = String(carousel.active);
  applyHeight(carousel);
  scrollToIndex(carousel, carousel.active, false);
  carousel.progress = progressFor(carousel);
  renderDots(carousel);
  syncCaptions(carousel);
  applyHeight(carousel);
  void refreshCarouselMediaInk(carousel);
}

function syncViewportSettings(carousel: Carousel, force = false): void {
  // Tuner preview owns the attrs while open — don't fight it on resize.
  if (carousel.block.dataset.carouselTunerPreview === 'true' && !force) return;
  const viewport = matchCarouselViewport();
  if (!force && viewport === carousel.viewport) return;
  carousel.viewport = viewport;
  applyCarouselViewportSettings(carousel.block, viewport);
  refreshSettings(carousel);
}

function initCarousel(block: HTMLElement): void {
  if (block.dataset.carouselInitialized === 'true') return;
  const track = block.querySelector<HTMLElement>('[data-carousel-track]');
  if (!track) return;
  block.dataset.carouselInitialized = 'true';

  const viewport = matchCarouselViewport();
  applyCarouselViewportSettings(block, viewport);

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
    viewport,
  };
  collectVisible(carousel);

  registry.set(block, carousel);
  block.dataset.activeIndex = '0';
  carousel.progress = progressFor(carousel);
  renderDots(carousel);
  syncCaptions(carousel);
  applyHeight(carousel);
  // Mark ready after the first measurement so consumers can gate on it.
  requestAnimationFrame(() => block.classList.add('is-carousel-ready'));
  // Cap metrics can shift once webfonts settle — remeasure trim + slot height.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!registry.has(block)) return;
      syncCaptions(carousel);
    }).catch(() => {});
  }

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
  bindTouchSnap(carousel);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      syncViewportSettings(carousel);
      applyHeight(carousel);
      void refreshCarouselMediaInk(carousel);
    });
    observer.observe(track);
    observer.observe(block);
    carousel.slides.forEach((slide) => observer.observe(slide));
  }
  window.addEventListener('resize', () => {
    syncViewportSettings(carousel);
    void refreshCarouselMediaInk(carousel);
  }, { passive: true });
  block.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    image.addEventListener('load', () => {
      sync(carousel);
    });
    if (!image.complete) return;
    void refreshCarouselMediaInk(carousel);
  });
}

let refreshBound = false;

/** Include `root` itself when it matches — querySelectorAll only finds descendants. */
function queryCarouselsIn(root: ParentNode): HTMLElement[] {
  const matches: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('[data-project-image-carousel]')) {
    matches.push(root);
  }
  root.querySelectorAll<HTMLElement>('[data-project-image-carousel]').forEach((el) => {
    matches.push(el);
  });
  return matches;
}

export function bindProjectImageCarousels(root: ParentNode = document): void {
  queryCarouselsIn(root).forEach(initCarousel);
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
  window.addEventListener('vcd:dev-frame-changed', ((event: CustomEvent<{ target?: HTMLElement }>) => {
    const target = event.detail?.target;
    registry.forEach((carousel) => {
      if (target && !carousel.block.contains(target)) return;
      void refreshCarouselMediaInk(carousel);
    });
  }) as EventListener);
  // Caption edits — recollect + resync without resetting scroll position.
  window.addEventListener('vcd:carousel-sync-captions', ((event: CustomEvent) => {
    const only = event.detail?.block as HTMLElement | undefined;
    registry.forEach((carousel, block) => {
      if (only && block !== only) return;
      collectVisible(carousel);
      syncCaptions(carousel);
    });
  }) as EventListener);
}
