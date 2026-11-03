import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(import.meta.dir, '../../src/styles/project.css'), 'utf8');

const featherToken = '--preview-reveal-feather';
const defaultFeather = Number(css.match(/--preview-reveal-feather:\s*([\d.]+)%;/)?.[1]);
const endpoints = [...css.matchAll(/--preview-reveal-y:\s*(calc\([^;]+\));/g)].map(match => match[1]);
const resolveEndpoint = (expression: string, feather: number) => {
  const sum = expression.replace(`var(${featherToken})`, `${feather}%`).slice(5, -1);
  expect(sum).toMatch(/^\d+% [+-] [\d.]+%$/);
  return [...sum.matchAll(/[+-]?\s*[\d.]+%/g)]
    .reduce((total, match) => total + Number.parseFloat(match[0].replace(/\s/g, '')), 0);
};
const maskStops = [...css.matchAll(
  /#000\s+calc\(var\(--preview-reveal-y\) - var\((--[\w-]+)\)\),\s*transparent\s+calc\(var\(--preview-reveal-y\) \+ var\((--[\w-]+)\)\)/g,
)].map(match => [match[1], match[2]]);
const initial = -defaultFeather;
const final = 100 + defaultFeather;

const alphaAt = (position: number, reveal: number, feather: number) => {
  const blackStop = reveal - feather;
  const transparentStop = reveal + feather;
  if (position <= blackStop) return 1;
  if (position >= transparentStop) return 0;
  return (transparentStop - position) / (transparentStop - blackStop);
};

test('one feather token drives both mask stops and overshoot endpoints', () => {
  expect(defaultFeather).toBe(22);
  expect(maskStops).toEqual([[featherToken, featherToken], [featherToken, featherToken]]);
  expect(endpoints).toEqual([
    `calc(0% - var(${featherToken}))`,
    `calc(100% + var(${featherToken}))`,
    `calc(100% + var(${featherToken}))`,
  ]);
  const registered = css.match(/@property --preview-reveal-y\s*\{([^}]+)\}/)![1];
  expect(registered).toContain('initial-value: 0%');
  expect(registered).not.toContain('var(');
  expect(css).not.toMatch(/max\(0%,\s*calc\(var\(--preview-reveal-y\)/);
  expect(css).not.toMatch(/min\(100%,\s*calc\(var\(--preview-reveal-y\)/);

  for (const feather of [8, 22, 35, 60]) {
    const start = resolveEndpoint(endpoints[0], feather);
    const end = resolveEndpoint(endpoints[1], feather);
    for (const position of Array.from({ length: 101 }, (_, index) => index)) {
      expect(alphaAt(position, start, feather)).toBe(0);
      expect(alphaAt(position, end, feather)).toBe(1);
    }
  }
});

test('preview reveal alpha changes monotonically through a continuous fade', () => {
  const feather = defaultFeather;
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

test('inverse feather preserves opaque pixels and translucent shadows when added', () => {
  const inverseStops = [...css.matchAll(
    /transparent\s+calc\(var\(--preview-reveal-y\) - var\((--[\w-]+)\)\),\s*#000\s+calc\(var\(--preview-reveal-y\) \+ var\((--[\w-]+)\)\)/g,
  )];
  expect(inverseStops.map(match => [match[1], match[2]])).toEqual([[featherToken, featherToken], [featherToken, featherToken]]);
  expect(css).toMatch(/isolation:\s*isolate/);
  expect(css).toMatch(/mix-blend-mode:\s*plus-lighter/);
  for (const alpha of [0, 0.05, 0.3, 1]) {
    for (const progress of [initial, 0, 25, 50, 75, 100, final]) {
      for (const position of [0, 25, 50, 75, 100]) {
        const highCoverage = alphaAt(position, progress, defaultFeather);
        const lowCoverage = 1 - highCoverage;
        expect(alpha * lowCoverage + alpha * highCoverage).toBeCloseTo(alpha, 12);
      }
    }
  }
});
