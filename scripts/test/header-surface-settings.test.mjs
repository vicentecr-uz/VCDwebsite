import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HEADER_SURFACE_DEFAULTS,
  cssVariablesForProfile,
  cssVariablesForSettings,
  normalizeHeaderSurfaceSettings,
} from '../../src/lib/headerSurfaceSettings.ts';

assert.deepEqual(normalizeHeaderSurfaceSettings(null), HEADER_SURFACE_DEFAULTS);
assert.deepEqual(
  normalizeHeaderSurfaceSettings({
    desktop: { radius: 99, feather: -1, sidePadding: Number.NaN, bottomPadding: Infinity, backdropOpacity: 42 },
    mobile: ['bad'],
  }),
  {
    desktop: { radius: 6, feather: 0.25, sidePadding: 3, bottomPadding: 1, backdropOpacity: 42 },
    mobile: HEADER_SURFACE_DEFAULTS.mobile,
  },
);
assert.equal(normalizeHeaderSurfaceSettings({ desktop: { radius: '3.25', feather: null, sidePadding: 1.027 } }).desktop.radius, 4);
assert.equal(normalizeHeaderSurfaceSettings({ desktop: { sidePadding: 1.027 } }).desktop.sidePadding, 1.05);

assert.deepEqual(cssVariablesForProfile('desktop', HEADER_SURFACE_DEFAULTS.desktop), {
  '--header-surface-radius': '4em',
  '--header-surface-feather': '10em',
  '--header-surface-side-padding': '3em',
  '--header-surface-bottom-padding': '1em',
  '--header-surface-backdrop-opacity': '90%',
});

const both = cssVariablesForSettings(HEADER_SURFACE_DEFAULTS);
assert.equal(both['--header-surface-mobile-feather'], '10em');
assert.equal(both['--header-surface-mobile-bottom-padding'], '1.5em');
assert.equal(Object.keys(both).length, 10);

const headerSource = await readFile(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const tunerSource = await readFile(new URL('../../src/components/archive/DevHeaderSurfaceTuner.astro', import.meta.url), 'utf8');
const archiveSource = await readFile(new URL('../../src/components/archive/ArchivedDevPanels.astro', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
assert.match(tunerSource, /document\.dispatchEvent\(new CustomEvent\('vcd:header-surface-preview'/);
assert.doesNotMatch(tunerSource, /\.dev-header-surface-tuner\s*\{\s*width:/);
assert.match(archiveSource, /import DevHeaderSurfaceTuner from '\.\/DevHeaderSurfaceTuner\.astro'/);
assert.match(archiveSource, /data-archived-dev-panel="header-surface"/);
assert.match(archiveSource, /new URL\(window\.location\.href\)\.searchParams\.getAll\('dev-panel'\)/);
assert.match(archiveSource, /querySelectorAll\('template\[data-archived-dev-panel\]'/);
assert.match(archiveSource, /template\.replaceWith\(template\.content\.cloneNode\(true\)\)/);
assert.match(archiveSource, /template\.remove\(\)/);
assert.match(layoutSource, /showDevTools && <ArchivedDevPanels \/>/);
assert.doesNotMatch(layoutSource, /showDevTools && <DevHeaderSurfaceTuner \/>/);
assert.match(headerSource, /header-surface-mobile-backdrop-opacity/);
assert.match(headerSource, /--panel-corner-radius: min\([\s\S]*?calc\(var\(--panel-inline-size\) \/ 2\)/);

assert.match(headerSource, /--panel-side-pad: var\(--header-surface-side-padding, 3em\)/);
assert.match(headerSource, /var\(--header-surface-mobile-radius, 4em\)/);
assert.match(headerSource, /var\(--header-surface-mobile-feather, 10em\)/);
assert.match(headerSource, /var\(--header-surface-mobile-bottom-padding, 1\.5em\)/);
assert.match(headerSource, /2 \* var\(--panel-side-pad\)/);
assert.match(headerSource, /--panel-outset-outer: clamp\([\s\S]*calc\(var\(--panel-side-pad\) \+ var\(--panel-feather\)\)/);
assert.match(headerSource, /var\(--panel-inline-size\) \+ var\(--panel-feather\) - var\(--panel-side-pad\)/);
assert.match(headerSource, /var\(--panel-outset-outer\) - var\(--panel-side-pad\) - var\(--panel-feather\)/);

console.log('header-surface-settings: ok');
