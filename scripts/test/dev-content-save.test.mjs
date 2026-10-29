import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
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
  await mkdir(path.join(root, 'media'));
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
    .jpeg().toFile(path.join(root, 'media/new.jpg'));
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

test('header settings links normalize safe URLs and reject unsafe URLs', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-header-settings-'));
  const directory = path.join(root, 'src/content/settings');
  const file = path.join(directory, 'header.json');
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ menuLinks: [{ label: 'Work', href: '/' }] }));
  process.chdir(root);
  try {
    const text = writer('content-text-dev-writer');
    const saved = response();
    await text(request({ changes: [
      { document: 'header-settings', path: ['menuLinks', 0, 'label'], value: 'Physical' },
      { document: 'header-settings', path: ['menuLinks', 0, 'href'], value: 'example.com/work' },
    ] }), saved, () => {});
    assert.equal((await saved.done).status, 200);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).menuLinks[0].label, 'Physical');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).menuLinks[0].href, 'https://example.com/work');

    const batch = writer('content-batch-dev-writer');
    const rejected = response();
    await batch(request({ text: [{ document: 'header-settings', path: ['menuLinks', 0, 'href'], value: 'javascript:alert(1)' }] }), rejected, () => {});
    assert.equal((await rejected.done).status, 400);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).menuLinks[0].href, 'https://example.com/work');
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('Reddit board heights save only on the matching section with bounded breakpoint values', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-board-height-'));
  const directory = path.join(root, 'src/content/projects');
  const file = path.join(directory, 'fixture.json');
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ sections: [
    { id: 'other', type: 'bodyText', paragraphs: ['x'] },
    { id: 'comments', type: 'redditCommentCarousel', items: [] },
  ] }));
  process.chdir(root);
  try {
    const spacing = writer('content-spacing-dev-writer');
    const change = (value, sectionId = 'comments') => ({ changes: [{
      document: 'fixture', path: ['sections', 0, 'viewportMaxEm'], target: { sectionId }, value,
    }] });
    const heights = { desktop: 22, tablet: 30, mobile: 24 };
    const saved = response();
    await spacing(request(change(heights)), saved, () => {});
    assert.equal((await saved.done).status, 200, JSON.stringify((await saved.done).body));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).sections[1].viewportMaxEm, heights);
    for (const invalid of [change({ ...heights, mobile: 61 }), change(heights, 'other')]) {
      const rejected = response();
      await spacing(request(invalid), rejected, () => {});
      assert.equal((await rejected.done).status, 400);
    }
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).sections[1].viewportMaxEm, heights);
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

test('styles intro paragraphs save and reload without changing its outline', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-styles-'));
  const directory = path.join(root, 'src/content/pages');
  const file = path.join(directory, 'styles.json');
  const outline = [{ kind: 'section', id: 'styles-components', label: 'Page Blocks', anchor: 'styles-components' }];
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ introParagraphs: ['Original intro'], outline }));
  process.chdir(root);
  try {
    const text = writer('content-text-dev-writer');
    const result = response();
    await text(request({ changes: [{ document: 'styles', path: ['introParagraphs'], value: ['Updated intro', 'Second paragraph'] }] }), result, () => {});
    assert.equal((await result.done).status, 200);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.introParagraphs, ['Updated intro', 'Second paragraph']);
    assert.deepEqual(saved.outline, outline);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).introParagraphs, saved.introParagraphs);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('paragraph wrapping and right-indent runs survive the batch Save endpoint and disk reload', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-wrapping-'));
  const directory = path.join(root, 'src/content/pages');
  const file = path.join(directory, 'about.json');
  await mkdir(directory, { recursive: true });
  const source = { sections: [{ id: 'copy', type: 'bodyText', balance: true, paragraphs: ['Original'] }] };
  const paragraphs = [
    '<span data-text-wrap="auto"><span class="text-emphasis">Heading</span></span>',
    '<span data-text-wrap="pretty">Supporting <em>copy</em></span>',
    '<span data-text-wrap="normal">Body <a href="/work">link</a></span>',
    '<span data-text-wrap="balance">Explicit balance</span>',
    '<span class="text-emphasis">Role</span><span data-text-right-tab="true"><a href="/work">2024–2025</a></span><br>Design Engineer',
    'Unfinished<span data-text-right-tab="true"></span>',
  ];
  await writeFile(file, JSON.stringify(source));
  process.chdir(root);
  try {
    const result = response();
    await writer('content-batch-dev-writer')(request({
      text: [{ document: 'about', path: ['sections', 0, 'paragraphs'], target: { sectionId: 'copy' }, value: paragraphs }],
    }), result, () => {});
    assert.equal((await result.done).status, 200);
    const reloaded = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(reloaded.sections[0].paragraphs, paragraphs);
    assert.equal(reloaded.sections[0].balance, true);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
