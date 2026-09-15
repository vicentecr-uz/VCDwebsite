export interface CarouselDragTuning {
  tension: number;
  dragThreshold: number;
  springBackMs: number;
}

export const CAROUSEL_DRAG_TUNING_DEFAULTS: CarouselDragTuning = {
  tension: 20,
  dragThreshold: 4,
  springBackMs: 260,
};

export function normalizeCarouselDragTuning(value: unknown): CarouselDragTuning {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const number = (key: keyof CarouselDragTuning, min: number, max: number) => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : CAROUSEL_DRAG_TUNING_DEFAULTS[key];
  };
  return {
    tension: number('tension', 1, 80),
    dragThreshold: number('dragThreshold', 0, 40),
    springBackMs: number('springBackMs', 80, 600),
  };
}

export function carouselRubberbandGive(overflow: number, tuning: CarouselDragTuning): number {
  const distance = Math.max(0, Math.abs(overflow) - tuning.dragThreshold);
  if (!distance) return 0;
  // 2.5px is the fixed visual ceiling; tension controls diminishing marginal give.
  return Math.sign(overflow) * 2.5 * distance / (tuning.tension + distance);
}
