/**
 * Shared timing, scroll math, gap measurement, and insert-index helpers
 * for section reorder (probe + DevSectionReorderEditor).
 *
 * Step 1 of the tick-driven reconciler refactor: pure helpers only.
 * Host files still own DOM orchestration; step 2 will introduce state + render.
 */

export const REORDER_TIMING = {
  DROP_INDICATOR_FADE_MS: 143,
  DROP_INDICATOR_EXIT_MS: 140,
  DROP_INDICATOR_ENTER_MS: 140,
  FLIP_REPOSITION_MS: 350,
  FADE_IN_DELAY_MS: 100,
  DROP_ANIMATION_MS: 350,
  DROP_SCALE_MS: 200,
} as const;

export const SCROLL_HOLD = {
  DEAD_ZONE_PX: 32,
  RAMP_PX: 200,
  MAX_SCROLL_SPEED: 66,
  VELOCITY_SMOOTHING: 0.1,
  LIFT_FOLLOW_SMOOTHING: 0.12,
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

export type IdealLiftTopInput = {
  lastClientY: number;
  grabPointerY: number;
  liftGrabOffsetY: number;
  liftInitialTop: number;
  deadZonePx?: number;
};

/** Hold lift fixed until scroll edge; then follow the pointer. */
export const computeIdealLiftTop = ({
  lastClientY,
  grabPointerY,
  liftGrabOffsetY,
  liftInitialTop,
  deadZonePx = SCROLL_HOLD.DEAD_ZONE_PX,
}: IdealLiftTopInput) => {
  const wantsDown = lastClientY > grabPointerY + deadZonePx;
  const wantsUp = lastClientY < grabPointerY - deadZonePx;
  const atTop = window.scrollY <= 0.5;
  const atBottom = window.scrollY >= maxScrollY() - 0.5;

  if ((atBottom && wantsDown) || (atTop && wantsUp)) {
    return lastClientY - liftGrabOffsetY;
  }

  return liftInitialTop;
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
