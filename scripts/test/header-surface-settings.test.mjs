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
    desktop: { radius: 6, feather: 0.25, sidePadding: 3.5, bottomPadding: 1, backdropOpacity: 42 },
    mobile: HEADER_SURFACE_DEFAULTS.mobile,
  },
);
assert.equal(normalizeHeaderSurfaceSettings({ desktop: { radius: '3.25', feather: null, sidePadding: 1.027 } }).desktop.radius, 3.5);
assert.equal(normalizeHeaderSurfaceSettings({ desktop: { sidePadding: 1.027 } }).desktop.sidePadding, 1.05);

assert.deepEqual(cssVariablesForProfile('desktop', HEADER_SURFACE_DEFAULTS.desktop), {
  '--header-surface-radius': '3.5em',
  '--header-surface-feather': '4em',
  '--header-surface-side-padding': '3.5em',
  '--header-surface-bottom-padding': '1em',
  '--header-surface-backdrop-opacity': '90%',
});

const both = cssVariablesForSettings(HEADER_SURFACE_DEFAULTS);
assert.equal(both['--header-surface-mobile-feather'], '3em');
assert.equal(both['--header-surface-mobile-bottom-padding'], '0.75em');
assert.equal(Object.keys(both).length, 10);

const headerSource = await readFile(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const tunerSource = await readFile(new URL('../../src/components/DevHeaderSurfaceTuner.astro', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
assert.match(tunerSource, /document\.dispatchEvent\(new CustomEvent\('vcd:header-surface-preview'/);
assert.doesNotMatch(tunerSource, /\.dev-header-surface-tuner\s*\{\s*width:/);
assert.match(layoutSource, /showDevTools && <DevHeaderSurfaceTuner \/>/);
assert.match(headerSource, /header-surface-mobile-backdrop-opacity/);
assert.match(headerSource, /--panel-corner-radius: min\([\s\S]*?calc\(var\(--panel-inline-size\) \/ 2\)/);

const builtHtml = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(builtHtml, /data-header-surface-form/);

console.log('header-surface-settings: ok');
