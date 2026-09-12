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

const writer = (name) => {
  const plugin = config.vite.plugins.find((entry) => entry?.name === name);
  assert.ok(plugin, `missing ${name}`);
  let handler;
  plugin.configureServer({ middlewares: { use(_path, next) { handler = next; } } });
  assert.ok(handler, `missing middleware for ${name}`);
  return handler;
};

test('stable save targets survive stale section and item positions across save endpoints', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-save-'));
  const directory = path.join(root, 'src/content/projects');
  const file = path.join(directory, 'fixture.json');
  await mkdir(directory, { recursive: true });
  const source = {
    sections: [
      { id: 'intro', type: 'bodyText', paragraphs: ['intro'], spacing: 'none' },
      { id: 'gallery', type: 'imageGrid', items: [{ id: 'photo-a', src: 'a.jpg', caption: 'A' }, { id: 'photo-b', src: 'b.jpg' }], spacing: 'section' },
      { id: 'copy', type: 'bodyText', paragraphs: ['copy'], spacing: 'major' },
    ],
  };
  await writeFile(file, JSON.stringify(source));
  process.chdir(root);
  try {
    const batch = writer('content-batch-dev-writer');
    const result = response();
    await batch(request({
      crops: [{ document: 'fixture', path: ['sections', 0, 'items', 0], target: { sectionId: 'gallery', itemId: 'photo-a' }, src: 'new.jpg', variants: { desktop: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 } } }],
      captions: [{ document: 'fixture', path: ['sections', 0, 'items', 1], target: { sectionId: 'gallery', itemId: 'photo-a' }, captions: { desktop: 'Caption', tablet: 'Caption', mobile: 'Caption' }, captionStyle: 'white', captionPosition: 'bottom-left', captionReveal: 'hover' }],
      text: [{ document: 'fixture', path: ['sections', 0, 'paragraphs', 0], target: { sectionId: 'copy' }, value: 'updated' }],
      spacing: [{ document: 'fixture', path: ['sections', 0, 'spacing'], target: { sectionId: 'copy' }, value: 'related' }],
    }), result, () => {});
    const batchResponse = await result.done;
    assert.equal(batchResponse.status, 200, JSON.stringify(batchResponse.body));
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.sections[1].items[0].src, 'new.jpg');
    assert.equal(saved.sections[1].items[0].caption, 'Caption');
    assert.equal(saved.sections[2].paragraphs[0], 'updated');
    assert.equal(saved.sections[2].spacing, 'related');
    assert.equal(saved.sections[1].items[1].src, 'b.jpg');

    const beforeFailure = await readFile(file, 'utf8');
    const failed = response();
    await batch(request({ text: [
      { document: 'fixture', path: ['sections', 0, 'paragraphs', 0], target: { sectionId: 'copy' }, value: 'would not persist' },
      { document: 'fixture', path: ['sections', 0, 'paragraphs', 0], target: { sectionId: 'missing' }, value: 'bad' },
    ] }), failed, () => {});
    assert.equal((await failed.done).status, 400);
    assert.equal(await readFile(file, 'utf8'), beforeFailure);

    const text = writer('content-text-dev-writer');
    const textResult = response();
    await text(request({ changes: [{ document: 'fixture', path: ['sections', 0, 'paragraphs', 0], target: { sectionId: 'copy' }, value: 'text endpoint' }] }), textResult, () => {});
    assert.equal((await textResult.done).status, 200);
    const spacing = writer('content-spacing-dev-writer');
    const spacingResult = response();
    await spacing(request({ changes: [{ document: 'fixture', path: ['sections', 0, 'spacing'], target: { sectionId: 'copy' }, value: 'section' }] }), spacingResult, () => {});
    assert.equal((await spacingResult.done).status, 200);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('media append and remove report and use the resolved section index', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-media-'));
  const directory = path.join(root, 'src/content/projects');
  const file = path.join(directory, 'fixture.json');
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ sections: [
    { id: 'other', type: 'bodyText', paragraphs: ['x'] },
    { id: 'gallery', type: 'imageGrid', items: [{ id: 'a', src: 'a.jpg' }] },
  ] }));
  process.chdir(root);
  try {
    const section = writer('content-section-dev-writer');
    const appended = response();
    await section(request({ document: 'fixture', action: 'appendMediaItems', path: ['sections', 0], target: { sectionId: 'gallery' }, srcs: ['b.jpg'] }), appended, () => {});
    assert.equal((await appended.done).status, 200);
    assert.equal((await readFile(file, 'utf8')).includes('b.jpg'), true);
    assert.equal((await appended.done).body?.index, 1);
    const removed = response();
    await section(request({ document: 'fixture', action: 'removeMediaItem', path: ['sections', 0], target: { sectionId: 'gallery' }, itemId: 'a' }), removed, () => {});
    assert.equal((await removed.done).status, 200);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.sections[1].items.map((item) => item.src), ['b.jpg']);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
