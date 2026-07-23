/**
 * Shared timing, scroll math, gap measurement, and tick-driven reorder session
 * for section reorder (probe first; editor adopts in a later step).
 *
 * One session owns state + a single rAF tick. Indicator opacity / FLIP / ghosts
 * are advanced from that tick — no racing promise tokens.
 */

export const REORDER_TIMING = {
  DROP_INDICATOR_FADE_MS: 143,
  DROP_INDICATOR_EXIT_MS: 140,
  DROP_INDICATOR_ENTER_MS: 140,
  FLIP_REPOSITION_MS: 350,
  FADE_IN_DELAY_MS: 100,
  /** Drop settle via easeOutElastic (sampled WAAPI keyframes). */
  DROP_ANIMATION_MS: 700,
} as const;

export const SCROLL_HOLD = {
  DEAD_ZONE_PX: 32,
  RAMP_PX: 200,
  MAX_SCROLL_SPEED: 66,
  VELOCITY_SMOOTHING: 0.1,
} as const;

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const maxScrollY = () =>
  Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);

export const measureBlockHeight = (el: HTMLElement) => el.getBoundingClientRect().height;

export const measureGapAbove = (el: HTMLElement) => {
  const prev = el.previousElementSibling;
  if (!(prev instanceof HTMLElement)) return getComputedStyle(el).marginTop;
  const gap = el.getBoundingClientRect().top - prev.getBoundingClientRect().bottom;
  if (gap <= 0) return getComputedStyle(el).marginTop;
  return `${gap}px`;
};

export const measureGapBelow = (el: HTMLElement) => {
  const next = el.nextElementSibling;
  if (!(next instanceof HTMLElement)) return getComputedStyle(el).marginBottom;
  const gap = next.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
  if (gap <= 0) return getComputedStyle(el).marginBottom;
  return `${gap}px`;
};

/** Items between insert indices that must shift when the drop slot moves. */
export const getAffectedItems = (
  items: HTMLElement[],
  fromIndex: number,
  toIndex: number,
) => {
  if (fromIndex === toIndex) return [];
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex) - 1;
  const affected: HTMLElement[] = [];
  for (let i = start; i <= end && i < items.length; i += 1) {
    affected.push(items[i]);
  }
  return affected;
};

/** Insert index from a Y position against item midpoints. */
export const resolveInsertIndexFromY = (items: HTMLElement[], clientY: number) => {
  for (let i = 0; i < items.length; i += 1) {
    const rect = items[i].getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) return i;
  }
  return items.length;
};

export const setLiftTransformOrigin = (
  root: HTMLElement,
  handle: HTMLElement | null,
) => {
  if (!handle) {
    root.style.transformOrigin = '';
    return;
  }
  const rootRect = root.getBoundingClientRect();
  const handleRect = handle.getBoundingClientRect();
  const originX = handleRect.left + handleRect.width / 2 - rootRect.left;
  const originY = handleRect.top + handleRect.height / 2 - rootRect.top;
  root.style.transformOrigin = `${originX}px ${originY}px`;
};

export const frameBlend = (dtMs: number, smoothing: number) => {
  const frameFactor = dtMs / (1000 / 60);
  return 1 - (1 - smoothing) ** frameFactor;
};

export const smoothToward = (
  current: number,
  ideal: number,
  dtMs: number,
  smoothing: number,
) => {
  const blend = frameBlend(dtMs, smoothing);
  return current + (ideal - current) * blend;
};

export type ScrollDriver = {
  reset: () => void;
  /** Apply one frame of edge-ramped, smoothed page scroll. */
  apply: (dtMs: number, grabPointerY: number, lastClientY: number) => void;
  getLastTickTime: () => number;
  setLastTickTime: (time: number) => void;
};

/** Stateful velocity-ramped scroll used while a block is lifted. */
export const createScrollDriver = (
  options: {
    deadZonePx?: number;
    rampPx?: number;
    maxScrollSpeed?: number;
    velocitySmoothing?: number;
  } = {},
): ScrollDriver => {
  const deadZonePx = options.deadZonePx ?? SCROLL_HOLD.DEAD_ZONE_PX;
  const rampPx = options.rampPx ?? SCROLL_HOLD.RAMP_PX;
  const maxScrollSpeed = options.maxScrollSpeed ?? SCROLL_HOLD.MAX_SCROLL_SPEED;
  const velocitySmoothing = options.velocitySmoothing ?? SCROLL_HOLD.VELOCITY_SMOOTHING;

  let scrollVelocity = 0;
  let scrollRemainder = 0;
  let lastTickTime = 0;

  const targetVelocity = (grabPointerY: number, lastClientY: number) => {
    const delta = lastClientY - grabPointerY;
    const distance = Math.abs(delta);
    if (distance < deadZonePx) return 0;

    const beyond = distance - deadZonePx;
    const t = Math.min(1, beyond / rampPx);
    const eased = t * t * t;
    return (delta < 0 ? -1 : 1) * eased * maxScrollSpeed;
  };

  return {
    reset: () => {
      scrollVelocity = 0;
      scrollRemainder = 0;
      lastTickTime = 0;
    },
    apply: (dtMs, grabPointerY, lastClientY) => {
      const target = targetVelocity(grabPointerY, lastClientY);
      const frameFactor = dtMs / (1000 / 60);
      const blend = 1 - (1 - velocitySmoothing) ** frameFactor;
      scrollVelocity += (target - scrollVelocity) * blend;

      scrollRemainder += scrollVelocity * frameFactor;
      if (Math.abs(scrollRemainder) < 0.5) return;

      const step = scrollRemainder > 0
        ? Math.floor(scrollRemainder)
        : Math.ceil(scrollRemainder);
      window.scrollBy(0, step);
      scrollRemainder -= step;
    },
    getLastTickTime: () => lastTickTime,
    setLastTickTime: (time) => {
      lastTickTime = time;
    },
  };
};

// ---------------------------------------------------------------------------
// Step 2: tick-driven reorder session (state + render)
// ---------------------------------------------------------------------------

export type ReorderPhase = 'idle' | 'lifted' | 'dropping';

export type ReorderState = {
  phase: ReorderPhase;
  sourceIndex: number;
  targetIndex: number;
  placedIndex: number;
  pointerX: number;
  pointerY: number;
  grabPointerY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  liftTop: number;
  liftInitialTop: number;
  liftLeft: number;
  liftWidth: number;
  blockHeight: number;
  gapTop: string;
  gapBottom: string;
  indicatorOpacity: number;
};

export type ReorderClasses = {
  indicator: string;
  indicatorBody: string;
  flipMoving: string;
  /** Lifted item class. Defaults to `is-lifted` (probe). Tapico uses `is-section-lifted`. */
  lifted?: string;
  dropPreviewAbove?: string;
  dropPreviewBelow?: string;
  fadeGhost: string;
  /** Optional lift card chrome (Tapico). Shadow fades with drop scale. */
  liftBackdrop?: string;
};

export type ReorderHost = {
  getItems: () => HTMLElement[];
  getDropZone: () => HTMLElement | null;
  getDragItem: () => HTMLElement | null;
  classes: ReorderClasses;
  /**
   * Gaps that belong to the lifted item itself (captured once at lift).
   * Defaults to visual neighbour gaps. Tapico overrides with margin-top.
   */
  measureLiftGaps?: (item: HTMLElement) => { top: string; bottom: string };
  /**
   * Measure gap rails for the insert slot (host owns margin model).
   * Optional `marginTop` is applied as real CSS margin on the indicator
   * (needed for margin-top spacing systems so collapse matches live sections).
   */
  measureInsertGaps: (
    insertIndex: number,
    sourceIndex: number,
    liftGaps: { top: string; bottom: string },
  ) => { top: string; bottom: string; marginTop?: string };
  onStatus?: (text: string) => void;
};

export type BeginLiftOptions = {
  /**
   * When true (default), tick derives insert index from the lifted block center
   * and runs scroll-hold + 1:1 pointer follow. When false, target is set only via
   * `setTargetIndex` and the lift stays put.
   */
  followPointer?: boolean;
};

type IndicatorAnim =
  | { type: 'steady' }
  | { type: 'fadeInWait'; until: number }
  | { type: 'fadeIn'; from: number; to: number; start: number; duration: number };

const idleState = (): ReorderState => ({
  phase: 'idle',
  sourceIndex: 0,
  targetIndex: 0,
  placedIndex: 0,
  pointerX: 0,
  pointerY: 0,
  grabPointerY: 0,
  grabOffsetX: 0,
  grabOffsetY: 0,
  liftTop: 0,
  liftInitialTop: 0,
  liftLeft: 0,
  liftWidth: 0,
  blockHeight: 0,
  gapTop: '0px',
  gapBottom: '0px',
  indicatorOpacity: 1,
});

const easeOut = (t: number) => 1 - (1 - t) ** 2;

/** easings.net easeOutElastic — spring settle with decaying overshoot. */
export const easeOutElastic = (t: number) => {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const DROP_ELASTIC_SAMPLES = 32;
/** Softens easeOutElastic overshoot (1 = full easings.net amplitude). */
const DROP_ELASTIC_AMPLITUDE = 0.55;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export type ReorderController = {
  beginLift: (
    item: HTMLElement,
    handle: HTMLElement,
    pointerX: number,
    pointerY: number,
    sourceIndex: number,
    options?: BeginLiftOptions,
  ) => void;
  setPointer: (x: number, y: number) => void;
  setTargetIndex: (index: number) => void;
  endDrop: () => Promise<void>;
  isActive: () => boolean;
  getState: () => Readonly<ReorderState>;
  /** Tear down lift chrome without committing a move. */
  destroy: () => void;
};

/**
 * Tick-driven reorder session. Probe (and later editor) provide host hooks;
 * this owns placement, FLIP, indicator fade, scroll, and drop glide.
 */
export const createReorderController = (host: ReorderHost): ReorderController => {
  const scrollDriver = createScrollDriver();
  const liftedClass = host.classes.lifted ?? 'is-lifted';
  let state = idleState();
  let dropIndicator: HTMLElement | null = null;
  let dropNeighborAbove: HTMLElement | null = null;
  let dropNeighborBelow: HTMLElement | null = null;
  let followPointer = true;
  let rafId = 0;
  let flipGeneration = 0;
  let flipRafId = 0;
  let flipCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let flipMovingElements: HTMLElement[] = [];
  let activeFadeGhosts: HTMLElement[] = [];
  let indicatorAnim: IndicatorAnim = { type: 'steady' };
  let lastStatusKey = '';
  let dropAnimation: Animation | null = null;
  let dropShadowAnimation: Animation | null = null;
  let dropIndicatorFadeAnimation: Animation | null = null;

  const nowMs = () => performance.now();

  const getIndicatorBody = () =>
    dropIndicator?.querySelector<HTMLElement>(`.${host.classes.indicatorBody}`) ?? null;

  const applyIndicatorOpacity = (value: number) => {
    state.indicatorOpacity = value;
    const body = getIndicatorBody();
    if (body) body.style.opacity = String(value);
  };

  const clearGhosts = () => {
    activeFadeGhosts.forEach((ghost) => ghost.remove());
    activeFadeGhosts = [];
  };

  const cancelFlipSchedulers = () => {
    if (flipCleanupTimer) {
      clearTimeout(flipCleanupTimer);
      flipCleanupTimer = null;
    }
    if (flipRafId) {
      cancelAnimationFrame(flipRafId);
      flipRafId = 0;
    }
  };

  const clearActiveFlip = () => {
    flipGeneration += 1;
    cancelFlipSchedulers();
    flipMovingElements.forEach((el) => {
      el.classList.remove(host.classes.flipMoving);
      el.style.transition = '';
      el.style.transform = '';
    });
    flipMovingElements = [];
  };

  const releaseNeighbor = () => {
    if (dropNeighborAbove && host.classes.dropPreviewAbove) {
      dropNeighborAbove.classList.remove(host.classes.dropPreviewAbove);
    }
    if (dropNeighborBelow && host.classes.dropPreviewBelow) {
      dropNeighborBelow.classList.remove(host.classes.dropPreviewBelow);
    }
    dropNeighborAbove = null;
    dropNeighborBelow = null;
  };

  const bindNeighbor = (insertIndex: number) => {
    releaseNeighbor();
    const items = host.getItems();

    if (host.classes.dropPreviewAbove && insertIndex > 0) {
      const above = items[insertIndex - 1] ?? null;
      if (above) {
        dropNeighborAbove = above;
        above.classList.add(host.classes.dropPreviewAbove);
      }
    }

    if (host.classes.dropPreviewBelow && insertIndex < items.length) {
      const below = items[insertIndex] ?? null;
      if (below) {
        dropNeighborBelow = below;
        below.classList.add(host.classes.dropPreviewBelow);
      }
    }
  };

  const placeIndicatorBeforeIndex = (index: number) => {
    const zone = host.getDropZone();
    const dragItem = host.getDragItem();
    if (!zone || !dropIndicator) return;

    if (index === state.sourceIndex && dragItem) {
      dragItem.before(dropIndicator);
      return;
    }

    const items = host.getItems();
    if (index >= items.length) zone.append(dropIndicator);
    else items[index].before(dropIndicator);
  };

  const applySlotMetrics = (insertIndex: number) => {
    if (!dropIndicator) return;
    const gaps = host.measureInsertGaps(insertIndex, state.sourceIndex, {
      top: state.gapTop,
      bottom: state.gapBottom,
    });
    dropIndicator.style.setProperty('--gap-top', gaps.top);
    dropIndicator.style.setProperty('--gap-bottom', gaps.bottom);
    dropIndicator.style.setProperty('--gap-height', `${state.blockHeight}px`);
    // Real margin (not an internal grid rail) so margin-top pages keep collapse.
    dropIndicator.style.marginTop = gaps.marginTop ?? '';
  };

  const syncPlacement = (insertIndex: number) => {
    releaseNeighbor();
    applySlotMetrics(insertIndex);
    placeIndicatorBeforeIndex(insertIndex);
    bindNeighbor(insertIndex);
  };

  const createIndicator = () => {
    const indicator = document.createElement('div');
    indicator.className = host.classes.indicator;
    indicator.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = host.classes.indicatorBody;
    body.setAttribute('aria-hidden', 'true');
    indicator.append(body);
    return indicator;
  };

  const spawnFadeGhost = () => {
    const body = getIndicatorBody();
    if (!body || state.indicatorOpacity <= 0.05) return;

    const rect = body.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const ghost = document.createElement('div');
    ghost.className = `${host.classes.indicatorBody} ${host.classes.fadeGhost}`;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.top = `${rect.top}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.opacity = String(state.indicatorOpacity);
    (host.getDropZone() ?? document.body).appendChild(ghost);
    activeFadeGhosts.push(ghost);

    const duration = prefersReducedMotion() ? 0 : REORDER_TIMING.DROP_INDICATOR_FADE_MS;
    if (duration <= 0) {
      ghost.remove();
      activeFadeGhosts = activeFadeGhosts.filter((item) => item !== ghost);
      return;
    }

    requestAnimationFrame(() => {
      ghost.style.transition = `opacity ${duration}ms ease-out`;
      ghost.style.opacity = '0';
      setTimeout(() => {
        ghost.remove();
        activeFadeGhosts = activeFadeGhosts.filter((item) => item !== ghost);
      }, duration + 50);
    });
  };

  const performFlipRelocate = (fromIndex: number, toIndex: number) => {
    if (!dropIndicator || fromIndex === toIndex) {
      syncPlacement(toIndex);
      return;
    }

    const items = host.getItems();
    const affected = getAffectedItems(items, fromIndex, toIndex);
    // Include in-flight FLIP nodes so a fast re-target continues from their
    // current visual position instead of snapping when they leave `affected`.
    const captureElements = [...new Set([...flipMovingElements, ...affected])];
    const firstRects = new Map(
      captureElements.map((el) => [el, el.getBoundingClientRect()]),
    );

    // Invalidate any pending rAF/timeout from the previous relocate before we
    // invert again — a stale rAF was clearing the new invert and causing snaps.
    flipGeneration += 1;
    const generation = flipGeneration;
    cancelFlipSchedulers();
    flipMovingElements.forEach((el) => {
      el.classList.remove(host.classes.flipMoving);
      el.style.transition = 'none';
      el.style.transform = '';
    });
    flipMovingElements = [];

    dropIndicator.classList.add('is-repositioning');
    // Moving the drop slot changes content height above in-view nodes. Scroll
    // anchoring would pin those nodes' viewport tops (deltaY ≈ 0), so downward
    // FLIP skips and neighbors snap. Pin scrollY across the layout write.
    const scrollYBefore = window.scrollY;
    syncPlacement(toIndex);
    if (window.scrollY !== scrollYBefore) {
      window.scrollTo(0, scrollYBefore);
    }
    void dropIndicator.offsetHeight;

    const motionMs = prefersReducedMotion() ? 0 : REORDER_TIMING.FLIP_REPOSITION_MS;
    const moving: HTMLElement[] = [];

    captureElements.forEach((el) => {
      const first = firstRects.get(el);
      if (!first) return;
      const deltaY = first.top - el.getBoundingClientRect().top;
      if (Math.abs(deltaY) < 0.5) return;
      el.classList.add(host.classes.flipMoving);
      el.style.transition = 'none';
      el.style.transform = `translateY(${deltaY}px)`;
      moving.push(el);
    });

    flipMovingElements = moving;
    void dropIndicator.offsetHeight;

    if (!motionMs || moving.length === 0) {
      clearActiveFlip();
      dropIndicator.classList.remove('is-repositioning');
      return;
    }

    flipRafId = requestAnimationFrame(() => {
      flipRafId = 0;
      if (generation !== flipGeneration) return;
      moving.forEach((el) => {
        el.style.transition = `transform ${motionMs}ms ease-out`;
        el.style.transform = '';
      });
      flipCleanupTimer = setTimeout(() => {
        flipCleanupTimer = null;
        if (generation !== flipGeneration) return;
        clearActiveFlip();
        dropIndicator?.classList.remove('is-repositioning');
      }, motionMs);
    });
  };

  const relocateToTarget = (toIndex: number) => {
    if (!dropIndicator || state.placedIndex === toIndex) return;

    const fromIndex = state.placedIndex;
    // Ghost the old slot, then show the new one immediately while neighbors
    // FLIP. Hiding the indicator during FLIP made downward moves look dead —
    // neighbors animate up under the lifted card with no visible gap cue.
    if (state.indicatorOpacity > 0.05 && !prefersReducedMotion()) {
      spawnFadeGhost();
    }

    performFlipRelocate(fromIndex, toIndex);
    state.placedIndex = toIndex;
    applyIndicatorOpacity(1);
    indicatorAnim = { type: 'steady' };
  };

  const advanceIndicatorAnim = (now: number) => {
    if (indicatorAnim.type === 'fadeInWait') {
      if (now < indicatorAnim.until) return;
      if (state.placedIndex !== state.targetIndex) {
        indicatorAnim = { type: 'steady' };
        return;
      }
      const duration = prefersReducedMotion() ? 0 : REORDER_TIMING.DROP_INDICATOR_FADE_MS;
      if (duration <= 0) {
        applyIndicatorOpacity(1);
        indicatorAnim = { type: 'steady' };
        return;
      }
      indicatorAnim = {
        type: 'fadeIn',
        from: state.indicatorOpacity,
        to: 1,
        start: now,
        duration,
      };
    }

    if (indicatorAnim.type === 'fadeIn') {
      if (state.placedIndex !== state.targetIndex) {
        indicatorAnim = { type: 'steady' };
        return;
      }
      const t = clamp01((now - indicatorAnim.start) / Math.max(1, indicatorAnim.duration));
      const value = indicatorAnim.from
        + (indicatorAnim.to - indicatorAnim.from) * easeOut(t);
      applyIndicatorOpacity(value);
      if (t >= 1) indicatorAnim = { type: 'steady' };
    }
  };

  const updateStatus = () => {
    if (!host.onStatus || state.phase === 'idle') return;
    const key = `${state.sourceIndex}:${state.targetIndex}:${Math.round(window.scrollY)}`;
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    host.onStatus(
      `Grabbing · insert ${state.targetIndex} / ${host.getItems().length}`,
    );
  };

  const renderLift = () => {
    const dragItem = host.getDragItem();
    if (!dragItem || state.phase === 'idle') return;
    dragItem.style.top = `${state.liftTop}px`;
    dragItem.style.left = `${state.liftLeft}px`;
  };

  const tick = (now: number) => {
    rafId = 0;
    if (state.phase !== 'lifted') return;

    const lastTick = scrollDriver.getLastTickTime();
    if (!lastTick) scrollDriver.setLastTickTime(now);
    const dtMs = Math.min(48, now - scrollDriver.getLastTickTime());
    scrollDriver.setLastTickTime(now);

    if (followPointer) {
      scrollDriver.apply(dtMs, state.grabPointerY, state.pointerY);

      // 1:1 with the pointer — scroll is still keyed off initial grab Y.
      state.liftTop = state.pointerY - state.grabOffsetY;
      state.liftLeft = state.pointerX - state.grabOffsetX;
      renderLift();

      const centerY = state.liftTop + state.blockHeight / 2;
      state.targetIndex = resolveInsertIndexFromY(host.getItems(), centerY);
    }

    if (state.targetIndex !== state.placedIndex) {
      relocateToTarget(state.targetIndex);
    }

    advanceIndicatorAnim(now);
    updateStatus();

    if (state.phase === 'lifted') {
      rafId = requestAnimationFrame(tick);
    }
  };

  const startTick = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  };

  const stopTick = () => {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const moveItemToIndex = (item: HTMLElement, insertIndex: number) => {
    const zone = host.getDropZone();
    if (!zone) return;
    const items = host.getItems().filter((el) => el !== item);
    if (insertIndex >= items.length) zone.append(item);
    else items[insertIndex].before(item);
  };

  const animateDropToSlot = (item: HTMLElement) => {
    const body = getIndicatorBody();
    const targetRect = body?.getBoundingClientRect();
    if (!targetRect) return Promise.resolve();

    const motionMs = prefersReducedMotion() ? 0 : REORDER_TIMING.DROP_ANIMATION_MS;
    const fromTop = Number.parseFloat(item.style.top) || item.getBoundingClientRect().top;
    const fromLeft = Number.parseFloat(item.style.left) || item.getBoundingClientRect().left;
    const toTop = targetRect.top;
    const toLeft = targetRect.left;
    const fromScale = 1.02;
    const toScale = 1;

    item.classList.add('is-dropping');
    item.classList.remove('is-lifted-raised');
    void item.offsetHeight;

    if (motionMs <= 0) {
      item.style.top = `${toTop}px`;
      item.style.left = `${toLeft}px`;
      const backdropClass = host.classes.liftBackdrop;
      if (backdropClass) {
        const backdrop = item.querySelector<HTMLElement>(`:scope > .${backdropClass}`);
        if (backdrop) backdrop.style.boxShadow = 'none';
      }
      applyIndicatorOpacity(0);
      item.classList.remove('is-dropping');
      return Promise.resolve();
    }

    dropAnimation?.cancel();
    dropShadowAnimation?.cancel();
    dropIndicatorFadeAnimation?.cancel();
    // WAAPI owns top/left/scale — suppress CSS transitions that would fight it.
    item.style.transition = 'none';

    const keyframes: Keyframe[] = [];
    const shadowKeyframes: Keyframe[] = [];
    const indicatorFadeKeyframes: Keyframe[] = [];
    const indicatorFrom = state.indicatorOpacity;
    for (let i = 0; i <= DROP_ELASTIC_SAMPLES; i += 1) {
      const t = i / DROP_ELASTIC_SAMPLES;
      const elastic = easeOutElastic(t);
      const pos = 1 + (elastic - 1) * DROP_ELASTIC_AMPLITUDE;
      const scaleT = easeOutCubic(t);
      keyframes.push({
        top: `${fromTop + (toTop - fromTop) * pos}px`,
        left: `${fromLeft + (toLeft - fromLeft) * pos}px`,
        transform: `scale(${fromScale + (toScale - fromScale) * scaleT})`,
        offset: t,
      });
      // Same easeOutCubic as scale so the shadow eases out with the settle.
      const shadowAlpha = 0.18 * (1 - scaleT);
      shadowKeyframes.push({
        boxShadow:
          shadowAlpha < 0.002
            ? 'none'
            : `0 0.85em 2.4em rgba(0, 0, 0, ${shadowAlpha})`,
        offset: t,
      });
      indicatorFadeKeyframes.push({
        opacity: indicatorFrom * (1 - scaleT),
        offset: t,
      });
    }

    const animation = item.animate(keyframes, {
      duration: motionMs,
      easing: 'linear',
      fill: 'forwards',
    });
    dropAnimation = animation;

    const backdropClass = host.classes.liftBackdrop;
    const backdrop = backdropClass
      ? item.querySelector<HTMLElement>(`:scope > .${backdropClass}`)
      : null;
    if (backdrop) {
      backdrop.style.transition = 'opacity 200ms ease-out';
      const shadowAnim = backdrop.animate(shadowKeyframes, {
        duration: motionMs,
        easing: 'linear',
        fill: 'forwards',
      });
      dropShadowAnimation = shadowAnim;
      shadowAnim.finished.catch(() => {}).then(() => {
        if (dropShadowAnimation === shadowAnim) dropShadowAnimation = null;
        backdrop.style.boxShadow = 'none';
        shadowAnim.cancel();
      });
    }

    // Drop indicator fades with the same easeOutCubic as scale + shadow.
    body.style.transition = 'none';
    const indicatorFadeAnim = body.animate(indicatorFadeKeyframes, {
      duration: motionMs,
      easing: 'linear',
      fill: 'forwards',
    });
    dropIndicatorFadeAnimation = indicatorFadeAnim;
    indicatorFadeAnim.finished.catch(() => {}).then(() => {
      if (dropIndicatorFadeAnimation === indicatorFadeAnim) dropIndicatorFadeAnimation = null;
      applyIndicatorOpacity(0);
      indicatorFadeAnim.cancel();
    });

    return animation.finished
      .catch(() => {
        // Cancelled (destroy / new drop) — still commit if this item is live.
      })
      .then(() => {
        if (dropAnimation === animation) dropAnimation = null;
        item.style.top = `${toTop}px`;
        item.style.left = `${toLeft}px`;
        item.style.removeProperty('transition');
        animation.cancel();
        item.classList.remove('is-dropping');
      });
  };

  const teardownChrome = () => {
    stopTick();
    scrollDriver.reset();
    clearActiveFlip();
    clearGhosts();
    releaseNeighbor();
    dropAnimation?.cancel();
    dropAnimation = null;
    dropShadowAnimation?.cancel();
    dropShadowAnimation = null;
    dropIndicatorFadeAnimation?.cancel();
    dropIndicatorFadeAnimation = null;
    indicatorAnim = { type: 'steady' };
    dropIndicator?.remove();
    dropIndicator = null;
    lastStatusKey = '';
  };

  const clearLiftStyles = (item: HTMLElement) => {
    item.classList.remove(liftedClass, 'is-lifted-raised', 'is-dropping');
    item.style.position = '';
    item.style.left = '';
    item.style.top = '';
    item.style.width = '';
    item.style.margin = '';
    item.style.zIndex = '';
    item.style.transformOrigin = '';
    item.style.removeProperty('transition');
  };

  return {
    beginLift: (item, handle, pointerX, pointerY, sourceIndex, options = {}) => {
      if (state.phase !== 'idle') return;

      followPointer = options.followPointer !== false;
      const rect = item.getBoundingClientRect();
      const liftGaps = host.measureLiftGaps?.(item) ?? {
        top: measureGapAbove(item),
        bottom: measureGapBelow(item),
      };
      state = {
        phase: 'lifted',
        sourceIndex,
        targetIndex: sourceIndex,
        placedIndex: sourceIndex,
        pointerX,
        pointerY,
        grabPointerY: pointerY,
        grabOffsetX: pointerX - rect.left,
        grabOffsetY: pointerY - rect.top,
        liftTop: rect.top,
        liftInitialTop: rect.top,
        liftLeft: rect.left,
        liftWidth: rect.width,
        blockHeight: measureBlockHeight(item),
        gapTop: liftGaps.top,
        gapBottom: liftGaps.bottom,
        indicatorOpacity: 1,
      };

      // Take the item out of flow before inserting the slot stand-in, so the
      // indicator inherits the same collapse context the section had.
      item.classList.add(liftedClass);
      item.classList.remove('is-lifted-raised');
      item.style.position = 'fixed';
      item.style.left = `${rect.left}px`;
      item.style.top = `${rect.top}px`;
      item.style.width = `${rect.width}px`;
      item.style.margin = '0';
      item.style.zIndex = '100';
      setLiftTransformOrigin(item, handle);

      dropIndicator = createIndicator();
      item.before(dropIndicator);
      syncPlacement(sourceIndex);
      dropIndicator.classList.add('is-visible');
      applyIndicatorOpacity(1);

      if (prefersReducedMotion()) {
        item.classList.add('is-lifted-raised');
      } else {
        requestAnimationFrame(() => {
          item.classList.add('is-lifted-raised');
        });
      }

      scrollDriver.reset();
      startTick();
      updateStatus();
    },

    setPointer: (x, y) => {
      if (state.phase !== 'lifted' || !followPointer) return;
      state.pointerX = x;
      state.pointerY = y;
    },

    setTargetIndex: (index) => {
      if (state.phase !== 'lifted') return;
      const max = host.getItems().length;
      state.targetIndex = Math.max(0, Math.min(index, max));
    },

    endDrop: async () => {
      if (state.phase !== 'lifted') return;
      const item = host.getDragItem();
      if (!item) return;

      state.phase = 'dropping';
      stopTick();
      scrollDriver.reset();
      clearGhosts();
      clearActiveFlip();
      dropIndicator?.classList.remove('is-repositioning');
      indicatorAnim = { type: 'steady' };

      const finalIndex = followPointer
        ? resolveInsertIndexFromY(
          host.getItems(),
          state.liftTop + state.blockHeight / 2,
        )
        : state.targetIndex;
      state.targetIndex = finalIndex;

      if (state.placedIndex !== finalIndex) {
        syncPlacement(finalIndex);
        state.placedIndex = finalIndex;
      }
      applyIndicatorOpacity(1);

      await animateDropToSlot(item);

      if (finalIndex !== state.sourceIndex) {
        moveItemToIndex(item, finalIndex);
      }

      teardownChrome();
      clearLiftStyles(item);
      followPointer = true;
      state = idleState();
      host.onStatus?.('Idle · insert —');
    },

    isActive: () => state.phase === 'lifted' || state.phase === 'dropping',

    getState: () => state,

    destroy: () => {
      const item = host.getDragItem();
      teardownChrome();
      if (item) clearLiftStyles(item);
      followPointer = true;
      state = idleState();
    },
  };
};
