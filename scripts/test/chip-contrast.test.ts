import assert from 'node:assert/strict';
import test from 'node:test';

import { chipContrastFill, type Rgba } from '../../src/scripts/chipContrast';

const darkInk: Rgba = { r: 109, g: 109, b: 109, a: 1 };
const lightInk: Rgba = { r: 245, g: 245, b: 245, a: 1 };

function independentContrast(pixel: [number, number, number], ink: Rgba, fill: 0 | 255, opacity: number, factor: number): number {
  const background = pixel.map((channel) => Math.min(255, channel * factor));
  const surface = background.map((channel) => fill * opacity + channel * (1 - opacity));
  const text = surface.map((channel, index) => [ink.r, ink.g, ink.b][index] * ink.a + channel * (1 - ink.a));
  const luminance = (value: number) => {
    const encoded = value / 255;
    return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
  };
  const textLuma = 0.2126 * luminance(text[0]) + 0.7152 * luminance(text[1]) + 0.0722 * luminance(text[2]);
  const surfaceLuma = 0.2126 * luminance(surface[0]) + 0.7152 * luminance(surface[1]) + 0.0722 * luminance(surface[2]);
  return (Math.max(textLuma, surfaceLuma) + 0.05) / (Math.min(textLuma, surfaceLuma) + 0.05);
}

test('returns no fill when ordinary backgrounds already meet contrast', () => {
  assert.deepEqual(chipContrastFill(new Uint8ClampedArray([245, 245, 245, 255]), darkInk, [1.06, 1.12]), { color: 255, opacity: 0 });
  assert.deepEqual(chipContrastFill(new Uint8ClampedArray([20, 20, 20, 255]), lightInk, [1.06, 1.12]), { color: 0, opacity: 0 });
});

test('protects mixed backgrounds with the least neutral fill opacity', () => {
  const result = chipContrastFill(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), darkInk, [1, 1.12]);
  assert.equal(result.color, 255);
  assert.ok(result.opacity > 0 && result.opacity <= 1);
  assert.equal(result.opacity, Math.ceil(result.opacity * 1000) / 1000);
  for (const pixel of [[0, 0, 0], [255, 255, 255], [20, 90, 180]] as [number, number, number][]) {
    for (const factor of [1, 1.12]) {
      assert.ok(independentContrast(pixel, darkInk, result.color, result.opacity, factor) >= 4.5);
    }
  }
  assert.ok(independentContrast([0, 0, 0], darkInk, result.color, Math.max(0, result.opacity - 0.003), 1) < 4.5);
});

test('checks both brightness states for coloured backgrounds and alpha ink', () => {
  const ink = { ...lightInk, b: 247, a: 0.8 };
  const pixels: [number, number, number][] = [[170, 100, 40], [109, 109, 109]];
  const result = chipContrastFill(new Uint8ClampedArray(pixels.flatMap(pixel => [...pixel, 255])), ink, [1.06, 1.12]);
  assert.equal(result.color, 0);
  assert.ok(Number.isFinite(result.opacity) && result.opacity >= 0 && result.opacity <= 1);
  for (const pixel of pixels) {
    for (const factor of [1.06, 1.12]) {
      assert.ok(independentContrast(pixel, ink, result.color, result.opacity, factor) >= 4.5);
    }
  }
});

test('returns a bounded ceiling when full fill cannot meet contrast', () => {
  const result = chipContrastFill(new Uint8ClampedArray([255, 255, 255, 255]), { ...lightInk, a: 0.1 }, [1, 1.12]);
  assert.deepEqual(result, { color: 0, opacity: 1 });
});

test('handles empty samples and a shared brightness factor', () => {
  assert.deepEqual(chipContrastFill(new Uint8ClampedArray(), lightInk, [1.06]), { color: 0, opacity: 0 });
  assert.deepEqual(chipContrastFill(new Uint8ClampedArray([20, 20, 20, 255]), lightInk, [1.06]), { color: 0, opacity: 0 });
});

test('tolerates five percent outliers but protects larger difficult regions in either theme', () => {
  for (const [ink, ordinary, difficult] of [
    [darkInk, 245, 109],
    [lightInk, 20, 245],
  ] as const) {
    const sample = (outliers: number) => new Uint8ClampedArray(Array.from({ length: 100 }, (_, index) => {
      const channel = index < outliers ? difficult : ordinary;
      return [channel, channel, channel, 255];
    }).flat());
    assert.equal(chipContrastFill(sample(5), ink, [1.06, 1.12]).opacity, 0);
    const result = chipContrastFill(sample(6), ink, [1.06, 1.12]);
    assert.ok(result.opacity > 0);
    for (const factor of [1.06, 1.12]) {
      assert.ok(independentContrast([difficult, difficult, difficult], ink, result.color, result.opacity, factor) >= 4.5);
    }
  }
});

test('counts each outlier once across brightness states and rounds the allowance down', () => {
  const sample = (count: number) => new Uint8ClampedArray(Array.from({ length: count }, (_, index) => {
    const channel = index === 0 ? 109 : 245;
    return [channel, channel, channel, 255];
  }).flat());
  assert.equal(chipContrastFill(sample(20), darkInk, [1.06, 1.12]).opacity, 0);
  assert.ok(chipContrastFill(sample(19), darkInk, [1.06, 1.12]).opacity > 0);
});
