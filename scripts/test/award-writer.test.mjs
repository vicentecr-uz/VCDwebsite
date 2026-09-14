import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '../../astro.config.mjs';

const request = (body) => {
  const payload = Buffer.from(JSON.stringify(body));
  return { method: 'POST', async *[Symbol.asyncIterator]() { yield payload; } };
};

const response = () => {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  return { statusCode: 200, setHeader() {}, end(value) { resolve({ status: this.statusCode, body: JSON.parse(value) }); }, done };
};

const middleware = (factory) => {
  let handler;
  factory().configureServer({ middlewares: { use(_path, next) { handler = next; } } });
  assert.ok(handler);
  return handler;
};

const configuredMiddleware = (name) => {
  const plugin = config.vite.plugins.find((entry) => entry?.name === name);
  assert.ok(plugin, `missing ${name}`);
  return middleware(() => plugin);
};

test('inserts an award, saves its link by stable section ID, and restores it after delete', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-award-writer-'));
  const directory = path.join(root, 'src/content/projects');
  const file = path.join(directory, 'fixture.json');
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ sections: [
    { type: 'bodyText', id: 'before', paragraphs: ['Before'] },
    { type: 'bodyText', id: 'after', paragraphs: ['After'] },
  ] }));
  process.chdir(root);
  try {
    const sections = configuredMiddleware('content-section-dev-writer');
    let res = response();
    await sections(request({ document: 'fixture', action: 'insert', index: 1, type: 'award', spacing: 'section' }), res, () => {});
    const inserted = await res.done;
    assert.equal(inserted.status, 200, JSON.stringify(inserted.body));
    assert.equal(inserted.body.section.type, 'award');
    assert.equal(inserted.body.section.href, '');
    assert.match(inserted.body.section.id, /^award-/);

    const text = configuredMiddleware('content-text-dev-writer');
    res = response();
    await text(request({ changes: [{
      document: 'fixture',
      path: ['sections', 0, 'href'],
      target: { sectionId: inserted.body.section.id },
      value: 'javascript:alert(1)',
    }] }), res, () => {});
    const unsafe = await res.done;
    assert.equal(unsafe.status, 400, 'unsafe award URLs must be rejected by the writer');

    res = response();
    await text(request({ changes: [{
      document: 'fixture',
      path: ['sections', 0, 'href'],
      target: { sectionId: inserted.body.section.id },
      value: 'https://ifdesign.com/en/winner-ranking/project/goodhome-painting-tools/768056',
    }] }), res, () => {});
    assert.equal((await res.done).status, 200);
    let saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.sections[1].href, 'https://ifdesign.com/en/winner-ranking/project/goodhome-painting-tools/768056');

    const batch = configuredMiddleware('content-batch-dev-writer');
    res = response();
    await batch(request({ text: [{
      document: 'fixture',
      path: ['sections', 0, 'href'],
      target: { sectionId: inserted.body.section.id },
      value: 'javascript:alert(1)',
    }] }), res, () => {});
    assert.equal((await res.done).status, 400, 'batch saves must reject unsafe award URLs');

    res = response();
    await batch(request({ text: [{
      document: 'fixture',
      path: ['sections', 0, 'href'],
      target: { sectionId: inserted.body.section.id },
      value: '',
    }] }), res, () => {});
    assert.equal((await res.done).status, 200);
    saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.sections[1].href, '');

    res = response();
    await sections(request({ document: 'fixture', action: 'delete', index: 0, target: { sectionId: inserted.body.section.id } }), res, () => {});
    const deleted = await res.done;
    assert.equal(deleted.status, 200);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).sections.some((section) => section.type === 'award'), false);

    res = response();
    await sections(request({ document: 'fixture', action: 'restore', index: 1, restoreToken: deleted.body.restoreToken }), res, () => {});
    assert.equal((await res.done).status, 200);
    saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.sections[1].type, 'award');
    assert.equal(saved.sections[1].href, '');
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
