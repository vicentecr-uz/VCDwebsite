import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeOutline } from '../../src/lib/projectOutline.ts';
import { validateProjectOutline } from '../dev-api-plugins.mjs';
import { contentNavDevWriter, syncOutlineForSectionMutation } from '../../astro.config.mjs';
import { sectionOrderDevWriter } from '../dev-api-plugins.mjs';

test('outline validation accepts an explicit empty outline', () => {
  assert.equal(validateProjectOutline([]), true);
});

test('outline validation rejects malformed and duplicate identities', () => {
  assert.equal(validateProjectOutline([{ kind: 'section', id: 'a', label: 'A' }, { kind: 'section', id: 'a', label: 'Again' }]), false);
  assert.equal(validateProjectOutline([{ kind: 'subsection', id: 'a', label: 'A' }, { kind: 'section', id: 'a', label: 'A again' }]), false);
  assert.equal(validateProjectOutline([{ kind: 'group', id: 'a', label: 'A' }, { kind: 'section', id: 'a', label: 'Legacy group', defaultOpen: false }]), false);
  assert.equal(validateProjectOutline([{ kind: 'section', id: 'a', label: 'A' }, { kind: 'group', id: 'a', label: 'Group' }]), true);
  assert.equal(validateProjectOutline([{ kind: 'section', id: 'a', label: 'A' }, { kind: 'section', id: '', label: 'Missing id' }]), false);
});

test('outline normalization preserves supplied ids and anchors while migrating legacy kinds', () => {
  assert.deepEqual(normalizeOutline([
    { kind: 'subsection', id: 'custom-id', label: 'Custom', anchor: 'block-id' },
    { kind: 'section', id: 'legacy-group', label: 'Legacy', defaultOpen: false, anchor: 'first' },
  ]), [
    { kind: 'section', id: 'custom-id', label: 'Custom', anchor: 'block-id' },
    { kind: 'group', id: 'legacy-group', label: 'Legacy', defaultOpen: false, anchor: 'first' },
  ]);
});

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

function middlewareFor(factory) {
  let handler;
  factory().configureServer({ middlewares: { use(_path, next) { handler = next; } } });
  return handler;
}

async function withFixture(run) {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-outline-'));
  await mkdir(path.join(root, 'src/content/projects'), { recursive: true });
  await writeFile(path.join(root, 'src/content/projects/fixture.json'), JSON.stringify({
    sections: [{ type: 'sectionTitle', id: 'first' }, { type: 'bodyText', id: 'second' }],
    outline: [{ kind: 'section', id: 'old', label: 'Old', anchor: 'first' }],
  }));
  process.chdir(root);
  try { return await run(root); } finally { process.chdir(previous); await rm(root, { recursive: true, force: true }); }
}

test('content-nav persists empty and stable anchored outlines', async () => withFixture(async (root) => {
  const handler = middlewareFor(contentNavDevWriter);
  let res = response();
  await handler(request({ document: 'fixture', outline: [] }), res, () => {});
  assert.equal((await res.done).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'src/content/projects/fixture.json'))).outline, []);

  res = response();
  await handler(request({ document: 'fixture', outline: [{ kind: 'section', id: 'renamed', label: 'Renamed', anchor: 'second' }] }), res, () => {});
  assert.equal((await res.done).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'src/content/projects/fixture.json'))).outline, [{ kind: 'section', id: 'renamed', label: 'Renamed', anchor: 'second' }]);
}));

test('content-nav rejects missing, malformed, and invalid patches without writing', async () => withFixture(async (root) => {
  const handler = middlewareFor(contentNavDevWriter);
  for (const body of [{ document: 'fixture' }, { document: 'fixture', outline: [{ kind: 'wat', id: 'x', label: 'X' }] }, { document: 'fixture', outline: [], sectionIds: [] }, { document: 'fixture', outline: [], showTitles: 'bad' }]) {
    const res = response();
    await handler(request(body), res, () => {});
    assert.equal((await res.done).status, 400);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'src/content/projects/fixture.json'))).outline, [{ kind: 'section', id: 'old', label: 'Old', anchor: 'first' }]);
}));

test('section order persists an explicitly empty outline', async () => withFixture(async (root) => {
  const handler = middlewareFor(sectionOrderDevWriter);
  const res = response();
  await handler(request({ document: 'fixture', order: [1, 0], outline: [] }), res, () => {});
  assert.equal((await res.done).status, 200);
  const saved = JSON.parse(await readFile(path.join(root, 'src/content/projects/fixture.json')));
  assert.deepEqual(saved.outline, []);
  assert.equal(saved.sections[0].id, 'second');
}));

test('section mutations match anchors without deleting stable ids', () => {
  const data = {
    sections: [{ id: 'block-a' }, { id: 'block-b' }],
    outline: [
      { kind: 'group', id: 'block-a', label: 'Group', anchor: 'block-a' },
      { kind: 'section', id: 'stable-a', label: 'A', anchor: 'block-a' },
      { kind: 'section', id: 'stable-b', label: 'B', anchor: 'block-b' },
    ],
  };
  syncOutlineForSectionMutation(data, { action: 'insert', section: { type: 'sectionTitle', id: 'block-a', title: 'New' }, index: 0 });
  assert.deepEqual(data.outline.map(({ kind, id, anchor }) => ({ kind, id, anchor })), [
    { kind: 'group', id: 'block-a', anchor: 'block-a' },
    { kind: 'section', id: 'block-a', anchor: 'block-a' },
    { kind: 'section', id: 'stable-b', anchor: 'block-b' },
  ]);

  syncOutlineForSectionMutation(data, { action: 'delete', section: { id: 'block-a' } });
  assert.deepEqual(data.outline.map((entry) => entry.id), ['stable-b']);
});


test('styles can save an intentionally empty override of its generated catalog', async () => withFixture(async (root) => {
  await mkdir(path.join(root, 'src/content/pages'), { recursive: true });
  await writeFile(path.join(root, 'src/content/pages/styles.json'), JSON.stringify({ sections: [], outline: [] }));
  const handler = middlewareFor(contentNavDevWriter);
  const res = response();
  await handler(request({ document: 'styles', outline: [] }), res, () => {});
  assert.equal((await res.done).status, 200);
  const saved = JSON.parse(await readFile(path.join(root, 'src/content/pages/styles.json')));
  assert.deepEqual(saved.outline, []);
  assert.equal(saved.outlineConfigured, true);
}));
