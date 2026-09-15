import assert from 'node:assert/strict';
import { createCarouselDragTuningHandler, validateCarouselDragTuning } from '../../scripts/carousel-drag-tuning-writer.mjs';

assert.deepEqual(validateCarouselDragTuning({ tension: 20, dragThreshold: 4, springBackMs: 260 }), { tension: 20, dragThreshold: 4, springBackMs: 260 });
assert.throws(() => validateCarouselDragTuning({ tension: 20, dragThreshold: 4 }), /Invalid/);
assert.throws(() => validateCarouselDragTuning({ tension: 81, dragThreshold: 4, springBackMs: 260 }), /Invalid/);

const request = (body, headers = { 'content-type': 'application/json', host: 'localhost:4322' }) => ({ method: 'POST', headers, async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } });
const response = () => ({ statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } });
let saved;
const handler = createCarouselDragTuningHandler({ write: async (_path, value) => { saved = value; } });
const valid = response();
await handler(request({ tension: 30, dragThreshold: 6, springBackMs: 320 }), valid, () => {});
assert.equal(valid.statusCode, 200);
assert.deepEqual(saved, { tension: 30, dragThreshold: 6, springBackMs: 320 });
const rejected = response();
await handler(request({ tension: 30, dragThreshold: 6, springBackMs: 320 }, { 'content-type': 'application/json', host: 'localhost:4322', origin: 'https://evil.example' }), rejected, () => {});
assert.equal(rejected.statusCode, 403);
const malformed = response();
await handler(request({ tension: 30, dragThreshold: 6, springBackMs: 999 }), malformed, () => {});
assert.equal(malformed.statusCode, 400);
