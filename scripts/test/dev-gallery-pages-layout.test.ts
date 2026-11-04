import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/DevGalleryPages.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const applyLayoutCaps = () => {');
const end = source.indexOf('    const scheduleLayoutCaps =', start);
const applyLayoutCapsSource = source.slice(start, end).replace(/^\s*const applyLayoutCaps = /, '').trim().replace(/;$/, '');
const makeApplyLayoutCaps = new Function(
  'panel', 'root', 'computeThumbWidth', 'measureOverlayHug', 'viewportCapPx',
  'getComputedStyle', 'document', 'gridEl', 'view', 'listEl', 'userSized',
  'loadedGrid', 'activeGrid', 'pages',
  'GRID_GAP',
  'let defaultHeightApplied = false; const applyLayoutCaps = ' + applyLayoutCapsSource
    + '; return { applyLayoutCaps, get defaultApplied() { return defaultHeightApplied; } };',
) as (...args: unknown[]) => { applyLayoutCaps: () => void; readonly defaultApplied: boolean };
const layoutArgs = ['panel', 'root', 'computeThumbWidth', 'measureOverlayHug', 'viewportCapPx',
  'getComputedStyle', 'document', 'gridEl', 'view', 'listEl', 'userSized',
  'loadedGrid', 'activeGrid', 'pages', 'GRID_GAP'] as const;

function fixture(hug: { width: number; height: number; content: number }, options: { morphing?: boolean; userSized?: boolean } = {}) {
  const win = new Window({ url: 'http://localhost/' });
  const panel = win.document.createElement('section');
  const root = win.document.createElement('div');
  const grid = win.document.createElement('div');
  panel.classList.toggle('is-dev-overlay-morphing', options.morphing ?? false);
  const style = { paddingTop: '0px', paddingBottom: '0px' };
  let measurements = 0;
  const env = {
    panel,
    root,
    computeThumbWidth: () => 100,
    measureOverlayHug: () => { measurements += 1; return hug; },
    viewportCapPx: () => ({ width: 1000, height: 900 }),
    getComputedStyle: (element: Element) => element === grid ? style : { getPropertyValue: () => '344' },
    document: win.document,
    gridEl: grid,
    view: 'grid',
    listEl: null,
    userSized: options.userSized ?? false,
    defaultHeightApplied: false,
    loadedGrid: 'home',
    activeGrid: 'home',
    pages: [{ slug: 'one' }],
    GRID_GAP: 8,
  };
  const layout = makeApplyLayoutCaps(...layoutArgs.map((key) => env[key]));
  return { env, layout, measurements, readMeasurements: () => measurements, panel, root, hug };
}

test('morphing skips measurement and leaves the default pending until prepared geometry is valid', () => {
  const f = fixture({ width: 600, height: 700, content: 500 }, { morphing: true });
  f.layout.applyLayoutCaps();
  expect(f.readMeasurements()).toBe(0);
  expect(f.layout.defaultApplied).toBe(false);
  expect(f.panel.style.height).toBe('');
  f.panel.classList.remove('is-dev-overlay-morphing');
  f.layout.applyLayoutCaps();
  expect(f.readMeasurements()).toBe(1);
  expect(f.layout.defaultApplied).toBe(true);
  expect(f.panel.style.height).toBe('487px');
});

test('empty content keeps the default pending and manual sizing is preserved', () => {
  const empty = fixture({ width: 600, height: 700, content: 0 });
  empty.layout.applyLayoutCaps();
  expect(empty.readMeasurements()).toBe(1);
  expect(empty.layout.defaultApplied).toBe(false);
  expect(empty.panel.style.height).toBe('');
  empty.hug.content = 500;
  empty.layout.applyLayoutCaps();
  expect(empty.layout.defaultApplied).toBe(true);
  expect(empty.panel.style.height).toBe('487px');

  const manual = fixture({ width: 600, height: 700, content: 500 }, { userSized: true });
  manual.panel.style.height = '420px';
  manual.layout.applyLayoutCaps();
  expect(manual.panel.style.height).toBe('420px');
});
