import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIDEO_DIAGNOSTICS_PATH,
  createVideoDiagnosticsHandler,
  validateVideoDiagnostics,
  videoDiagnosticsWriter,
} from '../../scripts/video-diagnostics.mjs';

const report = {
  pathname: '/work/example',
  userAgent: 'test-agent',
  errors: Array.from({ length: 10 }, (_, index) => ({ message: `error-${index}`, filename: 'page.js' })),
  definitions: { 'media-controller': true },
  videos: [{ controls: true, playsInline: true, readyState: 4, errorCode: null, controllerExists: true }],
};

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; },
  };
}

function request(body, headers = {}) {
  return {
    method: 'POST',
    headers: { host: 'localhost:4321', origin: 'http://localhost:4321', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
  };
}

test('normalizes a bounded report and keeps only known video fields', () => {
  const normalized = validateVideoDiagnostics(report);
  assert.equal(normalized.errors.length, 8);
  assert.deepEqual(Object.keys(normalized.videos[0]).sort(), [
    'computedControllerDisplay', 'computedVideoTransform', 'controllerExists', 'controls',
    'customPlayCount', 'enhancedMarker', 'errorCode', 'playsInline', 'readyState',
  ].sort());
});

test('DEV endpoint writes valid same-origin JSON to its fixed report path', async () => {
  let saved;
  const handler = createVideoDiagnosticsHandler({ write: async (path, value) => { saved = { path, value }; } });
  const res = response();
  await handler(request(JSON.stringify(report)), res, () => assert.fail('valid request fell through'));
  assert.equal(res.statusCode, 200);
  assert.equal(saved.path, VIDEO_DIAGNOSTICS_PATH);
  assert.equal(saved.value.errors.length, 8);
});

test('DEV endpoint rejects non-JSON, cross-site, malformed, and oversized requests', async () => {
  for (const headers of [
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const res = response();
    await createVideoDiagnosticsHandler()(request(JSON.stringify(report), headers), res, () => {});
    assert.equal(res.statusCode, 400);
  }
  const malformed = response();
  await createVideoDiagnosticsHandler()(request('{}'), malformed, () => {});
  assert.equal(malformed.statusCode, 400);
  const oversized = response();
  await createVideoDiagnosticsHandler()(request(JSON.stringify({ ...report, userAgent: 'x'.repeat(16_000) })), oversized, () => {});
  assert.equal(oversized.statusCode, 400);
});

test('writer registers the expected DEV-only route', () => {
  let route;
  videoDiagnosticsWriter().configureServer({ middlewares: { use(path, handler) { route = { path, handler }; } } });
  assert.equal(route.path, '/api/video-diagnostics');
  assert.equal(videoDiagnosticsWriter().apply, 'serve');
});
