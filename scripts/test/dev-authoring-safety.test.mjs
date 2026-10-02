import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

test('authoring queue waits for the writer after a client disconnects', async () => {
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


test('settings undo can clear a hover image while omitted fields retain it', async () => {
  const { listingCardForGrid } = await import('../dev-api-plugins.mjs');
  const previous = { image: 'cover.jpg', hoverImage: 'hover.jpg' };
  assert.equal(listingCardForGrid('home', { image: 'cover.jpg', hoverImage: '' }, previous).hoverImage, undefined);
  assert.equal(listingCardForGrid('home', { image: 'cover.jpg' }, previous).hoverImage, 'hover.jpg');
});

function requestFor(body) {
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function responseFor() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; },
  };
}

test('project creation rejects retired Work and defaults an omitted grid to Home', async () => {
  const { projectCreateDevWriter } = await import('../dev-api-plugins.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-project-create-'));
  await mkdir(path.join(root, 'src/content/projects'), { recursive: true });
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  const previousCwd = process.cwd();
  let handler;
  try {
    process.chdir(root);
    projectCreateDevWriter().configureServer({ middlewares: { use(_path, callback) { handler = callback; } } });
    const invalidResponse = responseFor();
    await handler(requestFor({ title: 'Retired', slug: 'retired', grid: 'work' }), invalidResponse, () => {});
    assert.equal(invalidResponse.statusCode, 400);
    const validResponse = responseFor();
    await handler(requestFor({ title: 'Home project', slug: 'home-project' }), validResponse, () => {});
    assert.equal(validResponse.statusCode, 200);
    const created = JSON.parse(await readFile(path.join(root, 'src/content/projects/home-project.json'), 'utf8'));
    assert.ok(created.listings.home);
    assert.equal(created.listings.play, undefined);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test('settings rejects retired Work listings and preserves Home/Play siblings', async () => {
  const { projectSettingsDevWriter } = await import('../dev-api-plugins.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-project-settings-'));
  await mkdir(path.join(root, 'src/content/projects'), { recursive: true });
  const file = path.join(root, 'src/content/projects/demo.json');
  const original = {
    slug: 'demo', title: 'Demo', status: 'published', listings: {
      home: { image: 'home.jpg', variants: { desktop: { aspect: '4:3' } } },
      play: { image: 'play.jpg', meta: 'Play' },
    }, sections: [],
  };
  await writeFile(file, JSON.stringify(original));
  const previousCwd = process.cwd();
  let handler;
  try {
    process.chdir(root);
    projectSettingsDevWriter().configureServer({ middlewares: { use(_path, callback) { handler = callback; } } });
    for (const body of [
      { slug: 'demo', grid: 'work' },
      { slug: 'demo', listings: { work: { image: 'retired.jpg' } } },
    ]) {
      const invalidResponse = responseFor();
      await handler(requestFor(body), invalidResponse, () => {});
      assert.equal(invalidResponse.statusCode, 400);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), original);
    }
    const validResponse = responseFor();
    await handler(requestFor({ slug: 'demo', listings: {
      home: { image: 'home-new.jpg', variants: { desktop: { aspect: '3:2' } } },
    } }), validResponse, () => {});
    assert.equal(validResponse.statusCode, 200);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.listings.home.image, 'home-new.jpg');
    assert.deepEqual(saved.listings.home.variants, { desktop: { aspect: '3:2' } });
    assert.deepEqual(saved.listings.play, original.listings.play);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
