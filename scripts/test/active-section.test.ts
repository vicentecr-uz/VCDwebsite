import { expect, test } from 'bun:test';
import { activeSectionId } from '../../src/lib/activeSection';

const sections = (tops: number[]) => tops.map((top, index) => ({ id: `section-${index}`, top }));
const page = { viewportHeight: 1000, documentHeight: 5000 };

test('initial ramp starts at the top and gradually advances the activation point', () => {
  const headings = sections([0, 220, 300]);
  expect(activeSectionId(headings, { ...page, scrollY: 0 })).toBe('section-0');
  expect(activeSectionId(headings, { ...page, scrollY: 119 })).toBe('section-0');
  expect(activeSectionId(headings, { ...page, scrollY: 120 })).toBe('section-1');
  expect(activeSectionId(headings, { ...page, scrollY: -20 })).toBe('section-0');
});

test('middle of the page holds activation one quarter of the viewport down', () => {
  const headings = sections([0, 1250, 2000]);
  expect(activeSectionId(headings, { ...page, scrollY: 999 })).toBe('section-0');
  expect(activeSectionId(headings, { ...page, scrollY: 1000 })).toBe('section-1');
  expect(activeSectionId(headings, { ...page, scrollY: 1749 })).toBe('section-1');
  expect(activeSectionId(headings, { ...page, scrollY: 1750 })).toBe('section-2');
});

test('end ramp makes each short trailing section selectable in both scroll directions', () => {
  const headings = sections([3900, 4200, 4400, 4600, 4800]);
  const positions = [3750, 3820, 3870, 3920, 3970];
  const selected = positions.map(scrollY => activeSectionId(headings, { ...page, scrollY }));
  expect(selected).toEqual(headings.map(heading => heading.id));
  expect([...positions].reverse().map(scrollY => activeSectionId(headings, { ...page, scrollY }))).toEqual([...selected].reverse());
});

test('bottom tolerance forces the final section even if its heading is below the pivot', () => {
  const headings = sections([0, 7000]);
  expect(activeSectionId(headings, { ...page, scrollY: 3997 })).toBe('section-0');
  expect(activeSectionId(headings, { ...page, scrollY: 3998 })).toBe('section-1');
  expect(activeSectionId(headings, { ...page, scrollY: 4020 })).toBe('section-1');
});

test('empty, single-section and non-scrolling pages preserve project navigation behaviour', () => {
  expect(activeSectionId([], { ...page, scrollY: 0 })).toBeUndefined();
  expect(activeSectionId(sections([80]), { ...page, scrollY: 0 })).toBe('section-0');
  expect(activeSectionId(sections([20, 240, 450]), { viewportHeight: 600, documentHeight: 500, scrollY: 0 })).toBe('section-2');
  expect(activeSectionId(sections([20, 240, 450]), { viewportHeight: 600, documentHeight: 600, scrollY: 0 })).toBe('section-2');
});

test('configured project ramp settings retain their exact activation thresholds', () => {
  const options = { ...page, earlyRampVh: 0.1, holdVh: 0.5, endRampVh: 0.4 };
  expect(activeSectionId(sections([0, 300]), { ...options, scrollY: 49 })).toBe('section-0');
  expect(activeSectionId(sections([0, 300]), { ...options, scrollY: 50 })).toBe('section-1');
  expect(activeSectionId(sections([0, 1500]), { ...options, scrollY: 1000 })).toBe('section-1');
  expect(activeSectionId(sections([0, 4544]), { ...options, scrollY: 3800 })).toBe('section-1');
  expect(activeSectionId(sections([0, 100]), { ...page, earlyRampVh: 0, holdVh: 0, endRampVh: 0, scrollY: 100 })).toBe('section-1');
});
