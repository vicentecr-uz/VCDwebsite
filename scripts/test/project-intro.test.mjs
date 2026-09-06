import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { introLayout, introRun, normalizeIntroHeight, resolveIntroHeight } from '../../src/lib/projectIntro.ts';
import {
  canonicalizeProjectStackSpacing,
  projectStackClass,
  resolveProjectStackSpacing,
  setProjectStackSpacingAtViewport,
  reorderProjectStackSpacings,
  reorderProjectStackSpacingSeams,
  shouldKeepLeadingSpacingSeam,
} from '../../src/lib/projectStack.ts';
import { ADAPTIVE_PAGE_COLUMNS_ENABLED, pageColumnStyle } from '../../src/lib/pageColumn.ts';
import { resolveGapLaneSide } from '../../src/scripts/sectionReorder.ts';

const headerSource = readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
const projectBodyText = readFileSync(new URL('../../src/components/project/ProjectBodyText.astro', import.meta.url), 'utf8');
const projectSectionTitle = readFileSync(new URL('../../src/components/project/ProjectSectionTitle.astro', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
const projectCss = readFileSync(new URL('../../src/styles/project.css', import.meta.url), 'utf8');

assert.deepEqual(resolveProjectStackSpacing({ desktop: 'section', mobile: 'none' }), {
  desktop: 'section', tablet: 'section', mobile: 'none',
});
assert.deepEqual(canonicalizeProjectStackSpacing({ desktop: 'section', tablet: 'section', mobile: 'none' }), {
  desktop: 'section', mobile: 'none',
});
assert.equal(projectStackClass({ desktop: 'section', mobile: 'none' }), 'project-stack--section project-stack--mobile-none');
assert.deepEqual(setProjectStackSpacingAtViewport(
  { desktop: 'section', tablet: 'group', mobile: 'none' }, 'desktop', 'major',
), { desktop: 'major', tablet: 'major', mobile: 'major' });
assert.deepEqual(setProjectStackSpacingAtViewport(
  { desktop: 'section', tablet: 'group', mobile: 'none' }, 'tablet', 'related',
), { desktop: 'section', tablet: 'related', mobile: 'related' });
assert.deepEqual(setProjectStackSpacingAtViewport(
  { desktop: 'section', tablet: 'group', mobile: 'none' }, 'mobile', 'major',
), { desktop: 'section', tablet: 'group', mobile: 'major' });
assert.deepEqual(resolveProjectStackSpacing({ desktop: 'bad', tablet: 'group', mobile: 4 }), {
  desktop: 'section', tablet: 'group', mobile: 'group',
});
assert.throws(() => canonicalizeProjectStackSpacing({ toString: 'none' }));
assert.throws(() => canonicalizeProjectStackSpacing({ __proto__: 'none' }));
assert.equal(canonicalizeProjectStackSpacing({ desktop: 'section', tablet: 'section', mobile: 'section' }), 'section');

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

assert.equal(ADAPTIVE_PAGE_COLUMNS_ENABLED, false);
assert.match(layoutSource, /style=\{ADAPTIVE_PAGE_COLUMNS_ENABLED \? columnStyle : undefined\}/);
assert.match(layoutSource, /showDevTools && ADAPTIVE_PAGE_COLUMNS_ENABLED && <DevPageColumn \/>/);
assert.match(headerSource, /if \(!adaptivePageColumnsEnabled \|\| !siteWrapper\) return;/);
assert.match(globalCss, /--page-text-max-width: 37\.5em;[\s\S]*?--page-media-max-width: 50em;/);
assert.match(projectCss, /\.project-block--text\s*\{[\s\S]*?max-width: var\(--page-text-max-width\);[\s\S]*?margin-inline: 0 auto;/);
assert.match(projectBodyText, /'project-block--text'/);
assert.match(projectSectionTitle, /'project-block--text'/);
assert.equal(
  pageColumnStyle([{ type: 'bodyText' }]),
  '--page-max-width: var(--page-text-max-width); --page-header-width: var(--page-text-max-width)',
);
assert.equal(pageColumnStyle([{ type: 'projectGrid' }]), undefined);
assert.equal(
  pageColumnStyle([{ type: 'imageGrid', constrained: { desktop: 50, tablet: 50, mobile: 50 } }]),
  '--page-max-width: max(var(--page-text-max-width), calc(var(--page-media-max-width) * 0.5)); --page-header-width: calc(var(--page-media-max-width) * 0.5)',
);

assert.equal(resolveGapLaneSide(100, 200, 124, 1, 'before'), 'before');
assert.equal(resolveGapLaneSide(100, 200, 125, 1, 'before'), 'after');
assert.equal(resolveGapLaneSide(100, 200, 176, -1, 'after'), 'after');
assert.equal(resolveGapLaneSide(100, 200, 175, -1, 'after'), 'before');
assert.equal(resolveGapLaneSide(200, 600, 299, 1, 'before'), 'before');
assert.equal(resolveGapLaneSide(200, 600, 300, 1, 'before'), 'after');
assert.equal(resolveGapLaneSide(200, 600, 501, -1, 'after'), 'after');
assert.equal(resolveGapLaneSide(200, 600, 500, -1, 'after'), 'before');
assert.equal(shouldKeepLeadingSpacingSeam(128, 64, false, true), true);
assert.equal(shouldKeepLeadingSpacingSeam(64, 128, true, false), false);
assert.equal(shouldKeepLeadingSpacingSeam(128, 128, false, true), false);
assert.equal(shouldKeepLeadingSpacingSeam(128, 128, true, false), true);

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
  ['none', 'section', 'group', 'related'],
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(['none', 'related', 'section'], 0, 1),
  {
    values: ['section', 'none', 'related'],
    origins: [2, null, null],
  },
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(['none', 'section', 'related'], 1, 0),
  {
    values: ['related', 'none', 'section'],
    origins: [null, null, 1],
  },
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(['none', 'related', 'section'], 0, 1, 'before'),
  {
    values: ['related', 'none', 'section'],
    origins: [null, null, 2],
  },
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(['none', 'section', 'related'], 1, 1, 'before'),
  {
    values: ['none', 'related', 'section'],
    origins: [0, null, 1],
  },
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(['none', 'section', 'related'], 1, 1, 'after'),
  {
    values: ['none', 'section', 'related'],
    origins: [0, 1, null],
  },
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(
    ['none', 'section', 'section'],
    1,
    0,
    undefined,
    [false, false, true],
  ),
  {
    values: ['related', 'none', 'section'],
    origins: [null, null, 2],
  },
);
assert.deepEqual(
  reorderProjectStackSpacingSeams(
    ['none', 'group', 'section'],
    1,
    0,
    undefined,
    [false, true, true],
  ),
  {
    values: ['related', 'none', 'section'],
    origins: [null, null, 2],
  },
);

console.log('project-intro: ok');
