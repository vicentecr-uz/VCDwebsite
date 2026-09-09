import { describe, expect, test } from 'bun:test';
import { CUBIC_EASING_PRESETS, SPRING_EASING_PRESETS, generateSpringEasing, presetEasing, springDurationMs } from '../../src/lib/easingDevPresets';

describe('easing.dev presets', () => {
  test('contains the complete named preset sets', () => {
    expect(new Set(CUBIC_EASING_PRESETS.map(({ name }) => name)).size).toBe(28);
    expect(new Set(SPRING_EASING_PRESETS.map(({ name }) => name)).size).toBe(10);
  });

  test('formats cubic presets as CSS cubic-bezier values', () => {
    expect(presetEasing(CUBIC_EASING_PRESETS.find(({ name }) => name === 'Quick Out')!)).toBe('cubic-bezier(0, 0, 0.2, 1)');
    expect(presetEasing(CUBIC_EASING_PRESETS.find(({ name }) => name === 'Overshoot Out')!)).toBe('cubic-bezier(0.175, 0.885, 0.32, 1.275)');
  });

  test('matches easing.dev spring duration and curve landmarks', () => {
    const slow = SPRING_EASING_PRESETS.find(({ name }) => name === 'Slow')!;
    const elegant = SPRING_EASING_PRESETS.find(({ name }) => name === 'Elegant')!;
    expect(springDurationMs(slow)).toBe(449.28);
    expect(springDurationMs(elegant)).toBe(581.71);
    expect(generateSpringEasing(slow)).toStartWith('linear(0 0%, 0.006234 1%, 0.023295 2%, 0.04897 3%');
    expect(generateSpringEasing(elegant)).toStartWith('linear(0 0%, 0.005927 1%, 0.022466 2%');
  });

  test('every spring curve is deterministic CSS linear easing', () => {
    for (const preset of SPRING_EASING_PRESETS) {
      const curve = generateSpringEasing(preset);
      expect(curve).toStartWith('linear(0 0%');
      expect(curve).toMatch(/^linear\(-?\d+(?:\.\d+)? \d+(?:\.\d+)?%, /);
      expect(curve).toEndWith(')');
    }
  });
});
