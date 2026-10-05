import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
assert.match(source, /window\.innerWidth <= 767/);
assert.match(source, /const nextMode = window\.scrollY <= 0 \? 'flow' : 'docked';/);
assert.match(source, /if \(mode !== nextMode\) setMode\(nextMode\)/);
assert.match(source, /if \(window\.innerWidth <= 767\) \{\s*update\(\);\s*return;/);
assert.match(source, /header\.classList\.remove\('is-scrolled-hidden'\)/);
assert.match(source, /if \(mode !== 'flow'\) setMode\('flow'\)/);
assert.match(source, /--header-chrome-height/);
assert.match(source, /--header-chrome-height: 0px/);
assert.match(source, /header\.style\.width = '100%'/);
assert.match(source, /box-sizing: border-box/);
assert.match(
  source,
  /const applyGeo = \(\) => \{\s*captureGeo\(\);/,
  'docked applyGeo must recapture from the in-flow slot before writing width',
);
assert.match(
  source,
  /else if \(mode === 'riding'\) \{\s*header\.style\.left = '0';\s*header\.style\.width = '100%';/,
  'riding width must follow the slot, not a cached pixel measure',
);
const mobileStyles = source.slice(source.indexOf('  @media (max-width: 767px) {'), source.indexOf('\n  }\n\n  /* Deliberately', source.indexOf('  @media (max-width: 767px) {')));
assert.match(mobileStyles, /\.site-header-slot\s*\{[\s\S]*height:\s*calc\(var\(--space-unit\) \* 3\.75\)/);
assert.match(mobileStyles, /\.site-header\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*0;[\s\S]*left:\s*calc\(-1 \* var\(--page-gutter, 0px\)\);[\s\S]*width:\s*calc\(100% \+ 2 \* var\(--page-gutter, 0px\)\)/);
assert.match(mobileStyles, /\.site-header\.is-docked\s*\{[\s\S]*position:\s*fixed;[\s\S]*left:\s*0;[\s\S]*width:\s*100%/);
assert.match(source.slice(0, source.indexOf('  @media (max-width: 767px) {')), /\.site-header\s*\{[\s\S]*position:\s*relative;/);
const mobileModeMarker = '    const syncMobileHeaderMode = () => {';
const mobileModeStart = source.indexOf(mobileModeMarker);
const mobileModeEnd = source.indexOf('\n    // Opening a menu', mobileModeStart);
assert.ok(mobileModeStart >= 0 && mobileModeEnd > mobileModeStart, 'mobile mode sync should remain discoverable');
const mobileModeSource = source.slice(mobileModeStart, mobileModeEnd);
const scrollMarker = "window.addEventListener(\n      'scroll',\n      () => {";
const scrollStart = source.indexOf(scrollMarker);
const scrollEnd = source.indexOf('\n      },\n      { passive: true },', scrollStart);
assert.ok(scrollStart >= 0 && scrollEnd > scrollStart, 'scroll callback should remain discoverable');
const scrollCallbackBody = source.slice(scrollStart + scrollMarker.length, scrollEnd);
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

function createMobileModeHarness({ width = 390, scrollY = 0, mode = 'docked' } = {}) {
  const calls = { setMode: [], cancelAnimationFrame: 0, clearTimeout: 0 };
  const header = {
    classList: { remove: () => {}, add: () => {} },
    style: { opacity: '0.4', pointerEvents: 'none', transform: 'translateY(-2px)' },
  };
  const document = {};
  const state = { width, scrollY, mode };
  const runSource = [
    'window', 'document', 'header', 'calls', 'state', 'cancelAnimationFrame', 'clearTimeout',
  ];
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
    let updateFrame = 'frame';
    let ticking = true;
    let offscreenTimer = 'timer';
    let mobileHeader = true;
    let mode = ${JSON.stringify(mode)};
    const setMode = (next) => { mode = next; calls.setMode.push(next); };
    ${mobileModeSource}
    syncMobileHeaderMode();
    state.mode = mode;
  `);
  const run = new Function(
    ...runSource,
    compiled,
  );
  const execute = (nextWidth = state.width, nextScrollY = state.scrollY) => {
    state.width = nextWidth;
    state.scrollY = nextScrollY;
    run(
      { innerWidth: nextWidth, scrollY: nextScrollY },
      document,
      header,
      calls,
      state,
      () => { calls.cancelAnimationFrame += 1; },
      () => { calls.clearTimeout += 1; },
    );
  };
  execute();
  return { calls, header, state, execute };
}

function runScrollCallback({ width, ticking = false } = {}) {
  const calls = { update: 0, requestAnimationFrame: 0 };
  const state = { updateFrame: null, ticking };
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
    let updateFrame = ${state.updateFrame};
    let ticking = ${state.ticking};
    const update = () => { calls.update += 1; ticking = false; updateFrame = null; };
    const requestAnimationFrame = () => { calls.requestAnimationFrame += 1; return 1; };
    ${scrollCallbackBody}
    state.updateFrame = updateFrame;
    state.ticking = ticking;
  `);
  new Function('window', 'calls', 'state', compiled)({ innerWidth: width }, calls, state);
  return { calls, state };
}

{
  const mobile = runScrollCallback({ width: 390 });
  assert.deepEqual(mobile.calls, { update: 1, requestAnimationFrame: 0 });
  assert.equal(mobile.state.ticking, false);

  const desktop = runScrollCallback({ width: 800 });
  assert.deepEqual(desktop.calls, { update: 0, requestAnimationFrame: 1 });
  assert.equal(desktop.state.ticking, true);
}

{
  const harness = createMobileModeHarness({ scrollY: 0 });
  assert.deepEqual(harness.calls.setMode, ['flow']);
  assert.equal(harness.state.mode, 'flow');
  assert.equal(harness.calls.cancelAnimationFrame, 1);
  assert.equal(harness.calls.clearTimeout, 1);
  assert.equal(harness.header.style.opacity, '');
  assert.equal(harness.header.style.pointerEvents, '');
  assert.equal(harness.header.style.transform, '');
}

{
  const harness = createMobileModeHarness({ scrollY: -12 });
  assert.deepEqual(harness.calls.setMode, ['flow']);
  assert.equal(harness.state.mode, 'flow');
}

{
  const harness = createMobileModeHarness({ scrollY: 24, mode: 'flow' });
  assert.deepEqual(harness.calls.setMode, ['docked']);
  assert.equal(harness.state.mode, 'docked');
}

{
  const harness = createMobileModeHarness({ width: 390, scrollY: 24, mode: 'docked' });
  harness.execute(800, 24);
  assert.deepEqual(harness.calls.setMode, ['flow']);
  assert.equal(harness.state.mode, 'flow');
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
  assert.equal(harness.header.style.width, '100%');
  assert.equal(harness.header.style.top, '123px');
  assert.equal(harness.header.style.opacity, '0.4');
}
