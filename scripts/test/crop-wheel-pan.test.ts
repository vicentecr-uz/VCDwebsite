import { expect, test } from 'bun:test';
import { createCropWheelPanGain } from '../../src/lib/cropWheelPan';

const travel = (count: number, delta: number, interval: number) => {
  const gain = createCropWheelPanGain();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const current = delta * gain.gainFor(delta, 0, index * interval);
    total += current;
  }
  return total;
};

test('60Hz events preserve the original pan acceleration', () => {
  const gain = createCropWheelPanGain();
  let speed = 0;
  for (let i = 0; i < 12; i += 1) {
    speed += (20 - speed) * 0.32;
    const t = Math.min(1, speed / 40);
    expect(gain.gainFor(20, 0, i * 1000 / 60)).toBeCloseTo(0.38 + 0.62 * t * t * (3 - 2 * t), 10);
  }
});

test('equal velocity at common frame rates has near-equal travel', () => {
  for (const velocity of [120, 1200, 2400]) {
    const distances = [30, 60, 120, 144].map((rate) => travel(rate, velocity / rate, 1000 / rate));
    expect((Math.max(...distances) - Math.min(...distances)) / Math.min(...distances)).toBeLessThan(0.02);
  }
});

test('first event, idle reset, and invalid timestamps stay finite', () => {
  const gain = createCropWheelPanGain(140);
  expect(gain.gainFor(10, 0, Number.NaN)).toBeCloseTo(0.39126912, 6);
  gain.gainFor(10, 0, 100);
  expect(gain.gainFor(10, 0, 1000)).toBe(createCropWheelPanGain(140).gainFor(10, 0, 1000));
  expect(gain.gainFor(0, 0, 1016)).toBeGreaterThanOrEqual(0.38);
  gain.reset();
  expect(gain.gainFor(10, 0, 0)).toBeGreaterThanOrEqual(0.38);
});
