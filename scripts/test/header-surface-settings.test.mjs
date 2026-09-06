import assert from 'node:assert/strict';
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

console.log('header-surface-settings: ok');
