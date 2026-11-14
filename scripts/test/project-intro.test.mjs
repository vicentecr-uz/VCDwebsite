import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { introLayout, introRun, normalizeIntroHeight, resolveIntroHeight } from '../../src/lib/projectIntro.ts';
import {
  canonicalizeProjectStackSpacing,
  isProjectStackSpacingPath,
  projectStackClass,
  resolveProjectStackSpacing,
  setProjectStackSpacingAtViewport,
  reorderProjectStackSpacings,
  reorderProjectStackSpacingSeams,
  shouldKeepLeadingSpacingSeam,
} from '../../src/lib/projectStack.ts';
import { ADAPTIVE_PAGE_COLUMNS_ENABLED, pageColumnStyle } from '../../src/lib/pageColumn.ts';
import { createScrollDriver, EDGE_SCROLL, edgeScrollOverrides, resolveGapLaneSide } from '../../src/scripts/sectionReorder.ts';
import { resolveProjectOutline } from '../../src/lib/projectOutline.ts';
import { validateProjectOutlineTargets } from '../dev-api-plugins.mjs';

const headerSource = readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
const projectBodyText = readFileSync(new URL('../../src/components/project/ProjectBodyText.astro', import.meta.url), 'utf8');
const projectSectionTitle = readFileSync(new URL('../../src/components/project/ProjectSectionTitle.astro', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
const projectCss = readFileSync(new URL('../../src/styles/project.css', import.meta.url), 'utf8');
const devTextEditor = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const devSectionReorderEditor = readFileSync(new URL('../../src/components/DevSectionReorderEditor.astro', import.meta.url), 'utf8');

const spacingHelperStart = devTextEditor.indexOf('  const suppressGalleryPageTopSpacing = (');
const spacingHelperEnd = devTextEditor.indexOf('\n  };', spacingHelperStart) + '\n  };'.length;
if (spacingHelperStart < 0 || spacingHelperEnd < 0) throw new Error('Could not extract page-top spacing helper');
const spacingHelperSource = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  devTextEditor.slice(spacingHelperStart, spacingHelperEnd),
);
const suppressGalleryPageTopSpacing = new Function(
  `${spacingHelperSource}; return suppressGalleryPageTopSpacing;`,
)();
const spacingElement = (documentKey, intro) => ({
  dataset: { devSpacingDocument: documentKey, ...(intro ? { devIntro: 'true' } : {}) },
});
assert.equal(suppressGalleryPageTopSpacing(spacingElement('home', false), true), false);
assert.equal(suppressGalleryPageTopSpacing(spacingElement('home', true), true), true);
assert.equal(suppressGalleryPageTopSpacing(spacingElement('home', true), false), false);
assert.equal(suppressGalleryPageTopSpacing(spacingElement('about', true), true), false);

const validSections = [{ id: 'overview' }, { id: 'details' }];
assert.deepEqual(resolveProjectOutline({
  outline: [
    { kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' },
    { kind: 'group', id: 'intro', label: 'Intro', anchor: 'orphan' },
    { kind: 'section', id: 'orphan', label: 'Orphan', anchor: 'orphan' },
  ],
  sections: validSections,
}), [{ kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' }]);
assert.deepEqual(resolveProjectOutline({
  outline: [
    { kind: 'group', id: 'intro', label: 'Intro', anchor: 'overview' },
    { kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' },
  ],
  sections: validSections,
}), [
  { kind: 'group', id: 'intro', label: 'Intro', defaultOpen: true, anchor: 'overview' },
  { kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' },
]);
assert.deepEqual(resolveProjectOutline({ outline: [{ kind: 'section', id: 'overview', label: 'Overview' }], sections: [] }), []);
assert.equal(validateProjectOutlineTargets([
  { kind: 'group', id: 'intro', label: 'Intro', anchor: 'overview' },
  { kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' },
], validSections), true);
assert.equal(validateProjectOutlineTargets([
  { kind: 'group', id: 'intro', label: 'Intro', anchor: 'orphan' },
], validSections), false);
assert.match(devTextEditor, /getDevSectionOutline/);
assert.match(devTextEditor, /payload\.outline = structuredClone\(getDevSectionOutline\(\)\)/);
assert.match(devTextEditor, /change\.payload\.outline = structuredClone\(getDevSectionOutline\(\)\)/);
assert.match(devSectionReorderEditor, /activeIntroDrag && movedAway && sourceGapPreview\?\.element\.parentElement/);
assert.match(devSectionReorderEditor, /sourceGapPreview\.element\.before\(sourceGapIndicator\)/);
assert.match(devSectionReorderEditor, /activeIntroDrag && target === sourceIndex/);
assert.match(devSectionReorderEditor, /moveIndicatorWithFlip: false/);
assert.doesNotMatch(devSectionReorderEditor, /syncSlotMediaInset\(root\)/);
assert.match(devSectionReorderEditor, /rootRect\.left - zoneRect\.left\) \+ innerInset\('--dev-section-inset'\)/);
assert.match(devSectionReorderEditor, /zoneRect\.right - rootRect\.right\) \+ innerInset\('--dev-section-inset-end'\)/);

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
  desktop: 'group', tablet: 'group', mobile: 'group',
});
assert.throws(() => canonicalizeProjectStackSpacing({ toString: 'none' }));
assert.throws(() => canonicalizeProjectStackSpacing({ __proto__: 'none' }));
assert.equal(canonicalizeProjectStackSpacing({ desktop: 'section', tablet: 'section', mobile: 'section' }), 'section');
assert.equal(isProjectStackSpacingPath(['trailingSpacing']), true);
assert.equal(isProjectStackSpacingPath(['sections', 1, 'spacing']), true);
assert.equal(isProjectStackSpacingPath(['spacing']), false);
assert.equal(isProjectStackSpacingPath(['sections', 1, 'trailingSpacing']), false);

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
assert.match(projectCss, /\.project-block\s*\{[^}]*margin-inline: 0 auto;/);
assert.match(projectCss, /\.project-block--text\s*\{[^}]*max-width: var\(--page-text-max-width\);/);
assert.match(projectBodyText, /'project-block--text'/);
assert.match(projectSectionTitle, /'project-block--text'/);
assert.equal(
  pageColumnStyle([{ type: 'bodyText' }]),
  '--page-max-width: var(--page-text-max-width); --page-header-width: var(--page-text-max-width)',
);
for (const type of ['projectGrid', 'interactiveDemo', 'codeBlock', 'sabiExample', 'productHero']) {
  assert.equal(pageColumnStyle([{ type }]), undefined, `${type} uses the media column`);
}
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

const edgeBounds = { top: 0, bottom: 1000 };
const edgeStep = (pointerY) => {
  const steps = [];
  const driver = createScrollDriver({ scrollBy: (step) => steps.push(step) });
  for (let i = 0; i < 30; i += 1) driver.apply(1000 / 60, pointerY, edgeBounds);
  return steps.reduce((sum, step) => sum + step, 0);
};
assert.ok(edgeStep(990) > 0);
assert.ok(edgeStep(10) < 0);
assert.equal(edgeStep(500), 0);
assert.ok(edgeStep(990) > edgeStep(880));
assert.ok(edgeStep(10) < edgeStep(120));
const previousOverrides = { ...edgeScrollOverrides };
try {
  edgeScrollOverrides.maxScrollSpeed = 24;
  edgeScrollOverrides.maxSpeedInsetPx = 60;
  const steps = [];
  const driver = createScrollDriver({ edgeZoneRatio: 0.2, edgeZoneMinPx: 0, edgeZoneMaxPx: 100, velocitySmoothing: 1, scrollBy: (step) => steps.push(step) });
  driver.apply(1000 / 60, 20, { top: 0, bottom: 200 }, 20);
  assert.equal(steps.length, 0, 'top pickup starts at zero speed');
  driver.apply(1000 / 60, 10, { top: 0, bottom: 200 }, 20);
  assert.ok(steps.reduce((sum, step) => sum + step, 0) < 0, 'moving toward top edge scrolls');
  const beforeRetreat = steps.reduce((sum, step) => sum + step, 0);
  driver.apply(1000 / 60, 60, { top: 0, bottom: 200 }, 20);
  const afterRetreat = steps.reduce((sum, step) => sum + step, 0);
  assert.equal(afterRetreat, beforeRetreat, 'retreat toward middle restores zone without scrolling');
  driver.apply(1000 / 60, 10, { top: 0, bottom: 200 }, 20);
  assert.ok(steps.reduce((sum, step) => sum + step, 0) < afterRetreat, 'returning to edge scrolls after retreat');
  driver.reset();
  steps.length = 0;
  driver.apply(1000 / 60, 180, { top: 0, bottom: 200 }, 180);
  assert.equal(steps.length, 0, 'bottom pickup starts at zero speed');
  driver.apply(1000 / 60, 190, { top: 0, bottom: 200 }, 180);
  assert.ok(steps.reduce((sum, step) => sum + step, 0) > 0, 'moving toward bottom edge scrolls');
  driver.reset();
  steps.length = 0;
  driver.apply(1000 / 60, 100, { top: 0, bottom: 200 }, 100);
  assert.equal(steps.length, 0, 'outside pickup waits for activation');
  driver.apply(1000 / 60, 104, { top: 0, bottom: 200 }, 100);
  assert.equal(steps.length, 0, 'activation travel alone does not scroll');
  driver.apply(1000 / 60, 190, { top: 0, bottom: 200 }, 100);
  assert.ok(steps.reduce((sum, step) => sum + step, 0) > 0, 'outside pickup activates when it reaches the bottom zone');
  const insetDriver = createScrollDriver({ edgeZoneRatio: 0.5, edgeZoneMinPx: 0, edgeZoneMaxPx: 100, maxScrollSpeed: 24, maxSpeedInsetPx: 0, velocitySmoothing: 1, scrollBy: (step) => steps.push(step) });
  steps.length = 0;
  edgeScrollOverrides.maxSpeedInsetPx = 0;
  insetDriver.apply(1000 / 60, 160, { top: 0, bottom: 200 });
  const noInsetSpeed = steps.reduce((sum, step) => sum + step, 0);
  steps.length = 0;
  edgeScrollOverrides.maxSpeedInsetPx = 60;
  const cappedInsetDriver = createScrollDriver({ edgeZoneRatio: 0.5, edgeZoneMinPx: 0, edgeZoneMaxPx: 100, maxScrollSpeed: 24, maxSpeedInsetPx: 60, velocitySmoothing: 1, scrollBy: (step) => steps.push(step) });
  cappedInsetDriver.apply(1000 / 60, 160, { top: 0, bottom: 200 });
  assert.ok(Math.abs(steps.reduce((sum, step) => sum + step, 0)) > Math.abs(noInsetSpeed));
  assert.equal(EDGE_SCROLL.MAX_SPEED_INSET_PX, 12);
  const zeroSteps = [];
  const zeroDriver = createScrollDriver({ maxScrollSpeed: 0, velocitySmoothing: 1, scrollBy: (step) => zeroSteps.push(step) });
  zeroDriver.apply(1000 / 60, 990, edgeBounds);
  assert.equal(zeroSteps.length, 0, 'maxScrollSpeed: 0 disables scrolling');
} finally {
  for (const key of Object.keys(edgeScrollOverrides)) delete edgeScrollOverrides[key];
  Object.assign(edgeScrollOverrides, previousOverrides);
}

const viewportSource = readFileSync(new URL('../../src/lib/safeVh.ts', import.meta.url), 'utf8');
const geometryStart = viewportSource.indexOf('    const pageViewport =');
const geometryEnd = viewportSource.indexOf('    const outerAir =', geometryStart);
const geometryScript = new Bun.Transpiler({ loader: 'ts' }).transformSync(viewportSource.slice(geometryStart, geometryEnd));
const measureIntro = new Function('first', 'next', 'last', 'scrollTop', 'height', 'safeViewportHeight', 'introLayout', `${geometryScript}; return layout;`);
const overlayViewport = { scrollTop: 150, getBoundingClientRect: () => ({ top: 20 }) };
const overlayFirst = { closest: () => overlayViewport };
const overlayNext = { getBoundingClientRect: () => ({ top: 170 }) };
assert.equal(measureIntro(overlayFirst, overlayNext, null, 900, 100, 1000, introLayout).outerGapPx, 350);
overlayViewport.scrollTop = 200;
overlayNext.getBoundingClientRect = () => ({ top: 120 });
assert.equal(measureIntro(overlayFirst, overlayNext, null, 900, 100, 1000, introLayout).outerGapPx, 350);
assert.equal(measureIntro({ closest: () => null }, { getBoundingClientRect: () => ({ top: 200 }) }, null, 100, 100, 1000, introLayout).outerGapPx, 350);
