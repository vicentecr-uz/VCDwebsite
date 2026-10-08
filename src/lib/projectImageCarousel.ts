import { createPageScope } from './pageLifecycle';
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
import dragTuningConfig from './carouselDragTuning.json';
import {
  carouselRubberbandGive,
  normalizeCarouselDragTuning,
  type CarouselDragTuning,
} from './carouselDragTuning';

const DEFAULT_DRAG_TUNING = normalizeCarouselDragTuning(dragTuningConfig);

type Axis = 'horizontal' | 'vertical';

interface Carousel {
  scope: ReturnType<typeof createPageScope>;
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
  frameHeights: number[];
  captionHeights: number[];
  captionWidths: WeakMap<HTMLElement, number>;
  tallestFrameHeight: number;
  geometryRefreshFrame: number;
  rebindGeometryObservers?: () => void;
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
  carousel.block.style.setProperty(
    '--project-carousel-video-progress',
    lerpByProgress(carousel, (index) => carousel.slides[index]?.querySelector('video') ? 1 : 0).toFixed(4),
  );
  const activeIndex = Math.min(Math.max(Math.round(carousel.progress), 0), Math.max(carousel.slides.length - 1, 0));
  carousel.slides.forEach((slide, index) => {
    if (index === activeIndex) slide.dataset.carouselCurrent = 'true';
    else delete slide.dataset.carouselCurrent;
  });
  if (!count || !dotStrip || !dotWindow) return;

  const { centre, first, span } = carouselDotGeometry(carousel.progress, count);

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
  return carousel.captionHeights[slideIndex] || 0;
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
  carousel.captions.forEach((caption) => {
    const slide = slideForCaption(carousel, caption);
    const slideIndex = slide ? Number(slide.dataset.carouselIndex) : Number(caption.dataset.carouselIndex);
    if (!Number.isFinite(slideIndex)) return;

    if (slide) {
      caption.dataset.mobileBleedEligible = slide.dataset.mobileBleedEligible ?? 'false';
      caption.dataset.mobileInset = slide.dataset.mobileInset ?? 'false';
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
  const nextHeight = `${Math.round(targetHeight)}px`;
  if (slot.style.height !== nextHeight) slot.style.height = nextHeight;
}

/** Read intrinsic frame/caption geometry once per invalidation, outside scroll frames. */
function refreshGeometry(carousel: Carousel): void {
  carousel.frameHeights = carousel.slides.map((slide) => {
    const frame = slide.querySelector<HTMLElement>('[data-carousel-frame]') ?? slide;
    return frame.getBoundingClientRect().height;
  });
  carousel.tallestFrameHeight = Math.max(0, ...carousel.frameHeights);

  const trimSupported = canTrimTextBoxToCap();
  const captionsBySlide = carousel.slides.map((slide) => (
    carousel.captions.find((node) => node.dataset.carouselItemId === slide.dataset.gridItemId)
  ));
  captionsBySlide.forEach((caption, index) => {
    if (!caption) return;
    const slide = carousel.slides[index];
    caption.dataset.mobileBleedEligible = slide.dataset.mobileBleedEligible ?? 'false';
    caption.dataset.mobileInset = slide.dataset.mobileInset ?? 'false';
    const width = surfaceWidthForSlide(carousel.slides[index]);
    if (width > 0 && carousel.captionWidths.get(caption) !== width) {
      // Own image width — never retarget to the neighbour mid-fade.
      caption.style.width = `${width}px`;
      caption.style.maxWidth = `${width}px`;
      carousel.captionWidths.set(caption, width);
    }
  });
  captionsBySlide.forEach((caption) => {
    if (!caption) return;
    if (trimSupported) {
      caption.style.removeProperty('top');
      delete caption.dataset.capTrim;
    } else {
      const trim = measureCapTrimPx(caption);
      caption.dataset.capTrim = trim.toFixed(2);
      caption.style.top = `${-trim}px`;
    }
  });
  carousel.captionHeights = captionsBySlide.map((caption) => {
    if (!caption) return 0;
    const trim = trimSupported ? 0 : Number(caption.dataset.capTrim || 0);
    return Math.max(0, caption.scrollHeight - trim);
  });
}

function scheduleGeometryRefresh(carousel: Carousel): void {
  if (carousel.geometryRefreshFrame) return;
  carousel.geometryRefreshFrame = carousel.scope.frame(() => {
    carousel.geometryRefreshFrame = 0;
    refreshGeometry(carousel);
    syncCaptions(carousel);
    applyHeight(carousel);
  });
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

  const sizes = carousel.frameHeights;
  const tallest = carousel.tallestFrameHeight;
  const size = heightMode === 'dynamic'
    ? lerpByProgress(carousel, (index) => sizes[index] ?? 0)
    : tallest;
  if (!size && !tallest) return;

  const nextSize = `${Math.round(size || tallest)}px`;
  if (block.style.getPropertyValue('--project-carousel-track-size') !== nextSize) {
    block.style.setProperty('--project-carousel-track-size', nextSize);
  }
  if (axis === 'horizontal') {
    // Stable scrollport so mandatory snap can finish without a JS re-scroll.
    const nextPortSize = `${Math.round(tallest || size)}px`;
    if (block.style.getPropertyValue('--project-carousel-track-port-size') !== nextPortSize) {
      block.style.setProperty('--project-carousel-track-port-size', nextPortSize);
    }
    track.style.removeProperty('height');
    return;
  }

  block.style.removeProperty('--project-carousel-track-port-size');
  // Vertical tracks need a bounded height before they can scroll at all.
  const nextTrackHeight = `${Math.round(size || tallest)}px`;
  if (track.style.height !== nextTrackHeight) track.style.height = nextTrackHeight;
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

const touchesVideoControl = (event: Event) => event.composedPath().some((node) =>
  node instanceof HTMLElement && node.matches('video, media-controller'));

/** Mouse users get click-drag; touch and trackpad already work natively. */
function bindDrag(carousel: Carousel): void {
  const { track } = carousel;
  let dragging = false;
  let pointerId: number | null = null;
  let start = 0;
  let startScroll = 0;
  let moved = 0;
  let suppressClick = false;
  let lastSample: { position: number; time: number } | null = null;
  let releaseVelocity = 0;
  let settleFrame = 0;
  let settleGeneration = 0;
  let rubberbandTimer = 0;
  let gestureTuning = DEFAULT_DRAG_TUNING;

  const scroll = () => scrollPos(carousel);
  const eventTime = (event: Event) => {
    const stamp = Number(event.timeStamp);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : performance.now();
  };
  const restoreSnap = () => track.style.removeProperty('scroll-snap-type');
  const clearRubberband = (animate = true) => {
    if (rubberbandTimer) {
      window.clearTimeout(rubberbandTimer);
      rubberbandTimer = 0;
    }
    track.classList.toggle('is-rubberband-settling', animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    track.style.setProperty('--project-carousel-rubberband-duration', `${gestureTuning.springBackMs}ms`);
    track.style.setProperty('--project-carousel-rubberband-x', '0px');
    track.style.setProperty('--project-carousel-rubberband-y', '0px');
    if (animate) {
      rubberbandTimer = carousel.scope.timeout(() => {
        track.classList.remove('is-rubberband-settling');
        rubberbandTimer = 0;
      }, gestureTuning.springBackMs);
    } else {
      track.classList.remove('is-rubberband-settling');
    }
  };
  const applyRubberband = (raw: number) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      track.style.setProperty('--project-carousel-rubberband-x', '0px');
      track.style.setProperty('--project-carousel-rubberband-y', '0px');
      return;
    }
    const bounded = clampScroll(raw);
    const overflow = raw - bounded;
    const amount = carouselRubberbandGive(overflow, gestureTuning);
    if (carousel.axis === 'vertical') {
      track.style.setProperty('--project-carousel-rubberband-x', '0px');
      track.style.setProperty('--project-carousel-rubberband-y', `${-amount}px`);
    } else {
      track.style.setProperty('--project-carousel-rubberband-x', `${-amount}px`);
      track.style.setProperty('--project-carousel-rubberband-y', '0px');
    }
  };
  const cancelMomentum = (restore = true, clearVisual = true) => {
    settleGeneration += 1;
    if (settleFrame) {
      cancelAnimationFrame(settleFrame);
      settleFrame = 0;
    }
    if (restore) restoreSnap();
    if (clearVisual) clearRubberband(false);
  };
  const scrollBounds = () => carousel.axis === 'vertical'
    ? Math.max(0, track.scrollHeight - track.clientHeight)
    : Math.max(0, track.scrollWidth - track.clientWidth);
  const nearestSlideOffset = (projected: number) => {
    const visible = carousel.slides
      .map((slide) => slideOffset(carousel, slide))
      .filter((offset, index) => carousel.slides[index].offsetWidth || carousel.slides[index].offsetHeight);
    if (!visible.length) return scroll();
    const maxScroll = scrollBounds();
    const bounded = Math.min(Math.max(projected, 0), maxScroll);
    return Math.min(
      maxScroll,
      Math.max(0, visible.reduce((best, offset) => Math.abs(offset - bounded) < Math.abs(best - bounded) ? offset : best, visible[0])),
    );
  };
  const clampScroll = (value: number) => Math.min(scrollBounds(), Math.max(0, value));
  const readDragTuning = (): CarouselDragTuning => {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(track) : track.style;
    const raw = {
      tension: Number.parseFloat(style.getPropertyValue('--project-carousel-drag-tension')),
      dragThreshold: Number.parseFloat(style.getPropertyValue('--project-carousel-drag-threshold')),
      springBackMs: Number.parseFloat(style.getPropertyValue('--project-carousel-spring-back')),
    };
    return normalizeCarouselDragTuning({
      tension: Number.isFinite(raw.tension) ? raw.tension : DEFAULT_DRAG_TUNING.tension,
      dragThreshold: Number.isFinite(raw.dragThreshold) ? raw.dragThreshold : DEFAULT_DRAG_TUNING.dragThreshold,
      springBackMs: Number.isFinite(raw.springBackMs) ? raw.springBackMs : DEFAULT_DRAG_TUNING.springBackMs,
    });
  };
  const writeScroll = (value: number) => {
    const bounded = clampScroll(value);
    if (carousel.axis === 'vertical') track.scrollTop = bounded;
    else track.scrollLeft = bounded;
  };
  const settleTo = (target: number, initialVelocity: number) => {
    cancelMomentum(false, false);
    track.style.scrollSnapType = 'none';
    target = clampScroll(target);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      writeScroll(target);
      restoreSnap();
      settleFrame = 0;
      return;
    }
    const generation = settleGeneration;
    let position = scroll();
    let velocity = initialVelocity;
    let previousTime = performance.now();
    const startedAt = previousTime;
    const omega = 0.02;
    const frame = (now: number) => {
      if (generation !== settleGeneration || !track.isConnected) {
        restoreSnap();
        clearRubberband(false);
        settleFrame = 0;
        return;
      }
      const elapsed = Math.min(32, Math.max(1, now - previousTime));
      previousTime = now;
      const acceleration = (omega * omega * (target - position)) - (2 * omega * velocity);
      velocity += acceleration * elapsed;
      position += velocity * elapsed;
      writeScroll(position);
      position = scroll();
      if ((Math.abs(target - position) <= 0.5 && Math.abs(velocity) <= 0.01)
        || now - startedAt >= 1000) {
        writeScroll(target);
        restoreSnap();
        settleFrame = 0;
        return;
      }
      settleFrame = carousel.scope.frame(frame);
    };
    settleFrame = carousel.scope.frame(frame);
  };

  track.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  track.addEventListener('dragstart', (event) => {
    if (dragging && pointerId !== null) event.preventDefault();
  });

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, [contenteditable="true"]') || touchesVideoControl(event)) {
      cancelMomentum();
      return;
    }
    // Crop stage owns the pointer — don't steal capture mid-pan.
    if (target.closest('.dev-crop-stage, .dev-crop-stage-host')) {
      cancelMomentum();
      return;
    }
    cancelMomentum(false);
    gestureTuning = readDragTuning();
    track.style.setProperty('--project-carousel-rubberband-duration', `${gestureTuning.springBackMs}ms`);
    dragging = true;
    pointerId = event.pointerId;
    moved = 0;
    suppressClick = false;
    start = carousel.axis === 'vertical' ? event.clientY : event.clientX;
    startScroll = scrollPos(carousel);
    lastSample = { position: startScroll, time: eventTime(event) };
    releaseVelocity = 0;
    track.classList.add('is-dragging');
    track.style.scrollSnapType = 'none';
  });

  track.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const current = carousel.axis === 'vertical' ? event.clientY : event.clientX;
    const delta = start - current;
    moved = Math.max(moved, Math.abs(delta));
    if (moved > 3 && !track.hasPointerCapture(event.pointerId)) {
      track.setPointerCapture(event.pointerId);
    }
    const raw = startScroll + delta;
    writeScroll(raw);
    applyRubberband(raw);
    const sample = { position: scroll(), time: eventTime(event) };
    if (lastSample) {
      const elapsed = sample.time - lastSample.time;
      if (elapsed > 0 && elapsed <= 150) releaseVelocity = (sample.position - lastSample.position) / elapsed;
      else if (elapsed > 150) releaseVelocity = 0;
    }
    lastSample = sample;
  });

  const endDrag = (event: PointerEvent, allowMomentum: boolean) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const didMove = moved > 3;
    const releaseStamp = eventTime(event);
    const velocity = lastSample && releaseStamp - lastSample.time > 150 ? 0 : releaseVelocity;
    dragging = false;
    pointerId = null;
    lastSample = null;
    track.classList.remove('is-dragging');
    clearRubberband(true);
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    if (didMove) {
      suppressClick = true;
      if (allowMomentum) {
        const projected = scroll() + velocity * 180;
        settleTo(nearestSlideOffset(projected), velocity);
      } else {
        restoreSnap();
      }
      carousel.scope.timeout(() => { suppressClick = false; }, 0);
    } else restoreSnap();
  };

  track.addEventListener('pointerup', (event) => endDrag(event, true));
  track.addEventListener('pointercancel', (event) => endDrag(event, false));
  track.addEventListener('lostpointercapture', (event) => endDrag(event, false));
  track.addEventListener('pointerleave', (event) => {
    if (dragging && event.pointerId === pointerId && !track.hasPointerCapture(event.pointerId)) endDrag(event, false);
  });
  track.addEventListener('wheel', cancelMomentum, { passive: true });
  track.addEventListener('touchstart', cancelMomentum, { passive: true });
  carousel.scope.listen(window, 'resize', cancelMomentum, { passive: true });
  carousel.scope.listen(window, 'pagehide', cancelMomentum, { passive: true });
  carousel.scope.add(() => { cancelMomentum(); clearRubberband(false); });
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
  carousel.rebindGeometryObservers?.();
  refreshGeometry(carousel);
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
    scope: createPageScope(),
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
    frameHeights: [],
    captionHeights: [],
    captionWidths: new WeakMap(),
    tallestFrameHeight: 0,
    geometryRefreshFrame: 0,
  };
  collectVisible(carousel);
  refreshGeometry(carousel);
  track.style.setProperty('--project-carousel-drag-tension', String(DEFAULT_DRAG_TUNING.tension));
  track.style.setProperty('--project-carousel-drag-threshold', `${DEFAULT_DRAG_TUNING.dragThreshold}px`);
  track.style.setProperty('--project-carousel-spring-back', `${DEFAULT_DRAG_TUNING.springBackMs}ms`);

  registry.set(block, carousel);
  block.dataset.activeIndex = '0';
  carousel.progress = progressFor(carousel);
  renderDots(carousel);
  syncCaptions(carousel);
  applyHeight(carousel);
  // Mark ready after the first measurement so consumers can gate on it.
  carousel.scope.frame(() => block.classList.add('is-carousel-ready'));
  // Cap metrics can shift once webfonts settle — remeasure trim + slot height.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!registry.has(block)) return;
      scheduleGeometryRefresh(carousel);
    }).catch(() => {});
  }

  let frame = 0;
  track.addEventListener('scroll', () => {
    if (frame) return;
    frame = carousel.scope.frame(() => {
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
    if (touchesVideoControl(event)) return;
    const back = carousel.axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const forward = carousel.axis === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    scrollToIndex(carousel, carousel.active + (event.key === forward ? 1 : -1));
  });

  bindDrag(carousel);
  bindTouchSnap(carousel);

  let observer: ResizeObserver | undefined;
  let mutations: MutationObserver | undefined;
  const observeIntrinsicGeometry = () => {
    if (!observer) return;
    observer.disconnect();
    carousel.slides.forEach((slide) => {
      const frame = slide.querySelector<HTMLElement>('[data-carousel-frame]') ?? slide;
      const surface = slide.querySelector<HTMLElement>('.project-image-carousel__surface');
      observer?.observe(frame);
      if (surface && surface !== frame) observer?.observe(surface);
    });
    carousel.captions.forEach((caption) => observer?.observe(caption));
  };
  const observeCaptionMutations = () => {
    if (!mutations) return;
    mutations.disconnect();
    carousel.captions.forEach((caption) => {
      mutations?.observe(caption, { childList: true, characterData: true, subtree: true });
    });
  };
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      syncViewportSettings(carousel);
      if (entries.some((entry) => entry.target !== carousel.block && entry.target !== carousel.track)) {
        scheduleGeometryRefresh(carousel);
      }
      void refreshCarouselMediaInk(carousel);
    });
    carousel.scope.add(() => observer?.disconnect());
    observeIntrinsicGeometry();
  }
  carousel.scope.listen(window, 'resize', () => {
    syncViewportSettings(carousel);
    scheduleGeometryRefresh(carousel);
    void refreshCarouselMediaInk(carousel);
  }, { passive: true });
  block.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    image.addEventListener('load', () => {
      scheduleGeometryRefresh(carousel);
      void refreshCarouselMediaInk(carousel);
    });
    if (!image.complete) return;
    void refreshCarouselMediaInk(carousel);
  });
  if (typeof MutationObserver !== 'undefined') {
    mutations = new MutationObserver(() => scheduleGeometryRefresh(carousel));
    observeCaptionMutations();
    carousel.scope.add(() => mutations?.disconnect());
  }
  carousel.rebindGeometryObservers = () => {
    observeIntrinsicGeometry();
    observeCaptionMutations();
  };
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
  document.addEventListener('astro:page-load', () => bindProjectImageCarousels());
  document.addEventListener('astro:before-swap', () => {
    registry.forEach((carousel, block) => { carousel.scope.destroy(); delete block.dataset.carouselInitialized; });
    registry.clear();
  });
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
      refreshGeometry(carousel);
      carousel.rebindGeometryObservers?.();
      syncCaptions(carousel);
    });
  }) as EventListener);
}
