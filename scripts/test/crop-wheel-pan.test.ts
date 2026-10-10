import { expect, test } from 'bun:test';
import { createCropWheelPanGain, createCropWheelZoomGain } from '../../src/lib/cropWheelPan';

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

test('zoom gain keeps fine, medium, and fast endpoints', () => {
  const gain = createCropWheelZoomGain();
  expect(gain.gainFor(4, 0, 0)).toBeCloseTo(0.00085, 10);
  expect(gain.gainFor(20, 0, 1000 / 60)).toBeGreaterThan(0.00085);
  expect(gain.gainFor(2400, 0, 2 * 1000 / 60)).toBeCloseTo(0.0044, 10);
});

test('zoom gain resets after idle and has comparable 60/120Hz travel', () => {
  const fresh = createCropWheelZoomGain(140);
  const idle = createCropWheelZoomGain(140);
  idle.gainFor(20, 0, 0);
  expect(idle.gainFor(20, 0, 1000)).toBeCloseTo(fresh.gainFor(20, 0, 0), 10);
  const travel = (rate: number) => {
    const gain = createCropWheelZoomGain();
    let total = 0;
    const delta = 1200 / rate;
    for (let index = 0; index < rate; index += 1) total += delta * gain.gainFor(0, delta, index * 1000 / rate);
    return total;
  };
  expect(Math.abs(travel(60) - travel(120)) / travel(60)).toBeLessThan(0.02);
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
