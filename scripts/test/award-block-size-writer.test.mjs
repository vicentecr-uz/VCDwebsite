import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAwardBlockSizeHandler, validateAwardBlockSize } from '../award-block-size-writer.mjs';

const makeResponse = () => {
  const response = { statusCode: 200, headers: {}, body: '' };
  response.setHeader = (name, value) => { response.headers[name] = value; };
  response.end = (body = '') => { response.body = body; };
  return response;
};

const request = (body, headers = {}) => Object.assign(Readable.from([JSON.stringify(body)]), {
  method: 'POST',
  headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
});

test('award block size writer accepts the exact bounded configuration and writes it', async () => {
  let written;
  const handler = createAwardBlockSizeHandler({ write: async (_path, value) => { written = value; } });
  const response = makeResponse();
  await handler(request({ mobile: 64, tablet: 96, desktop: 120 }), response, () => {});
  assert.equal(response.statusCode, 200);
  assert.deepEqual(written, { mobile: 64, tablet: 96, desktop: 120 });
});

test('invalid award block size is rejected without writing', async () => {
  let writes = 0;
  const handler = createAwardBlockSizeHandler({ write: async () => { writes += 1; } });
  const response = makeResponse();
  await handler(request({ mobile: 31, tablet: 96, desktop: 120 }), response, () => {});
  assert.equal(response.statusCode, 400);
  assert.equal(writes, 0);
  assert.throws(() => validateAwardBlockSize({ mobile: 64, tablet: 96, desktop: 120, extra: 1 }));
});

test('cross-origin award block size requests are rejected without writing', async () => {
  let writes = 0;
  const handler = createAwardBlockSizeHandler({ write: async () => { writes += 1; } });
  const response = makeResponse();
  await handler(request({ mobile: 64, tablet: 96, desktop: 120 }, { origin: 'https://evil.example' }), response, () => {});
  assert.equal(response.statusCode, 403);
  assert.equal(writes, 0);
});
