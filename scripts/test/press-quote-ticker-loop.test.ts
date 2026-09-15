import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../../src/components/project/ProjectPressQuoteTicker.astro', import.meta.url), 'utf8');
const helper = source.match(/const desiredPressTickerSets = \(([^\n]+)\) => \{([\s\S]*?)\n  \};/);
if (!helper) throw new Error('Could not extract ticker set helper');
const desiredPressTickerSets = Function(`return (${helper[1].replaceAll(': number', '')}) => {${helper[2]}\n}`)() as (
  viewportWidth: number,
  columnGap: number,
  loopWidth: number,
) => number;

test('ticker coverage reserves a full extra set beyond the viewport', () => {
  assert.equal(desiredPressTickerSets(750, 56, 560), 3);
  assert.equal(desiredPressTickerSets(320, 56, 560), 2);
  assert.equal(desiredPressTickerSets(1600, 56, 560), 4);
});

test('ticker set calculation is stable across repeated measurements and zero geometry', () => {
  assert.equal(desiredPressTickerSets(750, 56, 560), desiredPressTickerSets(750, 56, 560));
  assert.equal(desiredPressTickerSets(0, 56, 560), 2);
  assert.equal(desiredPressTickerSets(750, 56, 0), 2);
});

test('generated ticker clones are hidden and unfocusable', () => {
  assert.match(source, /data-press-ticker-generated/);
  assert.match(source, /clone\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(source, /clone\.querySelectorAll<HTMLAnchorElement>\('a'\)\.forEach\(\(link\) => \{ link\.tabIndex = -1; \}\)/);
  assert.match(source, /track\.querySelectorAll<HTMLElement>\('\[data-press-ticker-generated\]'\)\.forEach\(\(item\) => item\.remove\(\)\)/);
});
