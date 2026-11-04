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
  'defaultHeightApplied', 'loadedGrid', 'activeGrid', 'pages',
  'GRID_GAP',
  'return ' + applyLayoutCapsSource,
) as (...args: unknown[]) => () => void;
const layoutArgs = ['panel', 'root', 'computeThumbWidth', 'measureOverlayHug', 'viewportCapPx',
  'getComputedStyle', 'document', 'gridEl', 'view', 'listEl', 'userSized',
  'defaultHeightApplied', 'loadedGrid', 'activeGrid', 'pages', 'GRID_GAP'] as const;
const applyLayoutCaps = (env: Record<string, unknown>) =>
  makeApplyLayoutCaps(...layoutArgs.map((key) => env[key]))();

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
  return { env, measurements, readMeasurements: () => measurements, panel, root };
}

test('morphing skips measurement and leaves the default pending until prepared geometry is valid', () => {
  const f = fixture({ width: 600, height: 700, content: 500 }, { morphing: true });
  applyLayoutCaps(f.env);
  expect(f.readMeasurements()).toBe(0);
  expect(f.panel.style.height).toBe('');
  f.panel.classList.remove('is-dev-overlay-morphing');
  applyLayoutCaps(f.env);
  expect(f.readMeasurements()).toBe(1);
  expect(f.panel.style.height).toBe('487px');
});

test('empty content keeps the default pending and manual sizing is preserved', () => {
  const empty = fixture({ width: 600, height: 700, content: 0 });
  applyLayoutCaps(empty.env);
  expect(empty.readMeasurements()).toBe(1);
  expect(empty.panel.style.height).toBe('');

  const manual = fixture({ width: 600, height: 700, content: 500 }, { userSized: true });
  manual.panel.style.height = '420px';
  applyLayoutCaps(manual.env);
  expect(manual.panel.style.height).toBe('420px');
});
