import assert from 'node:assert/strict';
import test from 'node:test';
import { devCanvasShell, shouldServeCanvasShell } from '../dev-canvas-shell.mjs';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const request = { method: 'GET', url: '/work?edit=1', headers: { 'sec-fetch-dest': 'document', accept: 'text/html', cookie: 'other=1; vcd-canvas=1' } };
for (const [name, overrides, expected] of [
  ['flag off', { headers: { ...request.headers, cookie: '' } }, false],
  ['flag on top-level', {}, true],
  ['iframe request', { headers: { ...request.headers, 'sec-fetch-dest': 'iframe' } }, false],
  ['asset path', { url: '/image.png' }, false],
  ['dev path', { url: '/dev/scroll-hold' }, false],
  ['non-GET', { method: 'POST' }, false],
  ['non-HTML', { headers: { ...request.headers, accept: 'application/json' } }, false],
  ['missing destination', { headers: { ...request.headers, 'sec-fetch-dest': undefined } }, false],
  ['cookie value must match', { headers: { ...request.headers, cookie: 'vcd-canvas=10' } }, false],
  ...['/api/write', '/src/page', '/@vite/client', '/node_modules/pkg', '/_astro/a', '/preview/page', '/reports/prototypes/page'].map((url) => [url, { url }, false]),
]) {
  test(name, () => assert.equal(shouldServeCanvasShell({ ...request, ...overrides }), expected));
}

test('dev middleware toggles the cookie and rewrites only eligible requests', () => {
  let middleware;
  const plugin = devCanvasShell();
  assert.equal(plugin.apply, 'serve');
  plugin.configureServer({ middlewares: { use: (handler) => { middleware = handler; } } });
  for (const chrome of [false, true]) for (const enabled of [true, false]) {
    const headers = {};
    let ended = false;
    const res = { setHeader: (key, value) => { headers[key] = value; }, end: () => { ended = true; } };
    middleware({ ...request, url: `/dev/canvas/${chrome ? 'chrome-' : ''}${enabled ? 'on' : 'off'}` }, res, () => assert.fail('redirect must end'));
    assert.equal(res.statusCode, 302);
    assert.equal(headers.Location, '/');
    const cookie = chrome ? 'vcd-canvas-chrome' : 'vcd-canvas';
    assert.equal(headers['Set-Cookie'], enabled ? `${cookie}=1; Path=/; SameSite=Lax` : `${cookie}=; Path=/; SameSite=Lax; Max-Age=0`);
    assert.equal(ended, true);
  }
  const req = { ...request };
  let next = false;
  middleware(req, {}, () => { next = true; });
  assert.equal(req.url, '/dev/canvas-shell');
  assert.equal(next, true);
});

function shellFixture(reduced = false) {
  const source = readFileSync(new URL('../../src/pages/dev/canvas-shell.astro', import.meta.url), 'utf8');
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.split('<script>')[1].split('</script>')[0]
    .replace(/^\s*import .*;$/gm, '').replace('import.meta.hot?.dispose(() => scope.destroy());', ''));
  const window = new Window({ url: 'http://localhost:4360/', settings: { disableIframePageLoading: true } });
  const document = window.document;
  document.body.innerHTML = '<div data-canvas-surface><iframe data-canvas-frame></iframe></div><div data-canvas-shadow></div><div data-canvas-backdrop></div><div data-canvas-controls></div>';
  const frame = document.querySelector('iframe');
  const child = { focus() {}, postMessage(data) { posts.push(data); } };
  Object.defineProperty(frame, 'contentWindow', { value: child });
  const posts = [];
  const frames = new Map();
  const cleanups = [];
  let id = 0;
  let now = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const scope = {
    signal: { aborted: false },
    listen(target, type, callback) {
      target.addEventListener(type, callback);
      cleanups.push(() => target.removeEventListener(type, callback));
    },
    add(callback) { cleanups.push(callback); },
  };
  new Function('window', 'document', 'location', 'history', 'matchMedia', 'performance', 'createPageScope', script)(
    window, document, window.location, window.history, () => ({ matches: reduced }), { now: () => now }, () => scope,
  );
  const message = (data) => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: child, data }));
  message({ type: 'vcd-canvas-dev-mode', active: true });
  return {
    window, frame, posts,
    request: (preset) => message({ type: 'vcd-canvas-request-preset', preset }),
    step(ms) {
      now += ms;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
    async dispose() { cleanups.reverse().forEach((callback) => callback()); await window.happyDOM.abort(); },
  };
}

test('canvas morph reflows every tick and releases flux once after interruptions settle', async () => {
  const f = shellFixture();
  try {
    f.request('tablet');
    f.step(100);
    const width = parseFloat(f.frame.style.width);
    assert.ok(width < f.window.innerWidth && width > 820);
    assert.match(f.frame.style.transform, /^scale\(/);
    assert.ok(parseFloat(f.frame.style.height) > f.window.innerHeight);
    f.request('mobile');
    f.step(100);
    assert.ok(parseFloat(f.frame.style.width) < width);
    assert.deepEqual(f.posts.filter((post) => post.type === 'vcd-canvas-flux').map((post) => post.active), [true, true]);
    const count = f.posts.length;
    f.window.dispatchEvent(new f.window.Event('resize'));
    assert.equal(f.posts.length, count);
    f.step(1000);
    assert.equal(f.frame.style.width, '390px');
    assert.equal(f.frame.style.height, '844px');
    assert.equal(f.posts.at(-1).active, false);
    assert.equal(f.posts.filter((post) => post.type === 'vcd-canvas-flux' && !post.active).length, 1);
  } finally { await f.dispose(); }
});

test('canvas reduced-motion jumps and idle resize renders send no flux messages', async () => {
  const f = shellFixture(true);
  try {
    f.request('mobile');
    assert.equal(f.frame.style.width, '390px');
    f.window.dispatchEvent(new f.window.Event('resize'));
    f.request('desktop');
    assert.equal(f.frame.style.width, `${f.window.innerWidth}px`);
    assert.equal(f.posts.filter((post) => post.type === 'vcd-canvas-flux').length, 0);
  } finally { await f.dispose(); }
});

test('flag toggles return to the page they were clicked on', async () => {
  const { canvasFlagReturnPath } = await import('../dev-canvas-shell.mjs');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360', referer: 'http://localhost:4360/tapico?x=1#top' }), '/tapico?x=1#top');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360', referer: 'http://elsewhere.test/tapico' }), '/');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360', referer: 'http://localhost:4360/dev/canvas/on' }), '/');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360' }), '/');
});

test('flag toggles accept an explicit return page', async () => {
  const { canvasFlagReturnPath } = await import('../dev-canvas-shell.mjs');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360' }, '/dev/canvas/chrome-on?to=/tapico'), '/tapico');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360' }, '/dev/canvas/on?to=//evil.test'), '/');
  assert.equal(canvasFlagReturnPath({ host: 'localhost:4360' }, '/dev/canvas/on?to=/dev/canvas/off'), '/');
});
