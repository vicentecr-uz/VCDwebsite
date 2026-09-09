import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSectionRestoreStore } from '../dev-section-restore.mjs';
import { contentSectionDevWriter } from '../../astro.config.mjs';

function request(body) {
  const payload = Buffer.from(JSON.stringify(body));
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() { yield payload; },
  };
}

function response() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  return {
    statusCode: 200,
    setHeader() {},
    end(value) { resolve({ status: this.statusCode, body: JSON.parse(value) }); },
    done,
  };
}

function middleware() {
  let handler;
  contentSectionDevWriter().configureServer({
    middlewares: { use(_path, next) { handler = next; } },
  });
  return handler;
}

async function withFixture(run) {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-section-restore-'));
  await mkdirFixture(root);
  process.chdir(root);
  try { return await run(root); } finally { process.chdir(previous); await rm(root, { recursive: true, force: true }); }
}

async function mkdirFixture(root) {
  const directory = path.join(root, 'src/content/projects');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'fixture.json'), JSON.stringify({
    sections: [
      { type: 'bodyText', id: 'first', paragraphs: ['Before'] },
      { type: 'sectionTitle', id: 'second', sectionId: 'second-anchor', title: 'Second', level: 2, custom: { retained: true } },
      { type: 'bodyText', id: 'third', paragraphs: ['After'] },
    ],
    outline: [
      { kind: 'group', id: 'custom-group', label: 'Custom', defaultOpen: false },
      { kind: 'section', id: 'custom-second', label: 'Second', anchor: 'second-anchor' },
    ],
  }));
}

const section = {
  type: 'sectionTitle',
  id: 'title-about',
  sectionId: 'about',
  title: 'About',
  level: 2,
  spacing: 'section',
  custom: { tone: 'quiet' },
};

test('restores exact section metadata and outline entries in their original positions', () => {
  const store = createSectionRestoreStore();
  const token = store.remember('home', section, [
    { entry: { kind: 'group', id: 'group', label: 'Group', defaultOpen: false }, index: 0 },
    { entry: { kind: 'section', id: 'custom-about', label: 'About', anchor: 'about' }, index: 2 },
  ]);
  const data = {
    sections: [{ type: 'bodyText', id: 'before' }, { type: 'bodyText', id: 'after' }],
    outline: [{ kind: 'section', id: 'other', label: 'Other', anchor: 'other' }],
  };
  const restored = store.restore('home', token, data, 1);
  data.sections.splice(1, 0, restored);
  store.restoreOutline(data, token);
  store.commit('home', token);

  assert.deepEqual(data.sections[1], section);
  assert.equal(data.outline[0].defaultOpen, false);
  assert.equal(data.outline[1].id, 'other');
  assert.equal(data.outline[2].id, 'custom-about');
  assert.throws(() => store.restore('home', token, data, 1), /already been used/);
});

test('rejects wrong documents, unknown receipts, invalid positions, and id collisions', () => {
  const store = createSectionRestoreStore();
  const token = store.remember('home', section, []);
  const data = { sections: [], outline: [] };
  assert.throws(() => store.restore('other', token, data, 0), /another document/);
  assert.throws(() => store.restore('home', 'missing', data, 0), /unknown/);
  assert.throws(() => store.restore('home', token, data, -1), /invalid/);
  assert.throws(() => store.restore('home', token, { sections: [{ id: 'title-about' }], outline: [] }, 1), /already exists/);
});

test('a failed write can release a staged receipt for a safe retry', () => {
  const store = createSectionRestoreStore();
  const token = store.remember('home', section, []);
  const data = { sections: [], outline: [] };
  const staged = store.restore('home', token, data, 0);
  assert.deepEqual(staged, section);
  store.release('home', token);
  const retried = store.restore('home', token, data, 0);
  assert.deepEqual(retried, section);
});

test('mounted writer deletes and restores an exact section from its receipt', async () => withFixture(async (root) => {
  const handler = middleware();
  const file = path.join(root, 'src/content/projects/fixture.json');

  let res = response();
  await handler(request({ document: 'fixture', action: 'delete', index: 1 }), res, () => {});
  const deleted = await res.done;
  assert.equal(deleted.status, 200);
  assert.equal(typeof deleted.body.restoreToken, 'string');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).sections.length, 2);

  res = response();
  await handler(request({
    document: 'fixture',
    action: 'restore',
    index: 1,
    restoreToken: deleted.body.restoreToken,
    section: { type: 'bodyText', id: 'attacker', paragraphs: ['Ignored'] },
  }), res, () => {});
  const restored = await res.done;
  assert.equal(restored.status, 200);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.sections[1], {
    type: 'sectionTitle',
    id: 'second',
    sectionId: 'second-anchor',
    title: 'Second',
    level: 2,
    custom: { retained: true },
  });
  assert.deepEqual(saved.outline, [
    { kind: 'group', id: 'custom-group', label: 'Custom', defaultOpen: false },
    { kind: 'section', id: 'custom-second', label: 'Second', anchor: 'second-anchor' },
  ]);
  assert.equal(restored.body.section.id, 'second');
}));

test('restore receipt survives a failed restore read for retry', async () => withFixture(async (root) => {
  const handler = middleware();
  const file = path.join(root, 'src/content/projects/fixture.json');
  let res = response();
  await handler(request({ document: 'fixture', action: 'delete', index: 1 }), res, () => {});
  const deleted = await res.done;
  await rm(file);

  res = response();
  await handler(request({ document: 'fixture', action: 'restore', index: 1, restoreToken: deleted.body.restoreToken }), res, () => {});
  assert.equal((await res.done).status, 400);

  await writeFile(file, JSON.stringify({
    sections: [
      { type: 'bodyText', id: 'first', paragraphs: ['Before'] },
      { type: 'bodyText', id: 'third', paragraphs: ['After'] },
    ],
    outline: [{ kind: 'group', id: 'custom-group', label: 'Custom', defaultOpen: false }],
  }));
  res = response();
  await handler(request({ document: 'fixture', action: 'restore', index: 1, restoreToken: deleted.body.restoreToken }), res, () => {});
  assert.equal((await res.done).status, 200);
}));
