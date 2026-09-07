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
  /** Lift card fade; the drop slot holds off revealing until this has landed. */
  LIFT_CARD_FADE_MS: 200,
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

/** Share of a neighbour's height, centred on it, that yields to the lifted block. */
export const NEIGHBOR_HIT_BAND = 0.5;

export type GapLaneSide = 'before' | 'after';

/** Switch a gap's insertion edge at the same directional hit band as a block. */
export const resolveGapLaneSide = (
  top: number,
  bottom: number,
  clientY: number,
  direction: number,
  current: GapLaneSide,
): GapLaneSide => {
  const height = bottom - top;
  if (height <= 0 || direction === 0) return current;
  const inset = (height * (1 - NEIGHBOR_HIT_BAND)) / 2;
  if (current === 'before' && direction > 0 && clientY >= top + inset) return 'after';
  if (current === 'after' && direction < 0 && clientY <= bottom - inset) return 'before';
  return current;
};

/** Travel under this is subpixel noise — hold the direction rather than flip it. */
const TRAVEL_EPSILON_PX = 0.5;

/**
 * Insert index from a Y position. A neighbour gives way as soon as the lifted
 * block's centre touches the middle {@link NEIGHBOR_HIT_BAND} of it, rather than
 * having to pass its midpoint — a tall neighbour would otherwise need half its
 * own height of travel before anything moved.
 *
 * That hitbox is a trigger, not a partition: sitting inside a band satisfies the
 * test from both sides, so the walk only runs in the direction of travel and
 * starts from the slot the block already holds. `direction` 0 — a block that has
 * not moved yet — walks both ways, settling wherever the two agree.
 */
export const resolveInsertIndexFromY = (
  items: HTMLElement[],
  clientY: number,
  currentIndex = 0,
  direction = 0,
) => {
  const inset = (rect: DOMRect) => (rect.height * (1 - NEIGHBOR_HIT_BAND)) / 2;

  let index = Math.max(0, Math.min(currentIndex, items.length));

  if (direction >= 0) {
    while (index < items.length) {
      const rect = items[index].getBoundingClientRect();
      if (clientY < rect.top + inset(rect)) break;
      index += 1;
    }
  }

  if (direction <= 0) {
    while (index > 0) {
      const rect = items[index - 1].getBoundingClientRect();
      if (clientY > rect.bottom - inset(rect)) break;
      index -= 1;
    }
  }

  return index;
};

/**
 * Share of a cell, centred on it, that yields to a lifted block — 0.5 on each
 * axis, so a quarter of the cell's area. The one-dimensional list uses the same
 * idea in {@link NEIGHBOR_HIT_BAND}: a neighbour gives way once the lifted
 * block's centre reaches the middle of it, rather than having to clear its far
 * edge. Outside every band nothing moves, which is what keeps a block that has
 * only been picked up — or nudged — from displacing anything.
 */
export const GRID_HIT_BAND = 0.5;

type HitBand = { top: number; bottom: number; left: number; right: number };

const bandOf = (rect: HitBand): HitBand => {
  const insetX = ((rect.right - rect.left) * (1 - GRID_HIT_BAND)) / 2;
  const insetY = ((rect.bottom - rect.top) * (1 - GRID_HIT_BAND)) / 2;
  return {
    top: rect.top + insetY,
    bottom: rect.bottom - insetY,
    left: rect.left + insetX,
    right: rect.right - insetX,
  };
};

/** -1 before the band, 1 after it, 0 inside — reading order, rows before columns. */
const relateToBand = (x: number, y: number, band: HitBand) => {
  if (y < band.top) return -1;
  if (y > band.bottom) return 1;
  if (x < band.left) return -1;
  if (x > band.right) return 1;
  return 0;
};

const unionRect = (rects: HitBand[]): HitBand => ({
  top: Math.min(...rects.map((r) => r.top)),
  bottom: Math.max(...rects.map((r) => r.bottom)),
  left: Math.min(...rects.map((r) => r.left)),
  right: Math.max(...rects.map((r) => r.right)),
});

/** A thing the lifted block can displace: one cell, or a whole row of them. */
type HitTarget = { startIndex: number; endIndex: number; rect: HitBand };

const cellTargets = (items: HTMLElement[]): HitTarget[] =>
  items.map((el, index) => ({
    startIndex: index,
    endIndex: index + 1,
    rect: el.getBoundingClientRect(),
  }));

/**
 * Rows, for a block that spans the whole width. Two half-width cards sharing a
 * row are one target with one band — a full-width block has no way to sit
 * between them, so offering that position only orphans one of them into a row
 * of its own and leaves an empty cell behind.
 */
const rowTargets = (items: HTMLElement[]): HitTarget[] => {
  const rows: HitTarget[] = [];
  let previousTop = 0;
  items.forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    const current = rows[rows.length - 1];
    if (!current || index === 0 || rect.top - previousTop > 1) {
      rows.push({ startIndex: index, endIndex: index + 1, rect });
    } else {
      current.endIndex = index + 1;
      current.rect = unionRect([current.rect, rect]);
    }
    previousTop = rect.top;
  });
  return rows;
};

/**
 * Insert index for a two-dimensional flow (a listing grid), where the 1-D walk
 * above has nothing to walk: siblings sit beside each other as well as below.
 *
 * Same shape as {@link resolveInsertIndexFromY}, in two axes. The slot the block
 * already holds sets the direction of travel — the block is either before it or
 * after it — and the walk runs that way only, yielding each target whose band
 * the block's centre has reached or passed. Sitting inside its own slot's band
 * means it has not gone anywhere, so nothing moves.
 *
 * Running one direction is what stops the flicker: a band satisfies the test
 * from both sides, so a two-way walk steps forward over a target and straight
 * back again.
 */
export const resolveInsertIndexInGrid = (
  items: HTMLElement[],
  centerX: number,
  centerY: number,
  currentIndex = 0,
  slot: HTMLElement | null = null,
  options: { snapToRowStart?: boolean } = {},
) => {
  if (!items.length) return 0;

  const targets = options.snapToRowStart ? rowTargets(items) : cellTargets(items);

  // No slot to measure against (first frame): leave the block where it is.
  const slotRect = slot?.getBoundingClientRect();
  if (!slotRect || slotRect.height <= 0) return currentIndex;

  const direction = relateToBand(centerX, centerY, bandOf(slotRect));
  if (direction === 0) return currentIndex;

  let index = currentIndex;

  if (direction > 0) {
    for (const target of targets) {
      if (target.startIndex < index) continue;
      if (relateToBand(centerX, centerY, bandOf(target.rect)) < 0) break;
      index = target.endIndex;
    }
    return index;
  }

  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const target = targets[i];
    if (target.endIndex > index) continue;
    if (relateToBand(centerX, centerY, bandOf(target.rect)) > 0) break;
    index = target.startIndex;
  }
  return index;
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
  targetKey: string;
  placedKey: string;
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

export type ResolveInsertContext = {
  items: HTMLElement[];
  centerX: number;
  centerY: number;
  currentIndex: number;
  currentKey: string;
  sourceIndex: number;
  /** Sign of travel through the page; 0 before the block has moved. */
  direction: number;
  /** The drop slot as currently placed, so it can compete for the position. */
  slot: HTMLElement | null;
};

export type ReorderHost = {
  getItems: () => HTMLElement[];
  /** Extra in-flow elements whose position changes when the host rewrites layout during slot sync. */
  getFlipElements?: () => HTMLElement[];
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
    placementKey: string,
  ) => { top: string; bottom: string; marginTop?: string };
  initialPlacementKey?: string;
  /** Tag for the drop slot. `div` suits a section list; a grid `<ul>` wants `li`. */
  indicatorTag?: string;
  /**
   * Easing for neighbours yielding to the slot. Defaults to `ease-out`, which
   * suits a section's long vertical travel. Grid neighbours hop a short
   * diagonal, over which the same curve reads flat — they want a curve that
   * front-loads more of the distance.
   */
  flipEasing?: string;
  /** Move the existing slot with its neighbours instead of crossfading locations. */
  moveIndicatorWithFlip?: boolean;
  /**
   * Per-host edge-scroll feel. Defaults to {@link SCROLL_HOLD}. A dense grid
   * wants a longer, gentler ramp than a page of full-width sections — the same
   * pointer travel covers far more content.
   */
  scrollTuning?: {
    deadZonePx?: number;
    rampPx?: number;
    maxScrollSpeed?: number;
    velocitySmoothing?: number;
  };
  /**
   * Where the lifted block would land. Defaults to the 1-D Y walk
   * ({@link resolveInsertIndexFromY}); two-dimensional hosts pass
   * {@link resolveInsertIndexInGrid}.
   */
  resolveInsertIndex?: (context: ResolveInsertContext) => number;
  resolveInsertPlacement?: (
    context: ResolveInsertContext,
  ) => { index: number; key?: string };
  /**
   * Called after the slot is placed. Hosts set whatever sizing the shared gap
   * model does not own — a grid slot's column span, for instance.
   */
  onSlotSync?: (indicator: HTMLElement, insertIndex: number, placementKey: string) => void;
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
  targetKey: '',
  placedKey: '',
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
  /**
   * Catch a settling block mid-drop and lift it again from where it currently
   * is. Returns false when there is no settle to interrupt.
   */
  resumeLift: (
    item: HTMLElement,
    handle: HTMLElement,
    pointerX: number,
    pointerY: number,
  ) => boolean;
  /**
   * End a settle immediately, committing the move and dropping the block into
   * its slot without the glide. Frees the controller for another block's lift.
   * Returns false when there is no settle to finish.
   */
  settleNow: () => boolean;
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
  const scrollDriver = createScrollDriver(host.scrollTuning);
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
  const fadeGhostFrames = new Map<HTMLElement, number>();
  const fadeGhostTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  let indicatorAnim: IndicatorAnim = { type: 'steady' };
  let lastStatusKey = '';
  /**
   * Which way the lifted block is travelling through the page, held across the
   * still frames between moves so a pause never re-opens the other direction.
   * Measured in document space: hold at an edge and the pointer stops moving
   * while the block keeps travelling under auto-scroll.
   */
  let travelDirection = 0;
  let lastTravelX: number | null = null;
  let lastTravelY: number | null = null;
  let dropAnimation: Animation | null = null;
  let dropShadowAnimation: Animation | null = null;
  let dropIndicatorFadeAnimation: Animation | null = null;
  let dropPositionRaf = 0;
  let dropPositionResolver: (() => void) | null = null;
  let liftFrame = 0;
  let liftGeneration = 0;
  /**
   * Bumped whenever a settle is superseded (re-lift, destroy). The drop's async
   * tails commit position and teardown, so they check this before touching an
   * item that a newer session already owns.
   */
  let dropRun = 0;

  const nowMs = () => performance.now();

  const getIndicatorBody = () =>
    dropIndicator?.querySelector<HTMLElement>(`.${host.classes.indicatorBody}`) ?? null;

  const applyIndicatorOpacity = (value: number) => {
    state.indicatorOpacity = value;
    const body = getIndicatorBody();
    if (body) body.style.opacity = String(value);
  };

  const clearGhosts = () => {
    activeFadeGhosts.forEach((ghost) => {
      const frame = fadeGhostFrames.get(ghost);
      if (frame) cancelAnimationFrame(frame);
      fadeGhostFrames.delete(ghost);
      const timer = fadeGhostTimers.get(ghost);
      if (timer) clearTimeout(timer);
      fadeGhostTimers.delete(ghost);
      ghost.remove();
    });
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
    if (index < items.length) items[index].before(dropIndicator);
    else if (items.length) items[items.length - 1].after(dropIndicator);
    else zone.append(dropIndicator);
  };

  const applySlotMetrics = (insertIndex: number, placementKey: string) => {
    if (!dropIndicator) return;
    const gaps = host.measureInsertGaps(insertIndex, state.sourceIndex, {
      top: state.gapTop,
      bottom: state.gapBottom,
    }, placementKey);
    dropIndicator.style.setProperty('--gap-top', gaps.top);
    dropIndicator.style.setProperty('--gap-bottom', gaps.bottom);
    dropIndicator.style.setProperty('--gap-height', `${state.blockHeight}px`);
    // Real margin (not an internal grid rail) so margin-top pages keep collapse.
    dropIndicator.style.marginTop = gaps.marginTop ?? '';
  };

  const syncPlacement = (insertIndex: number, placementKey: string) => {
    releaseNeighbor();
    applySlotMetrics(insertIndex, placementKey);
    placeIndicatorBeforeIndex(insertIndex);
    bindNeighbor(insertIndex);
    if (dropIndicator) host.onSlotSync?.(dropIndicator, insertIndex, placementKey);
  };

  /** Centre of the lifted block in viewport space — what placement is keyed off. */
  const liftCenter = () => ({
    x: state.liftLeft + state.liftWidth / 2,
    y: state.liftTop + state.blockHeight / 2,
  });

  const resolveInsert = (centerX: number, centerY: number) => {
    const items = host.getItems();
    const itemCount = items.length;
    const normalize = (index: number, key = '') => ({
      index: Math.max(0, Math.min(index, itemCount)),
      key,
    });
    const context = {
      items,
      centerX,
      centerY,
      currentIndex: state.placedIndex,
      currentKey: state.placedKey,
      sourceIndex: state.sourceIndex,
      direction: travelDirection,
      slot: getIndicatorBody(),
    };
    if (host.resolveInsertPlacement) {
      const placement = host.resolveInsertPlacement(context);
      return normalize(placement.index, placement.key);
    }
    if (host.resolveInsertIndex) {
      return normalize(host.resolveInsertIndex(context));
    }
    return normalize(resolveInsertIndexFromY(
      items,
      centerY,
      state.placedIndex,
      travelDirection,
    ));
  };

  const createIndicator = () => {
    const indicator = document.createElement(host.indicatorTag ?? 'div');
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

    const duration = REORDER_TIMING.DROP_INDICATOR_FADE_MS;

    const frame = requestAnimationFrame(() => {
      fadeGhostFrames.delete(ghost);
      ghost.style.transition = `opacity ${duration}ms ease-out`;
      ghost.style.opacity = '0';
      const timer = setTimeout(() => {
        fadeGhostTimers.delete(ghost);
        ghost.remove();
        activeFadeGhosts = activeFadeGhosts.filter((item) => item !== ghost);
      }, duration + 50);
      fadeGhostTimers.set(ghost, timer);
    });
    fadeGhostFrames.set(ghost, frame);
  };

  const performFlipRelocate = (fromIndex: number, toIndex: number, toKey: string) => {
    if (!dropIndicator) return;

    const items = host.getItems();
    const affected = getAffectedItems(items, fromIndex, toIndex);
    // Include in-flight FLIP nodes so a fast re-target continues from their
    // current visual position instead of snapping when they leave `affected`.
    const captureElements = [...new Set([
      ...flipMovingElements,
      ...affected,
      ...(host.moveIndicatorWithFlip ? [dropIndicator] : []),
      ...(host.getFlipElements?.() ?? []),
    ])];
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
    syncPlacement(toIndex, toKey);
    if (window.scrollY !== scrollYBefore) {
      window.scrollTo(0, scrollYBefore);
    }
    void dropIndicator.offsetHeight;

    const motionMs = prefersReducedMotion() ? 0 : REORDER_TIMING.FLIP_REPOSITION_MS;
    const moving: HTMLElement[] = [];
    const rawDeltas = new Map<HTMLElement, { x: number; y: number }>();

    // Measure every final rect before applying any transform. A dirty gap can
    // move between a section and the slot, so its own invert must subtract the
    // captured transform of its new ancestor instead of inheriting it twice.
    captureElements.forEach((el) => {
      const first = firstRects.get(el);
      if (!first) return;
      const last = el.getBoundingClientRect();
      rawDeltas.set(el, {
        x: first.left - last.left,
        y: first.top - last.top,
      });
    });

    captureElements.forEach((el) => {
      const raw = rawDeltas.get(el);
      if (!raw) return;
      let ancestor = el.parentElement;
      let ancestorDelta = { x: 0, y: 0 };
      while (ancestor) {
        const captured = rawDeltas.get(ancestor);
        if (captured) {
          ancestorDelta = captured;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      // Both axes: a section list only ever moves vertically (deltaX stays 0),
      // but a grid reflows sideways as items wrap between rows.
      const deltaX = raw.x - ancestorDelta.x;
      const deltaY = raw.y - ancestorDelta.y;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
      el.classList.add(host.classes.flipMoving);
      el.style.transition = 'none';
      el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
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
      const easing = host.flipEasing ?? 'ease-out';
      moving.forEach((el) => {
        el.style.transition = `transform ${motionMs}ms ${easing}`;
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

  const relocateToTarget = (toIndex: number, toKey: string) => {
    if (
      !dropIndicator
      || (state.placedIndex === toIndex && state.placedKey === toKey)
    ) return;

    const fromIndex = state.placedIndex;
    // Crossfade hosts leave a ghost at the old slot; physical-slot hosts move
    // the indicator itself in the same FLIP as their neighbours.
    if (
      !host.moveIndicatorWithFlip
      && state.indicatorOpacity > 0.05
    ) {
      spawnFadeGhost();
    }

    performFlipRelocate(fromIndex, toIndex, toKey);
    state.placedIndex = toIndex;
    state.placedKey = toKey;
    // Relocating during the opening delay must not jump the slot in early —
    // leave that fade in charge and let it finish on its own schedule.
    if (indicatorAnim.type === 'steady') applyIndicatorOpacity(1);
  };

  const advanceIndicatorAnim = (now: number) => {
    if (indicatorAnim.type === 'fadeInWait') {
      if (now < indicatorAnim.until) return;
      if (
        state.placedIndex !== state.targetIndex
        || state.placedKey !== state.targetKey
      ) {
        indicatorAnim = { type: 'steady' };
        return;
      }
      const duration = REORDER_TIMING.DROP_INDICATOR_FADE_MS;
      indicatorAnim = {
        type: 'fadeIn',
        from: state.indicatorOpacity,
        to: 1,
        start: now,
        duration,
      };
    }

    if (indicatorAnim.type === 'fadeIn') {
      if (
        state.placedIndex !== state.targetIndex
        || state.placedKey !== state.targetKey
      ) {
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
    const key = `${state.sourceIndex}:${state.targetIndex}:${state.targetKey}:${Math.round(window.scrollY)}`;
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

      const center = liftCenter();
      const travelX = center.x + window.scrollX;
      const travelY = center.y + window.scrollY;
      const deltaX = lastTravelX === null ? 0 : travelX - lastTravelX;
      const deltaY = lastTravelY === null ? 0 : travelY - lastTravelY;
      const travelled = Math.hypot(deltaX, deltaY) > TRAVEL_EPSILON_PX;
      if (travelled) {
        if (Math.abs(deltaY) > TRAVEL_EPSILON_PX) travelDirection = Math.sign(deltaY);
        lastTravelX = travelX;
        lastTravelY = travelY;
      } else if (lastTravelX === null || lastTravelY === null) {
        lastTravelX = travelX;
        lastTravelY = travelY;
      }

      if (travelled) {
        const placement = resolveInsert(center.x, center.y);
        state.targetIndex = placement.index;
        state.targetKey = placement.key;
      }
    }

    if (
      state.targetIndex !== state.placedIndex
      || state.targetKey !== state.placedKey
    ) {
      relocateToTarget(state.targetIndex, state.targetKey);
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
    // Land after the last item, not at the end of the zone — the zone can hold
    // trailing non-item children (scripts, the scroll finale) that stay last.
    if (insertIndex < items.length) items[insertIndex].before(item);
    else if (items.length) items[items.length - 1].after(item);
    else zone.append(item);
  };

  /**
   * Glide the block into the slot, re-reading the slot every frame and holding
   * the start point in page coordinates. The block paints viewport-fixed, but
   * both ends of the travel belong to the page — scroll during a drop and the
   * block rides along with the slot instead of landing at a stale viewport spot.
   */
  const glideDropPosition = (
    item: HTMLElement,
    body: HTMLElement,
    motionMs: number,
    run: number,
  ) => new Promise<void>((resolve) => {
    dropPositionResolver = resolve;
    const itemRect = item.getBoundingClientRect();
    const fromPageTop = (Number.parseFloat(item.style.top) || itemRect.top) + window.scrollY;
    const fromPageLeft = (Number.parseFloat(item.style.left) || itemRect.left) + window.scrollX;
    const start = nowMs();
    let landed = false;

    const step = (now: number) => {
      dropPositionRaf = 0;
      if (run !== dropRun) {
        if (dropPositionResolver === resolve) dropPositionResolver = null;
        resolve();
        return;
      }

      const t = clamp01((now - start) / motionMs);
      const pos = 1 + (easeOutElastic(t) - 1) * DROP_ELASTIC_AMPLITUDE;
      const fromTop = fromPageTop - window.scrollY;
      const fromLeft = fromPageLeft - window.scrollX;
      const target = body.getBoundingClientRect();

      item.style.top = `${fromTop + (target.top - fromTop) * pos}px`;
      item.style.left = `${fromLeft + (target.left - fromLeft) * pos}px`;

      // Past the glide the loop keeps pinning the block to the slot, so a scroll
      // during the slot's fade-out can't pull them apart before the commit.
      if (t >= 1 && !landed) {
        landed = true;
        if (dropPositionResolver === resolve) dropPositionResolver = null;
        resolve();
      }
      dropPositionRaf = requestAnimationFrame(step);
    };

    step(start);
  });

  const cancelDropPositionGlide = () => {
    if (dropPositionRaf) {
      cancelAnimationFrame(dropPositionRaf);
      dropPositionRaf = 0;
    }
    const resolve = dropPositionResolver;
    dropPositionResolver = null;
    resolve?.();
  };

  const animateDropToSlot = (item: HTMLElement, run: number) => {
    const body = getIndicatorBody();
    if (!body) return Promise.resolve();

    const motionMs = prefersReducedMotion() ? 0 : REORDER_TIMING.DROP_ANIMATION_MS;
    const fromScale = 1.02;
    const toScale = 1;

    item.classList.add('is-dropping');
    item.classList.remove('is-lifted-raised');
    void item.offsetHeight;

    if (motionMs <= 0) {
      const targetRect = body.getBoundingClientRect();
      item.style.top = `${targetRect.top}px`;
      item.style.left = `${targetRect.left}px`;
      const backdropClass = host.classes.liftBackdrop;
      if (backdropClass) {
        const backdrop = item.querySelector<HTMLElement>(`:scope > .${backdropClass}`);
        if (backdrop) backdrop.style.boxShadow = 'none';
      }
      item.classList.remove('is-dropping');
      return Promise.resolve();
    }

    dropAnimation?.cancel();
    dropShadowAnimation?.cancel();
    dropIndicatorFadeAnimation?.cancel();
    cancelDropPositionGlide();
    // WAAPI owns scale, the rAF glide owns top/left — suppress CSS transitions
    // that would fight either.
    item.style.transition = 'none';

    const scaleKeyframes: Keyframe[] = [];
    const shadowKeyframes: Keyframe[] = [];
    for (let i = 0; i <= DROP_ELASTIC_SAMPLES; i += 1) {
      const t = i / DROP_ELASTIC_SAMPLES;
      const scaleT = easeOutCubic(t);
      scaleKeyframes.push({
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
    }

    const animation = item.animate(scaleKeyframes, {
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
        if (run !== dropRun) return;
        if (dropShadowAnimation === shadowAnim) dropShadowAnimation = null;
        backdrop.style.boxShadow = 'none';
        shadowAnim.cancel();
      });
    }

    // The slot holds full through the whole settle — see fadeOutIndicator.
    body.style.transition = 'none';

    return glideDropPosition(item, body, motionMs, run).then(() => {
      // A re-lift already caught this block mid-settle — leave its position.
      if (run !== dropRun) return;
      if (dropAnimation === animation) dropAnimation = null;
      item.style.removeProperty('transition');
      animation.cancel();
      item.classList.remove('is-dropping');
    });
  };

  /**
   * Fade the slot away once the card has fully landed — size and shadow both
   * finished. Runs before the block commits, since removing the slot is what
   * gives the block its space back.
   */
  const fadeOutIndicator = (run: number) => {
    const body = getIndicatorBody();
    if (!body || state.indicatorOpacity <= 0.01) return Promise.resolve();

    const duration = REORDER_TIMING.DROP_INDICATOR_FADE_MS;

    const fadeAnim = body.animate(
      [{ opacity: state.indicatorOpacity }, { opacity: 0 }],
      { duration, easing: 'ease-out', fill: 'forwards' },
    );
    dropIndicatorFadeAnimation = fadeAnim;

    return fadeAnim.finished.catch(() => {}).then(() => {
      if (run !== dropRun) return;
      if (dropIndicatorFadeAnimation === fadeAnim) dropIndicatorFadeAnimation = null;
      applyIndicatorOpacity(0);
      fadeAnim.cancel();
    });
  };

  const teardownChrome = () => {
    stopTick();
    liftGeneration += 1;
    if (liftFrame) {
      cancelAnimationFrame(liftFrame);
      liftFrame = 0;
    }
    cancelDropPositionGlide();
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
    // A mid-drop re-lift pins the settle's scale inline; never outlive the lift.
    item.style.removeProperty('transform');
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
      const initialPlacementKey = host.initialPlacementKey ?? '';
      state = {
        phase: 'lifted',
        sourceIndex,
        targetIndex: sourceIndex,
        placedIndex: sourceIndex,
        targetKey: initialPlacementKey,
        placedKey: initialPlacementKey,
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
        indicatorOpacity: 0,
      };

      /*
        Scroll anchoring compensates for the lift. Taking the block out of flow
        and dropping a stand-in where it stood is a wash for page height, but
        the browser has already picked a visible node to hold steady, and if
        that node is the block itself it adjusts scroll to keep it put — by
        however far it has to, which is why the jump varied with where the
        block sat in the viewport. Same pin performFlipRelocate uses for slot
        moves; the lift needed it too.
      */
      const scrollYBeforeLift = window.scrollY;

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
      // Layout space is present from the first connected frame; opacity owns
      // the delayed visual reveal independently.
      dropIndicator.classList.add('is-visible');
      applyIndicatorOpacity(0);
      // Size and span the slot *before* it enters the flow. Inserting a bare
      // cell and correcting it inside syncPlacement costs a frame of wrong
      // layout — unnoticeable in a single column, violent in a grid, where a
      // column-spanning block is briefly replaced by a one-column, zero-height
      // cell and every card after it reflows and snaps back.
      applySlotMetrics(sourceIndex, initialPlacementKey);
      host.onSlotSync?.(dropIndicator, sourceIndex, initialPlacementKey);
      item.before(dropIndicator);
      syncPlacement(sourceIndex, initialPlacementKey);
      // Force the layout the pin is guarding, then undo any adjustment the
      // browser made. Reading scrollY without this reads the pre-layout value
      // and the pin silently does nothing.
      void dropIndicator.offsetHeight;
      if (window.scrollY !== scrollYBeforeLift) {
        window.scrollTo(0, scrollYBeforeLift);
      }
      indicatorAnim = {
        type: 'fadeInWait',
        until: nowMs() + REORDER_TIMING.LIFT_CARD_FADE_MS,
      };

      if (prefersReducedMotion()) {
        item.classList.add('is-lifted-raised');
      } else {
        const generation = liftGeneration;
        liftFrame = requestAnimationFrame(() => {
          liftFrame = 0;
          if (generation !== liftGeneration) return;
          item.classList.add('is-lifted-raised');
        });
      }

      scrollDriver.reset();
      travelDirection = 0;
      const initialCenter = liftCenter();
      lastTravelX = initialCenter.x + window.scrollX;
      lastTravelY = initialCenter.y + window.scrollY;
      startTick();
      updateStatus();
    },

    resumeLift: (item, handle, pointerX, pointerY) => {
      if (state.phase !== 'dropping' || host.getDragItem() !== item) return false;

      // Retire the settle's pending tails before cancelling it, so they can't
      // commit the drop position over the lift we're about to restore.
      dropRun += 1;
      cancelDropPositionGlide();

      // Read the animated values off computed style: getBoundingClientRect
      // would fold in the settle's scale, and top/left are the unscaled box.
      const computed = getComputedStyle(item);
      const currentTop = Number.parseFloat(computed.top) || state.liftTop;
      const currentLeft = Number.parseFloat(computed.left) || state.liftLeft;
      const currentTransform = computed.transform;

      const backdropClass = host.classes.liftBackdrop;
      const backdrop = backdropClass
        ? item.querySelector<HTMLElement>(`:scope > .${backdropClass}`)
        : null;
      const body = getIndicatorBody();
      // Cancelling reverts each property to its CSS value, so everything the
      // settle was animating down would snap back to full. Read the in-flight
      // values first, pin them, then release to CSS next frame so scale, card
      // shadow and drop slot all ease back up from where the settle got to.
      const currentShadow = backdrop ? getComputedStyle(backdrop).boxShadow : '';
      const currentIndicatorOpacity = body
        ? Number.parseFloat(getComputedStyle(body).opacity)
        : 1;

      dropAnimation?.cancel();
      dropAnimation = null;
      dropShadowAnimation?.cancel();
      dropShadowAnimation = null;
      dropIndicatorFadeAnimation?.cancel();
      dropIndicatorFadeAnimation = null;

      item.style.top = `${currentTop}px`;
      item.style.left = `${currentLeft}px`;
      item.style.removeProperty('transition');
      item.classList.remove('is-dropping');
      if (currentTransform && currentTransform !== 'none') {
        item.style.transform = currentTransform;
      }
      item.classList.add('is-lifted-raised');

      if (backdrop) {
        // Restores the CSS transition the settle replaced (opacity + shadow).
        backdrop.style.removeProperty('transition');
        if (currentShadow && currentShadow !== 'none') {
          backdrop.style.boxShadow = currentShadow;
        }
      }
      if (body) body.style.removeProperty('transition');
      applyIndicatorOpacity(Number.isFinite(currentIndicatorOpacity) ? currentIndicatorOpacity : 1);
      indicatorAnim = { type: 'steady' };

      if (liftFrame) cancelAnimationFrame(liftFrame);
      const generation = liftGeneration;
      liftFrame = requestAnimationFrame(() => {
        liftFrame = 0;
        if (generation !== liftGeneration) return;
        item.style.removeProperty('transform');
        backdrop?.style.removeProperty('box-shadow');
        applyIndicatorOpacity(1);
      });

      state.phase = 'lifted';
      state.pointerX = pointerX;
      state.pointerY = pointerY;
      // Scroll-hold measures from the new grab, not the original one.
      state.grabPointerY = pointerY;
      state.grabOffsetX = pointerX - currentLeft;
      state.grabOffsetY = pointerY - currentTop;
      state.liftTop = currentTop;
      state.liftLeft = currentLeft;
      state.targetIndex = state.placedIndex;
      state.targetKey = state.placedKey;
      setLiftTransformOrigin(item, handle);

      scrollDriver.reset();
      travelDirection = 0;
      const resumedCenter = liftCenter();
      lastTravelX = resumedCenter.x + window.scrollX;
      lastTravelY = resumedCenter.y + window.scrollY;
      startTick();
      updateStatus();
      return true;
    },

    settleNow: () => {
      if (state.phase !== 'dropping') return false;
      const item = host.getDragItem();
      if (!item) return false;

      // Retire the settle's tails — the commit happens here instead.
      dropRun += 1;
      cancelDropPositionGlide();
      dropAnimation?.cancel();
      dropAnimation = null;
      dropShadowAnimation?.cancel();
      dropShadowAnimation = null;
      dropIndicatorFadeAnimation?.cancel();
      dropIndicatorFadeAnimation = null;

      if (state.targetIndex !== state.sourceIndex) {
        moveItemToIndex(item, state.targetIndex);
      }
      teardownChrome();
      clearLiftStyles(item);
      followPointer = true;
      state = idleState();
      host.onStatus?.('Idle · insert —');
      return true;
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
      state.targetKey = '';
    },

    endDrop: async () => {
      if (state.phase !== 'lifted') return;
      const item = host.getDragItem();
      if (!item) return;

      dropRun += 1;
      const run = dropRun;
      state.phase = 'dropping';
      stopTick();
      scrollDriver.reset();
      clearGhosts();
      clearActiveFlip();
      dropIndicator?.classList.remove('is-repositioning');
      const openingFadePending = indicatorAnim.type !== 'steady';
      indicatorAnim = { type: 'steady' };

      // Release commits the exact slot already shown. Re-resolving against an
      // in-flight FLIP can choose a different lane after the user's decision.
      const finalIndex = state.placedIndex;
      state.targetIndex = finalIndex;
      state.targetKey = state.placedKey;
      // Dropped before the opening fade landed: carry on from where it got to
      // rather than popping the slot to full for the settle.
      if (!openingFadePending) applyIndicatorOpacity(1);

      await animateDropToSlot(item, run);

      // Caught mid-settle: the block is lifted again and owns the chrome now.
      if (run !== dropRun) return;

      await fadeOutIndicator(run);
      if (run !== dropRun) return;

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
      dropRun += 1;
      teardownChrome();
      if (item) clearLiftStyles(item);
      followPointer = true;
      state = idleState();
    },
  };
};
