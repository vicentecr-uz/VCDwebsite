import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createSerializedRequestQueue,
  isMutatingAuthoringRequest,
  writeAtomicJson,
} from '../dev-api-plugins.mjs';

test('writeAtomicJson replaces the document and leaves no temporary file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vcd-json-'));
  const file = path.join(directory, 'document.json');
  await writeFile(file, '{"before":true}\n');

  await writeAtomicJson(file, { after: true });

  assert.equal(await readFile(file, 'utf8'), '{\n  "after": true\n}\n');
  assert.deepEqual(await readdir(directory), ['document.json']);
});

test('writeAtomicJson cleans up when serializing fails without touching the document', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vcd-json-'));
  const file = path.join(directory, 'document.json');
  await writeFile(file, '{"before":true}\n');
  const circular = {};
  circular.self = circular;

  await assert.rejects(writeAtomicJson(file, circular), TypeError);

  assert.equal(await readFile(file, 'utf8'), '{"before":true}\n');
  assert.deepEqual(await readdir(directory), ['document.json']);
});

test('authoring queue waits for response completion and releases on disconnect', async () => {
  const enqueue = createSerializedRequestQueue();
  const firstResponse = new EventEmitter();
  const secondResponse = new EventEmitter();
  const events = [];

  const first = enqueue({}, firstResponse, () => events.push('first'));
  await new Promise((resolve) => setImmediate(resolve));
  const second = enqueue({}, secondResponse, () => events.push('second'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first']);

  firstResponse.emit('close');
  await second;
  assert.deepEqual(events, ['first', 'second']);
  secondResponse.emit('finish');
  await first;
});

test('authoring queue releases when the downstream handler throws', async () => {
  const enqueue = createSerializedRequestQueue();
  const firstResponse = new EventEmitter();
  const secondResponse = new EventEmitter();
  const first = enqueue({}, firstResponse, () => { throw new Error('writer failed'); });
  await assert.rejects(first, /writer failed/);

  let called = false;
  await enqueue({}, secondResponse, () => { called = true; });
  assert.equal(called, true);
});

test('only mutating authoring endpoints enter the queue', () => {
  assert.equal(isMutatingAuthoringRequest({ method: 'POST', url: '/api/content-text' }), true);
  assert.equal(isMutatingAuthoringRequest({ method: 'GET', url: '/api/content-text' }), false);
  assert.equal(isMutatingAuthoringRequest({ method: 'POST', url: '/api/dev-session-state' }), false);
  assert.equal(isMutatingAuthoringRequest({ method: 'POST', url: '/api/content-text/status' }), false);
});
