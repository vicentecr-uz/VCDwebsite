import { expect, test } from 'bun:test';
import { carouselRubberbandGive, normalizeCarouselDragTuning } from '../../src/lib/carouselDragTuning';

const tuning = normalizeCarouselDragTuning({ tension: 20, dragThreshold: 4, springBackMs: 260 });

test('rubberband give preserves sign, threshold, ceiling, and diminishing increments', () => {
  expect(carouselRubberbandGive(-4, tuning)).toBe(0);
  expect(carouselRubberbandGive(20, tuning)).toBeGreaterThan(0);
  expect(carouselRubberbandGive(-20, tuning)).toBeLessThan(0);
  expect(Math.abs(carouselRubberbandGive(10_000, tuning))).toBeLessThanOrEqual(2.5);
  const first = carouselRubberbandGive(24, tuning) - carouselRubberbandGive(14, tuning);
  const second = carouselRubberbandGive(34, tuning) - carouselRubberbandGive(24, tuning);
  expect(first).toBeGreaterThan(second);
});
