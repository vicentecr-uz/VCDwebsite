import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createImageDescriptionsService } from '../dev-image-descriptions.mjs';

function response(body, type = 'text/html', ok = true) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return { ok, url: 'https://example.test/', headers: { get: (name) => name === 'content-type' ? type : null }, text: async () => bytes.toString(), arrayBuffer: async () => bytes, json: async () => JSON.parse(bytes.toString()) };
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
      if (value === 'https://example.test/') return response('<a href="/404/">404</a><img data-image-original="/images/hero.png" alt="">');
      if (value === 'https://example.test/404/') return response('<a href="/private/">private</a>');
      if (value.includes('/images/hero.png')) return response(image, 'image/png');
      return response('', 'text/html', false);
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
      ? response('<img data-image-original="/images/hero.png" alt="">')
      : response('different', 'image/png');
    const service = createImageDescriptionsService({ site: 'https://example.test', documentKeys: ['home'], mediaDir: root, cacheFile: path.join(root, 'cache.json'), readDocument: async () => structuredClone(docs.home), fetchImpl, modelFetch: async () => { modelCalls += 1; return response('{}', 'application/json'); } });
    await writeFile(path.join(root, 'hero.png'), 'local');
    await service.check();
    assert.equal(modelCalls, 0);
    assert.equal(service.rows()[0].status, 'Failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
