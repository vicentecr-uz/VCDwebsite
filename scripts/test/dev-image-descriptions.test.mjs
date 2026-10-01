import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createImageDescriptionsService } from '../dev-image-descriptions.mjs';

function response(body, type = 'text/html', status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': type, ...headers } });
}

test('enumerates only reached public raster usages and saves with a source CAS', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-image-descriptions-'));
  try {
    const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d8d8d8' } }).png().toBuffer();
    const docs = {
      home: { title: 'Home', sections: [{ type: 'image', id: 'hero', src: 'hero.png', alt: '', altIntent: 'auto' }] },
      private: { title: 'Private', status: 'draft', sections: [{ type: 'image', id: 'private', src: 'private.png', alt: '', altIntent: 'auto' }] },
    };
    const readDocument = async (document) => { if (!docs[document]) throw new Error('missing'); return structuredClone(docs[document]); };
    const writeDocument = async (document, data) => { docs[document] = structuredClone(data); };
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://example.test/') return response('<section id="hero"><img data-image-original="/images/hero.png" alt=""></section>');
      if (value === 'https://example.test/404/') return response('<a href="/private/">private</a>');
      if (value.includes('/images/hero.png')) return response(image, 'image/png');
      return response('', 'text/html', 404);
    };
    const modelFetch = async (_url, request) => {
      const payload = JSON.parse(request.body);
      assert.equal(payload.model, 'gemma3:4b');
      return response(JSON.stringify({ message: { content: 'A person holding a camera.' } }), 'application/json');
    };
    await writeFile(path.join(root, 'hero.png'), image);
    const service = createImageDescriptionsService({ site: 'https://example.test', documentKeys: ['home', 'private'], mediaDir: root, cacheFile: path.join(root, 'cache.json'), readDocument, writeDocument, fetchImpl, modelFetch });
    await service.refresh();
    const rows = service.rows();
    assert.equal(rows.length, 2);
    const publicRow = rows.find((row) => row.document === 'home');
    const privateRow = rows.find((row) => row.document === 'private');
    assert.deepEqual(publicRow.path, ['sections', 0]);
    assert.equal(publicRow.status, 'Waiting for publication');
    assert.equal(privateRow.status, 'Waiting for publication');
    await service.check();
    assert.equal(service.rows().find((row) => row.document === 'home').description, 'A person holding a camera.');
    const saved = await service.save({ key: publicRow.key, baseToken: publicRow.baseToken, alt: 'A person holding a camera.', intent: 'manual' });
    assert.equal(saved.status, 200);
    assert.equal(docs.home.sections[0].alt, 'A person holding a camera.');
    const stale = await service.save({ key: publicRow.key, baseToken: 'stale', alt: 'Changed', intent: 'manual' });
    assert.equal(stale.status, 409);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a public source mismatch before model inference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-image-descriptions-mismatch-'));
  try {
    const docs = { home: { sections: [{ type: 'image', id: 'hero', src: 'hero.png', alt: '', altIntent: 'auto' }] } };
    let modelCalls = 0;
    const fetchImpl = async (url) => String(url) === 'https://example.test/'
      ? response('<section id="hero"><img data-image-original="/images/hero.png" alt=""></section>')
      : response('different', 'image/png');
    const service = createImageDescriptionsService({ site: 'https://example.test', documentKeys: ['home'], mediaDir: root, cacheFile: path.join(root, 'cache.json'), readDocument: async () => structuredClone(docs.home), fetchImpl, modelFetch: async () => { modelCalls += 1; return response('{}', 'application/json'); } });
    await writeFile(path.join(root, 'hero.png'), 'local');
    await service.check();
    assert.equal(modelCalls, 0);
    assert.equal(service.rows()[0].status, 'Failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function imageFixture({ docs, html = '<main></main>', modelContents = ['A clear subject.'], modelStatus = 200, imageNames = ['hero.png'], fetchExtra } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-image-descriptions-fixture-'));
  const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d8d8d8' } }).png().toBuffer();
  for (const name of imageNames) await writeFile(path.join(root, name), image);
  let modelCalls = 0;
  let writes = 0;
  const readDocument = async (document) => structuredClone(docs[document]);
  const writeDocument = async (document, data) => { writes += 1; docs[document] = structuredClone(data); };
  const fetchImpl = async (url, init) => {
    const value = String(url);
    const extra = await fetchExtra?.(value, init);
    if (extra) return extra;
    if (value === 'https://example.test/') return response(html);
    const match = value.match(/https:\/\/example\.test\/images\/(.+)$/);
    if (match) return response(image, 'image/png');
    return response('', 'text/html', 404);
  };
  const modelFetch = async () => {
    const content = modelContents[Math.min(modelCalls, modelContents.length - 1)];
    modelCalls += 1;
    return response(JSON.stringify({ message: { content } }), 'application/json', modelStatus);
  };
  const service = createImageDescriptionsService({
    site: 'https://example.test', documentKeys: Object.keys(docs), mediaDir: root,
    cacheFile: path.join(root, 'cache.json'), readDocument, writeDocument, fetchImpl, modelFetch,
  });
  return { root, image, service, docs, get modelCalls() { return modelCalls; }, get writes() { return writes; } };
}

test('keeps ready auto proposals out of source until explicit save and preserves fields', async () => {
  const fixture = await imageFixture({
    docs: { home: { title: 'Home', sections: [{ type: 'image', id: 'hero', src: 'hero.png', alt: '', altIntent: 'auto', caption: 'Keep me', variants: { desktop: { width: 2 } } }] } },
    html: '<section id="hero"><img data-image-original="/images/hero.png" alt=""></section>',
    modelContents: ['A camera on a table.'],
  });
  try {
    await fixture.service.check();
    const proposal = fixture.service.rows()[0];
    assert.equal(proposal.status, 'Ready');
    assert.equal(fixture.writes, 0);
    const saved = await fixture.service.save({ key: proposal.key, baseToken: proposal.baseToken, alt: proposal.description, intent: 'manual' });
    assert.equal(saved.status, 200);
    assert.equal(fixture.writes, 1);
    assert.equal(fixture.docs.home.sections[0].alt, 'A camera on a table.');
    assert.equal(fixture.docs.home.sections[0].caption, 'Keep me');
    assert.deepEqual(fixture.docs.home.sections[0].variants, { desktop: { width: 2 } });
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('honours authored and decorative intent and excludes non-raster media', async () => {
  const docs = { home: { sections: [
    { type: 'image', id: 'authored', src: 'authored.png', alt: 'Written already', altIntent: 'auto' },
    { type: 'image', id: 'manual', src: 'manual.png', alt: '', altIntent: 'manual' },
    { type: 'image', id: 'decorative', src: 'decorative.png', alt: '', altIntent: 'decorative' },
    { type: 'image', id: 'vector', src: 'vector.svg', alt: '', altIntent: 'auto' },
    { type: 'video', id: 'video', src: 'video.mp4', alt: '', altIntent: 'auto' },
  ] } };
  const fixture = await imageFixture({ docs, imageNames: ['authored.png', 'manual.png', 'decorative.png'], html: `<main>
    <img id="authored" data-image-original="/images/authored.png" alt="Written already">
    <img id="manual" data-image-original="/images/manual.png" alt="">
    <img id="decorative" data-image-original="/images/decorative.png" alt="">
  </main>` });
  try {
    await fixture.service.check();
    assert.equal(fixture.service.rows().length, 3);
    assert.equal(fixture.service.rows().find((row) => row.path.at(-1) === 0).status, 'Waiting for publication');
    assert.equal(fixture.service.rows().find((row) => row.path.at(-1) === 1).status, 'Manual');
    assert.equal(fixture.service.rows().find((row) => row.path.at(-1) === 2).status, 'Decorative');
    assert.equal(fixture.modelCalls, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('does not infer descriptions from unlinked, draft, teaser, 404, or cross-origin pages', async () => {
  const docs = {
    home: { sections: [{ type: 'image', id: 'home', src: 'home.png', alt: '', altIntent: 'auto' }] },
    project: { sections: [{ type: 'image', id: 'project', src: 'project.png', alt: '', altIntent: 'auto' }] },
    draft: { status: 'draft', sections: [{ type: 'image', id: 'draft', src: 'draft.png', alt: '', altIntent: 'auto' }] },
    teaser: { status: 'teaser', sections: [{ type: 'image', id: 'teaser', src: 'teaser.png', alt: '', altIntent: 'auto' }] },
    private: { sections: [{ type: 'image', id: 'private', src: 'private.png', alt: '', altIntent: 'auto' }] },
  };
  const fixture = await imageFixture({ docs, imageNames: ['home.png', 'project.png', 'draft.png', 'teaser.png', 'private.png'], html: '<a href="/project/"><img id="home" data-image-original="/images/home.png" alt=""></a>', fetchExtra: async (url) => {
    if (url === 'https://example.test/project/') return response('<a href="/404.html"><img id="project" data-image-original="/images/project.png" alt=""></a>');
    if (url === 'https://example.test/404.html') return response('<a href="/private/"><img data-image-original="https://other.test/images/private.png" alt=""></a>');
    if (url === 'https://example.test/private/') return response('<img data-image-original="/images/private.png" alt="">');
  } });
  try {
    await fixture.service.check();
    const rows = fixture.service.rows();
    assert.deepEqual(rows.map((row) => row.document).sort(), ['draft', 'home', 'private', 'project', 'teaser']);
    assert.equal(rows.find((row) => row.document === 'home').public, true);
    assert.equal(rows.find((row) => row.document === 'draft').public, false);
    await fixture.service.check();
    assert.equal(fixture.modelCalls, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('rejects ambiguous stable IDs rather than guessing a source node', async () => {
  const fixture = await imageFixture({
    docs: { home: { sections: [
      { type: 'image', id: 'same', src: 'hero.png', alt: '', altIntent: 'auto' },
      { type: 'image', id: 'same', src: 'hero.png', alt: '', altIntent: 'auto' },
    ] } },
    html: '<section id="same"><img data-image-original="/images/hero.png" alt=""><img data-image-original="/images/hero.png" alt=""></section>',
  });
  try { await fixture.service.refresh(); assert.equal(fixture.service.rows().length, 0); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('rejects stale saves after authored edits and reordering without writing', async () => {
  const fixture = await imageFixture({
    docs: { home: { sections: [{ type: 'image', id: 'one', src: 'hero.png', alt: '', altIntent: 'auto' }] } },
    html: '<main><img id="one" data-image-original="/images/hero.png" alt=""></main>',
  });
  try {
    await fixture.service.refresh();
    const row = fixture.service.rows()[0];
    fixture.docs.home.sections[0].alt = 'Changed elsewhere';
    const stale = await fixture.service.save({ key: row.key, baseToken: row.baseToken, alt: 'Draft', intent: 'manual' });
    assert.equal(stale.status, 409);
    assert.equal(fixture.writes, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('caches failed generation, supports explicit retry, and restores cache in a new service', async () => {
  const fixture = await imageFixture({
    docs: { home: { sections: [{ type: 'image', id: 'hero', src: 'hero.png', alt: '', altIntent: 'auto' }] } },
    html: '<section id="hero"><img data-image-original="/images/hero.png" alt=""></section>',
    modelContents: ['<img>', 'A restored subject.'],
  });
  try {
    await fixture.service.check();
    assert.equal(fixture.service.rows()[0].status, 'Failed');
    assert.equal(fixture.modelCalls, 1);
    await fixture.service.check();
    assert.equal(fixture.modelCalls, 1);
    await fixture.service.retry(fixture.service.rows()[0].key);
    assert.equal(fixture.modelCalls, 2);
    assert.equal(fixture.service.rows()[0].description, 'A restored subject.');
    const second = createImageDescriptionsService({ site: 'https://example.test', documentKeys: ['home'], mediaDir: fixture.root, cacheFile: path.join(fixture.root, 'cache.json'), readDocument: async () => structuredClone(fixture.docs.home), fetchImpl: async (url) => String(url) === 'https://example.test/' ? response(fixture.html || '<img data-image-original="/images/hero.png">') : response(fixture.image, 'image/png'), modelFetch: async () => response('{}', 'application/json') });
    await second.refresh();
    assert.equal(second.rows()[0].description, 'A restored subject.');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('blocks oversized public HTML and images before model inference', async () => {
  const fixture = await imageFixture({
    docs: { home: { sections: [{ type: 'image', id: 'hero', src: 'hero.png', alt: '', altIntent: 'auto' }] } },
    fetchExtra: async (url) => {
      if (url === 'https://example.test/') return response('<section id="hero"><img data-image-original="/images/hero.png"></section>', 'text/html', 200, { 'content-length': String(2 * 1024 * 1024 + 1) });
      if (url.includes('/images/hero.png')) return response(fixture.image, 'image/png', 200, { 'content-length': String(16 * 1024 * 1024 + 1) });
    },
  });
  try { await fixture.service.check(); assert.equal(fixture.modelCalls, 0); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('rejects media symlinks and parent symlink escapes', async () => {
  const fixture = await imageFixture({ docs: { home: { sections: [{ type: 'image', id: 'hero', src: 'hero.png', alt: '', altIntent: 'auto' }] } }, html: '<section id="hero"><img data-image-original="/images/hero.png"></section>' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vcd-image-descriptions-outside-'));
  try {
    await rm(path.join(fixture.root, 'hero.png'), { force: true });
    await writeFile(path.join(outside, 'hero.png'), fixture.image);
    await symlink(path.join(outside, 'hero.png'), path.join(fixture.root, 'hero.png'));
    await fixture.service.check();
    assert.equal(fixture.modelCalls, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
