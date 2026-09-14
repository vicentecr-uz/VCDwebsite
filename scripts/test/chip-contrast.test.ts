import assert from 'node:assert/strict';
import test from 'node:test';

import { chipContrastFill, type Rgba } from '../../src/scripts/chipContrast';

const darkInk: Rgba = { r: 32, g: 32, b: 32, a: 1 };
const lightInk: Rgba = { r: 240, g: 240, b: 240, a: 1 };

function independentContrast(pixel: number, ink: Rgba, fill: 0 | 255, opacity: number, factor: number): number {
  const background = pixel * factor;
  const surface = fill * opacity + background * (1 - opacity);
  const text = ink.r * ink.a + surface * (1 - ink.a);
  const luminance = (value: number) => {
    const encoded = value / 255;
    return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
  };
  const textLuma = luminance(text);
  const surfaceLuma = luminance(surface);
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
  for (const pixel of [0, 255]) {
    for (const factor of [1, 1.12]) {
      assert.ok(independentContrast(pixel, darkInk, result.color, result.opacity, factor) >= 4.5);
    }
  }
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
