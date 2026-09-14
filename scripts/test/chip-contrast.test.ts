import assert from 'node:assert/strict';
import test from 'node:test';

import { chipContrastFill, type Rgba } from '../../src/scripts/chipContrast';

const darkInk: Rgba = { r: 109, g: 109, b: 109, a: 1 };
const lightInk: Rgba = { r: 245, g: 245, b: 245, a: 1 };

function independentContrast(pixel: [number, number, number], ink: Rgba, fill: 0 | 255, opacity: number, factor: number): number {
  const background = pixel.map((channel) => Math.min(255, channel * factor));
  const surface = background.map((channel) => fill * opacity + channel * (1 - opacity));
  const text = surface.map((channel) => ink.r * ink.a + channel * (1 - ink.a));
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

test('checks rest and hover brightness states and supports alpha ink', () => {
  const result = chipContrastFill(new Uint8ClampedArray([109, 109, 109, 255]), { ...darkInk, a: 0.8 }, [1.06, 1.12]);
  assert.equal(result.color, 255);
  assert.ok(Number.isFinite(result.opacity) && result.opacity >= 0 && result.opacity <= 1);
});

test('returns a bounded ceiling when full fill cannot meet contrast', () => {
  const result = chipContrastFill(new Uint8ClampedArray([255, 255, 255, 255]), { ...lightInk, a: 0.1 }, [1, 1.12]);
  assert.deepEqual(result, { color: 0, opacity: 1 });
});

test('handles empty samples and a shared brightness factor', () => {
  assert.deepEqual(chipContrastFill(new Uint8ClampedArray(), lightInk, [1.06]), { color: 0, opacity: 0 });
  assert.deepEqual(chipContrastFill(new Uint8ClampedArray([20, 20, 20, 255]), lightInk, [1.06]), { color: 0, opacity: 0 });
});
