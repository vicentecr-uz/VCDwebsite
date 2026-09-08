import { describe, expect, test } from 'bun:test';
import { HOME_REVEAL_DURATION, HOME_REVEAL_EASING, HOME_REVEAL_STAGGER, groupHomeRevealRows } from '../../src/lib/homeReveal';

describe('home reveal choreography', () => {
  test('groups equal-top units and delays the final row across the specified span', () => {
    const rows = groupHomeRevealRows([
      { top: 300, left: 20 }, { top: 100, left: 40 }, { top: 101, left: 10 }, { top: 500, left: 0 },
    ]);
    expect(rows.map((row) => row.units.length)).toEqual([2, 1, 1]);
    expect(rows[0].delay).toBe(0);
    expect(rows.at(-1)?.delay).toBeCloseTo(HOME_REVEAL_STAGGER, 5);
    expect((rows.at(-1)?.delay ?? 0) + HOME_REVEAL_DURATION).toBeCloseTo(1000, 2);
  });

  test('keeps the exact WAAPI timing contract', () => {
    expect(HOME_REVEAL_DURATION).toBe(449.28);
    expect(HOME_REVEAL_STAGGER).toBe(550.72);
    expect(HOME_REVEAL_EASING).toContain('linear(0 0%, 0.006234 1%');
    expect(HOME_REVEAL_EASING).toContain('1.000058 50%)');
  });
});
