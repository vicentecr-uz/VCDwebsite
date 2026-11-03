import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contentSectionDevWriter } from '../../astro.config.mjs';
import { validatePageDocument, validateProjectDocument } from '../../src/lib/content-schema';

async function withFixture(run) {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-divider-'));
  const file = path.join(root, 'src/content/pages/fixture.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ sections: [{ type: 'bodyText', id: 'body', paragraphs: ['Body'] }] }));
  process.chdir(root);
  let handler;
  contentSectionDevWriter().configureServer({ middlewares: { use(_path, next) { handler = next; } } });
  const post = async (body) => {
    let resolve;
    const done = new Promise(next => { resolve = next; });
    const response = { statusCode: 200, setHeader() {}, end(value) { resolve({ status: this.statusCode, body: JSON.parse(value) }); } };
    await handler({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ document: 'fixture', ...body })); } }, response, () => {});
    return done;
  };
  try { return await run({ post, file }); }
  finally { process.chdir(previous); await rm(root, { recursive: true, force: true }); }
}

test('divider schema accepts independent spacing without text and stays modern-only', () => {
  const divider = { type: 'divider', id: 'rule', spacing: { desktop: 'group', mobile: 'related' } };
  const document = { sections: [divider] };
  assert.deepEqual(validatePageDocument(document, 'divider.json').sections[0], divider);
  assert.throws(() => validateProjectDocument({ title: 'Legacy', stack: 'legacy', ...document }, 'legacy.json'), /sections\[0\]\.type/);
});

test('inserts a standalone divider with standard spacing and no synthetic text fields', async () => withFixture(async ({ post, file }) => {
  const result = await post({ action: 'insert', type: 'divider', index: 1 });
  assert.equal(result.status, 200);
  assert.equal(result.body.section.type, 'divider');
  assert.match(result.body.section.id, /^divider-/);
  assert.equal(result.body.section.spacing, 'group');
  assert.deepEqual(Object.keys(result.body.section).sort(), ['id', 'spacing', 'type']);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.sections[1], result.body.section);
  validatePageDocument(saved, 'fixture.json');
}));

test('divider deletion and restoration preserve its id and responsive spacing', async () => withFixture(async ({ post, file }) => {
  const spacing = { desktop: 'section', mobile: 'related' };
  const inserted = await post({ action: 'insert', type: 'divider', index: 1, spacing });
  assert.equal(inserted.status, 200);
  assert.deepEqual(inserted.body.section.spacing, spacing);
  const deleted = await post({ action: 'delete', index: 1 });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.section, inserted.body.section);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).sections.length, 1);
  const restored = await post({ action: 'restore', index: 1, restoreToken: deleted.body.restoreToken });
  assert.equal(restored.status, 200);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.sections[1], inserted.body.section);
}));
