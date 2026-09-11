import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { contentSectionDevWriter } from '../../astro.config.mjs';

const request = (body) => ({
  method: 'POST',
  async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
});

const response = () => {
  let resolve;
  const done = new Promise((next) => { resolve = next; });
  return {
    statusCode: 200,
    setHeader() {},
    end(value) { resolve({ status: this.statusCode, body: JSON.parse(value) }); },
    done,
  };
};

const middleware = () => {
  let handler;
  contentSectionDevWriter().configureServer({
    middlewares: { use(_path, next) { handler = next; } },
  });
  return handler;
};

async function withFixture(run) {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-project-details-'));
  await mkdir(path.join(root, 'src/content/projects'), { recursive: true });
  await writeFile(path.join(root, 'src/content/projects/fixture.json'), JSON.stringify({
    sections: [
      { type: 'bodyText', id: 'body', paragraphs: ['Body'] },
      {
        type: 'projectDetails',
        id: 'details',
        title: 'Project details & credits',
        rows: [{ label: 'Role', value: 'Designer' }],
      },
    ],
  }));
  process.chdir(root);
  try {
    return await run(root);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
}

async function post(handler, body) {
  const result = response();
  await handler(request(body), result, () => {});
  return result.done;
}

test('inserts project details with the default title and row', async () => withFixture(async (root) => {
  const handler = middleware();
  const result = await post(handler, { document: 'fixture', action: 'insert', type: 'projectDetails', index: 1 });
  assert.equal(result.status, 200);
  assert.equal(result.body.section.type, 'projectDetails');
  assert.equal(result.body.section.title, 'Project details & credits');
  assert.deepEqual(result.body.section.rows, [{ label: 'Role', value: '' }]);
  const saved = JSON.parse(await readFile(path.join(root, 'src/content/projects/fixture.json'), 'utf8'));
  assert.equal(saved.sections[1].type, 'projectDetails');
}));

test('updates project details rows and returns the previous rows', async () => withFixture(async () => {
  const handler = middleware();
  const rows = [
    { label: 'Client', value: 'Acme' },
    { label: 'Year', value: '2026' },
  ];
  const result = await post(handler, {
    document: 'fixture', action: 'updateProjectDetailsRows', index: 1, rows,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.previousRows, [{ label: 'Role', value: 'Designer' }]);
  assert.deepEqual(result.body.rows, rows);
}));

test('rejects malformed project details row updates', async () => withFixture(async () => {
  const handler = middleware();
  const cases = [
    [{ label: 'Role', value: 42 }],
    Array.from({ length: 101 }, () => ({ label: 'x', value: 'y' })),
    [{ label: 'x'.repeat(501), value: 'y' }],
    [{ label: 'x', value: 'y'.repeat(20_001) }],
  ];
  for (const rows of cases) {
    const result = await post(handler, {
      document: 'fixture', action: 'updateProjectDetailsRows', index: 1, rows,
    });
    assert.ok(result.status === 400 || result.status === 413);
  }
}));

test('rejects row updates for a different section type', async () => withFixture(async () => {
  const handler = middleware();
  const result = await post(handler, {
    document: 'fixture', action: 'updateProjectDetailsRows', index: 0,
    rows: [{ label: 'Role', value: 'Designer' }],
  });
  assert.equal(result.status, 400);
}));
