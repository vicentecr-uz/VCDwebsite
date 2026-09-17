import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(import.meta.dir, '../../src/styles/project.css'), 'utf8');

const percentage = (value: string) => Number(value.replace('%', ''));

const maskStops = [...css.matchAll(
  /#000\s+calc\(var\(--preview-reveal-y\) - ([\d.]+)%\),\s*transparent\s+calc\(var\(--preview-reveal-y\) \+ ([\d.]+)%\)/g,
)].map((match) => ({
  blackOffset: Number(match[1]),
  transparentOffset: Number(match[2]),
}));

const initial = percentage(css.match(/initial-value:\s*(-?[\d.]+%)/)?.[1] ?? 'NaN%');
const base = percentage(css.match(/--preview-reveal-y:\s*(-?[\d.]+%);/)?.[1] ?? 'NaN%');
const final = percentage(css.match(/\.is-revealing\s*\{\s*--preview-reveal-y:\s*(-?[\d.]+%);/)?.[1] ?? 'NaN%');

const alphaAt = (position: number, reveal: number, feather: number) => {
  const blackStop = reveal - feather;
  const transparentStop = reveal + feather;
  if (position <= blackStop) return 1;
  if (position >= transparentStop) return 0;
  return (transparentStop - position) / (transparentStop - blackStop);
};

test('preview reveal mask covers the complete image at both endpoints', () => {
  expect(initial).toBe(-22);
  expect(base).toBe(initial);
  expect(final).toBe(122);
  expect(maskStops).toEqual([
    { blackOffset: 22, transparentOffset: 22 },
    { blackOffset: 22, transparentOffset: 22 },
  ]);
  expect(css).not.toMatch(/max\(0%,\s*calc\(var\(--preview-reveal-y\)/);
  expect(css).not.toMatch(/min\(100%,\s*calc\(var\(--preview-reveal-y\)/);

  const feather = maskStops[0].blackOffset;
  for (const position of Array.from({ length: 101 }, (_, index) => index)) {
    expect(alphaAt(position, initial, feather)).toBe(0);
    expect(alphaAt(position, final, feather)).toBe(1);
  }
});

test('preview reveal alpha changes monotonically through a continuous fade', () => {
  const feather = maskStops[0].blackOffset;
  const reveals = Array.from({ length: 17 }, (_, index) => initial + ((final - initial) * index) / 16);
  let hasIntermediateAlpha = false;

  for (const position of [0, 25, 50, 75, 100]) {
    const alphas = reveals.map((reveal) => alphaAt(position, reveal, feather));
    for (let index = 1; index < alphas.length; index += 1) {
      expect(alphas[index]).toBeGreaterThanOrEqual(alphas[index - 1]);
      expect(alphas[index] - alphas[index - 1]).toBeLessThanOrEqual(0.5);
    }
    hasIntermediateAlpha ||= alphas.some((alpha) => alpha > 0 && alpha < 1);
  }

  expect(hasIntermediateAlpha).toBe(true);
});
