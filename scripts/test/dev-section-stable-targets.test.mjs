import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contentSectionDevWriter } from '../../astro.config.mjs';
import { sectionOrderDevWriter } from '../dev-api-plugins.mjs';

const request = (body) => ({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } });
const response = () => { let resolve; const done = new Promise((r) => { resolve = r; }); return { statusCode: 200, setHeader() {}, end(value) { resolve({ status: this.statusCode, body: JSON.parse(value) }); }, done }; };
const middleware = (factory) => { let handler; factory().configureServer({ middlewares: { use(_path, next) { handler = next; } } }); return handler; };
const post = async (handler, body) => { const result = response(); await handler(request(body), result, () => {}); return result.done; };

async function withFixture(source, run) {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-section-target-'));
  await mkdir(path.join(root, 'src/content/projects'), { recursive: true });
  const file = path.join(root, 'src/content/projects/fixture.json');
  await writeFile(file, JSON.stringify(source));
  process.chdir(root);
  try { return await run(file); } finally { process.chdir(previous); await rm(root, { recursive: true, force: true }); }
}

const source = () => ({ sections: [
  { id: 'before', type: 'bodyText', paragraphs: ['before'] },
  { id: 'target', type: 'bodyText', paragraphs: ['target'] },
  { id: 'details', type: 'projectDetails', rows: [{ label: 'Role', value: 'Old' }] },
] });

test('existing section actions resolve stale positions by section ID', async () => {
  await withFixture(source(), async (file) => {
    const handler = middleware(contentSectionDevWriter);
    const deleted = await post(handler, { document: 'fixture', action: 'delete', index: 0, target: { sectionId: 'target' } });
    assert.equal(deleted.status, 200);
    let saved = JSON.parse(await readFile(file));
    assert.deepEqual(saved.sections.map((section) => section.id), ['before', 'details']);

    const converted = await post(handler, { document: 'fixture', action: 'convert', index: 0, target: { sectionId: 'before' }, type: 'sectionTitle' });
    assert.equal(converted.status, 200);
    saved = JSON.parse(await readFile(file));
    assert.equal(saved.sections[0].id, 'before');
    assert.equal(saved.sections[0].type, 'sectionTitle');
  });
});

test('project details rows resolve by ID and invalid IDs do not write', async () => {
  await withFixture(source(), async (file) => {
    const handler = middleware(contentSectionDevWriter);
    const updated = await post(handler, { document: 'fixture', action: 'updateProjectDetailsRows', index: 0, target: { sectionId: 'details' }, rows: [{ label: 'Client', value: 'New' }] });
    assert.equal(updated.status, 200);
    const before = await readFile(file, 'utf8');
    const invalid = await post(handler, { document: 'fixture', action: 'delete', index: 0, target: { sectionId: 'missing' } });
    assert.equal(invalid.status, 400);
    assert.equal(await readFile(file, 'utf8'), before);
  });
});

test('section order accepts stable IDs and rejects stale or incomplete lists', async () => {
  await withFixture(source(), async (file) => {
    const handler = middleware(sectionOrderDevWriter);
    const reordered = await post(handler, { document: 'fixture', orderIds: ['details', 'target', 'before'] });
    assert.equal(reordered.status, 200);
    assert.deepEqual(JSON.parse(await readFile(file)).sections.map((section) => section.id), ['details', 'target', 'before']);
    const before = await readFile(file, 'utf8');
    for (const orderIds of [['details', 'target', 'missing'], ['details', 'target'], ['details', 'details', 'before']]) {
      const invalid = await post(handler, { document: 'fixture', orderIds });
      assert.equal(invalid.status, 400);
      assert.equal(await readFile(file, 'utf8'), before);
    }
  });
});
