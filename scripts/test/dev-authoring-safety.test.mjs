import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createSerializedRequestQueue,
  isMutatingAuthoringRequest,
  writeAtomicJson,
} from '../dev-api-plugins.mjs';

const response = () => {
  const value = new EventEmitter();
  value.end = () => value.emit('finish');
  return value;
};

test('writeAtomicJson replaces the document and leaves no temporary file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vcd-json-'));
  const file = path.join(directory, 'document.json');
  await writeFile(file, '{"before":true}\n');

  await writeAtomicJson(file, { after: true });

  assert.equal(await readFile(file, 'utf8'), '{\n  "after": true\n}\n');
  assert.deepEqual(await readdir(directory), ['document.json']);
});

test('writeAtomicJson cleans up when replacement fails after creating the temporary file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vcd-json-'));
  const file = path.join(directory, 'document.json');
  await writeFile(file, '{"before":true}\n');
  const targetDirectory = path.join(directory, 'target');
  await mkdir(targetDirectory);

  await assert.rejects(writeAtomicJson(targetDirectory, { after: true }));

  assert.equal(await readFile(file, 'utf8'), '{"before":true}\n');
  assert.deepEqual((await readdir(directory)).sort(), ['document.json', 'target']);
});

test('authoring queue waits for response completion and releases on disconnect', async () => {
  const enqueue = createSerializedRequestQueue();
  const firstResponse = response();
  const secondResponse = response();
  const events = [];

  const first = enqueue({}, firstResponse, () => events.push('first'));
  await new Promise((resolve) => setImmediate(resolve));
  const second = enqueue({}, secondResponse, () => events.push('second'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first']);

  firstResponse.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first']);
  firstResponse.end();
  await second;
  assert.deepEqual(events, ['first', 'second']);
  secondResponse.end();
  await first;
});

test('authoring queue releases when the downstream handler throws', async () => {
  const enqueue = createSerializedRequestQueue();
  const firstResponse = response();
  const secondResponse = response();
  const first = enqueue({}, firstResponse, () => { throw new Error('writer failed'); });
  await assert.rejects(first, /writer failed/);

  let called = false;
  await enqueue({}, secondResponse, () => { called = true; });
  assert.equal(called, true);
});

test('a client disconnected before its turn is skipped and does not block the queue', async () => {
  const enqueue = createSerializedRequestQueue();
  const firstResponse = response();
  const secondResponse = response();
  const first = enqueue({}, firstResponse, () => {});
  const disconnected = enqueue({ aborted: true, destroyed: true }, secondResponse, () => {
    throw new Error('disconnected request should not run');
  });
  await new Promise((resolve) => setImmediate(resolve));
  firstResponse.end();
  await Promise.all([first, disconnected]);
});

test('only mutating authoring endpoints enter the queue', () => {
  assert.equal(isMutatingAuthoringRequest({ method: 'POST', url: '/api/content-text' }), true);
  assert.equal(isMutatingAuthoringRequest({ method: 'GET', url: '/api/content-text' }), false);
  assert.equal(isMutatingAuthoringRequest({ method: 'POST', url: '/api/dev-session-state' }), false);
  assert.equal(isMutatingAuthoringRequest({ method: 'POST', url: '/api/content-text/status' }), false);
});
