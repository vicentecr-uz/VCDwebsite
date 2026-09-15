import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
assert.match(source, /window\.innerWidth <= 767/);
assert.match(source, /if \(mode !== 'docked'\) setMode\('docked'\)/);
assert.match(source, /header\.classList\.remove\('is-scrolled-hidden'\)/);
assert.match(source, /if \(mode !== 'flow'\) setMode\('flow'\)/);
assert.match(source, /--header-chrome-height/);
assert.match(source, /--header-chrome-height: 0px/);
assert.match(source, /header\.style\.width = '100%'/);
assert.match(source, /box-sizing: border-box/);
const marker = "window.addEventListener('resize', () => {";
const start = source.indexOf(marker);
const end = source.indexOf('\n    });', start);
assert.ok(start >= 0 && end > start, 'resize callback should remain discoverable');
const callbackBody = source.slice(start + marker.length, end);

function createHarness({ width = 800, mode = 'flow' } = {}) {
  const calls = { syncHeaderWidth: 0, syncSlot: 0, menuSizes: 0, captureGeo: 0, applyGeo: 0 };
  const header = { style: { left: 'original-left', width: 'original-width', top: '123px', opacity: '0.4' } };
  const state = { width, mode, geoWidth: 640 };
  const document = {
    documentElement: { clientWidth: width },
    querySelectorAll: () => ({ forEach: () => { calls.menuSizes += 1; } }),
  };
  const runSource = [
    'window', 'document', 'header', 'mode', 'headerHeight', 'calls',
    'syncMobileHeaderMode', 'syncHeaderWidth', 'syncSlot', 'syncMenuSurfaceInlineSize', 'applyGeo',
  ];
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
    let viewportWidth = ${width};
    let geoWidth = 640;
    const captureGeo = () => { calls.captureGeo += 1; geoWidth = 777; };
    ${callbackBody}
  `);
  const run = new Function(
    ...runSource,
    compiled,
  );
  const execute = (nextWidth) => {
    document.documentElement.clientWidth = nextWidth;
    run(
      { innerWidth: nextWidth },
      document,
      header,
      state.mode,
      72,
      calls,
      () => {},
      () => { calls.syncHeaderWidth += 1; },
      () => { calls.syncSlot += 1; },
      () => {},
      () => { calls.applyGeo += 1; header.style.left = 'captured-left'; header.style.width = '777px'; },
    );
  };
  return { calls, header, state, execute };
}

{
  const harness = createHarness({ mode: 'riding' });
  harness.execute(800);
  assert.deepEqual(harness.calls, { syncHeaderWidth: 0, syncSlot: 0, menuSizes: 0, captureGeo: 0, applyGeo: 0 });
  assert.equal(harness.header.style.top, '123px');
  assert.equal(harness.header.style.opacity, '0.4');
}

{
  const harness = createHarness({ mode: 'docked' });
  harness.execute(960);
  assert.deepEqual(harness.calls, { syncHeaderWidth: 1, syncSlot: 1, menuSizes: 1, captureGeo: 1, applyGeo: 1 });
  assert.equal(harness.header.style.left, 'captured-left');
  assert.equal(harness.header.style.width, '777px');
  assert.equal(harness.header.style.top, '123px');
}

{
  const harness = createHarness({ mode: 'riding' });
  harness.execute(960);
  assert.deepEqual(harness.calls, { syncHeaderWidth: 1, syncSlot: 1, menuSizes: 1, captureGeo: 1, applyGeo: 0 });
  assert.equal(harness.header.style.left, '0');
  assert.equal(harness.header.style.width, '777px');
  assert.equal(harness.header.style.top, '123px');
  assert.equal(harness.header.style.opacity, '0.4');
}
