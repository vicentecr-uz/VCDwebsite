import assert from 'node:assert/strict';
import { introLayout, introRun, normalizeIntroHeight, resolveIntroHeight } from '../../src/lib/projectIntro.ts';
import { reorderProjectStackSpacings } from '../../src/lib/projectStack.ts';

assert.equal(normalizeIntroHeight(80.4), 80);
assert.equal(normalizeIntroHeight('bad'), 75);
assert.equal(introRun([
  { type: 'bodyText', intro: true },
  { type: 'sectionTitle', intro: true },
  { type: 'image' },
  { type: 'bodyText', intro: true },
]).map((run) => run.length).join(','), '2,1');
assert.equal(resolveIntroHeight(undefined, [{ introHeight: 60 }]), 60);
assert.equal(resolveIntroHeight(undefined, [{}, { introHeight: 80 }]), 80);
assert.equal(resolveIntroHeight(80, [{ introHeight: 60 }]), 80);

const layout = introLayout(60, 1000, 200);
assert.equal(layout.targetPx, 600);
assert.equal(layout.flexibleAirPx, 400);
assert.equal(layout.outerGapPx, 200);
assert.equal(introLayout(100, 1000, 1000).flexibleAirPx, 0);
assert.equal(introLayout(80, 1000, 100).outerGapPx, 350);

assert.deepEqual(
  reorderProjectStackSpacings(['none', 'group', 'related'], 1, 0),
  ['related', 'none', 'group'],
);
assert.deepEqual(
  reorderProjectStackSpacings(['none', 'group', 'major'], 0, 2),
  ['related', 'none', 'major'],
);
assert.deepEqual(
  reorderProjectStackSpacings(['none', 'group', 'related', 'section'], 1, 2),
  ['none', 'related', 'group', 'section'],
);

console.log('project-intro: ok');
