import assert from 'node:assert/strict';
import test from 'node:test';
import { devCanvasShell, shouldServeCanvasShell } from '../dev-canvas-shell.mjs';

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
  for (const enabled of [true, false]) {
    const headers = {};
    let ended = false;
    const res = { setHeader: (key, value) => { headers[key] = value; }, end: () => { ended = true; } };
    middleware({ ...request, url: `/dev/canvas/${enabled ? 'on' : 'off'}` }, res, () => assert.fail('redirect must end'));
    assert.equal(res.statusCode, 302);
    assert.equal(headers.Location, '/');
    assert.equal(headers['Set-Cookie'], enabled ? 'vcd-canvas=1; Path=/; SameSite=Lax' : 'vcd-canvas=; Path=/; SameSite=Lax; Max-Age=0');
    assert.equal(ended, true);
  }
  const req = { ...request };
  let next = false;
  middleware(req, {}, () => { next = true; });
  assert.equal(req.url, '/dev/canvas-shell');
  assert.equal(next, true);
});
