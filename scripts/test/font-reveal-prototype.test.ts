import { expect, test } from 'bun:test';
import { scheduleGlyphReveal, shuffleGlyphs, splitGraphemes } from '../../src/scripts/fontRevealPrototype';

test('splits emoji and combining marks into graphemes', () => {
  expect(splitGraphemes('A👩‍🚀é')).toEqual(['A', '👩‍🚀', 'é']);
});

test('schedules a bounded late-accelerating reveal', () => {
  const schedule = scheduleGlyphReveal(4, 4000);
  expect(schedule).toHaveLength(4);
  expect(schedule[0]).toBe(0);
  expect(schedule[3]).toBeLessThan(4000);
  expect(schedule[1] - schedule[0]).toBeLessThan(schedule[3] - schedule[2]);
});

test('shuffles without changing the glyph set', () => {
  expect(shuffleGlyphs(['a', 'b', 'c', 'd'], () => 0)).toEqual(['b', 'c', 'd', 'a']);
});
