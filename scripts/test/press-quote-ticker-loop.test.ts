import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/project/ProjectPressQuoteTicker.astro', import.meta.url), 'utf8');
const measureBody = source.match(/const measure = \(\) => \{([\s\S]*?)\n    \};/)?.[1];
if (!measureBody) throw new Error('Could not extract ticker measure helper');
const setHelperBody = source.match(/const desiredPressTickerSets = \([^)]*\) => \{([\s\S]*?)\n  \};/)?.[1];
if (!setHelperBody) throw new Error('Could not extract ticker set helper');

const transpiler = new Bun.Transpiler({ loader: 'ts' });
const measureFactorySource = transpiler.transformSync(`
  const factory = (root, track, viewport, getComputedStyle) => {
    const desiredPressTickerSets = (viewportWidth, columnGap, loopWidth) => {${setHelperBody}\n};
    let loopWidth = 0;
    let phase = 0;
    const wrapPhase = (value) => loopWidth <= 0 ? value : ((value % loopWidth) + loopWidth) % loopWidth;
    const measure = () => {${measureBody}\n};
    return { measure, state: () => ({ loopWidth, phase }) };
  };
  factory;
`, { loader: 'ts' });
const makeMeasure = Function(`${measureFactorySource}; return factory;`)() as Function;

const makeTicker = (sourceCount: number, viewportWidth: number) => {
  const window = new Window();
  const root = window.document.createElement('section');
  root.dataset.pressTickerCount = String(sourceCount);
  const viewport = window.document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: viewportWidth, configurable: true });
  const track = window.document.createElement('div');
  for (let set = 0; set < 2; set += 1) {
    for (let index = 0; index < sourceCount; index += 1) {
      const item = window.document.createElement('article');
      item.dataset.pressTickerItem = '';
      item.dataset.pressTickerSource = String(index);
      Object.defineProperty(item, 'offsetLeft', { value: (set * sourceCount + index) * 280, configurable: true });
      const link = window.document.createElement('a');
      item.append(link);
      track.append(item);
    }
  }
  viewport.append(track);
  root.append(viewport);
  const runtime = makeMeasure(root, track, viewport, () => ({ columnGap: '56px', gap: '56px' }));
  return { track, viewport, measure: runtime.measure };
};

test('measure adds enough complete source sets for narrow, normal, and wide viewports', () => {
  for (const [sourceCount, viewportWidth, expectedSets] of [[1, 320, 3], [2, 750, 3], [5, 1600, 3]]) {
    const { track, measure } = makeTicker(sourceCount, viewportWidth);
    measure();
    assert.equal(track.querySelectorAll('[data-press-ticker-item]').length, sourceCount * expectedSets);
  }
});

test('repeat measurement preserves generated nodes, then removes excess sets on resize', () => {
  const { track, viewport, measure } = makeTicker(2, 750);
  measure();
  const generated = [...track.querySelectorAll('[data-press-ticker-generated]')];
  measure();
  assert.deepEqual([...track.querySelectorAll('[data-press-ticker-generated]')], generated);

  Object.defineProperty(viewport, 'clientWidth', { value: 320, configurable: true });
  measure();
  assert.equal(track.querySelectorAll('[data-press-ticker-generated]').length, 0);
  assert.equal(track.querySelectorAll('[data-press-ticker-item]').length, 4);
});

test('generated clones are hidden and every cloned link is unfocusable', () => {
  const { track, measure } = makeTicker(2, 750);
  measure();
  const generated = [...track.querySelectorAll<HTMLElement>('[data-press-ticker-generated]')];
  assert.equal(generated.length, 2);
  generated.forEach((item) => {
    assert.equal(item.getAttribute('aria-hidden'), 'true');
    assert.equal(item.querySelector('a')?.tabIndex, -1);
  });
});

test('measure retains the true source period when more sets are present', () => {
  const { track, measure } = makeTicker(2, 1600);
  measure();
  const firstSet = [...track.querySelectorAll<HTMLElement>('[data-press-ticker-item]')].slice(0, 2);
  assert.equal(firstSet[0].offsetLeft, 0);
  assert.equal(firstSet[1].offsetLeft, 280);
  assert.equal(track.querySelectorAll('[data-press-ticker-item]').length, 8);
});
