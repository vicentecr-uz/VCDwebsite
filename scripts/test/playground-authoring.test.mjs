import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaygroundAuthoring } from '../../src/lib/playgroundAuthoring.mjs';

const document = 'editor-playground';
const dimensions = { srcWidth: 960, srcHeight: 640 };
const seed = {
  slug: document,
  title: 'New Classic Utility Knife',
  trailingSpacing: 'none',
  sections: [
    { id: 'intro', type: 'bodyText', paragraphs: ['Original copy'], spacing: 'group' },
    { id: 'grid', type: 'imageGrid', items: [{ id: 'grid-photo', src: 'blade.jpg', ...dimensions }] },
    { id: 'carousel', type: 'imageCarousel', items: [
      { id: 'first-slide', src: 'handle.jpg', ...dimensions },
      { id: 'second-slide', src: 'case.jpg', ...dimensions },
    ] },
    { id: 'overview', type: 'sectionTitle', sectionId: 'overview', title: 'Overview' },
  ],
  outline: [{ id: 'overview', anchor: 'overview', kind: 'section', label: 'Overview' }],
};
const catalog = [{
  slug: 'public-project',
  title: 'Another public project',
  images: [{ src: 'catalog.jpg', filename: 'catalog.jpg', url: '/images/catalog.jpg' }],
}];

function createSession(storage = {}) {
  const authoring = createPlaygroundAuthoring({
    seed,
    catalog,
    readDraft: () => structuredClone(storage.draft),
    savedAssets: storage.assets?.uploads,
    deletedSources: storage.assets?.deleted,
    writeDraft: (value, assets) => {
      storage.draft = structuredClone(value);
      storage.assets = structuredClone(assets);
    },
    readMediaDimensions: async (url) => {
      assert.equal(url, '/images/catalog.jpg');
      return dimensions;
    },
    upload: async ({ filename }) => ({
      src: `playground/${filename}`, filename, url: 'blob:local-playground-file', dimensions,
    }),
  });
  const request = async (method, endpoint, body = {}) => {
    let response;
    await authoring.handle(method, endpoint, body, (status, payload) => {
      assert.equal(response, undefined, 'One response per request');
      response = { status, payload };
    });
    assert.ok(response, 'The request returned a response');
    return response;
  };
  const save = async (endpoint, body) => {
    const { status, payload } = await request('POST', endpoint, body);
    assert.equal(status, 200, JSON.stringify(payload));
    return payload;
  };
  return { ...authoring, request, save };
}

test('playground saves text and responsive media controls against stable block IDs', async () => {
  const session = createSession();
  const gridPhoto = { path: ['sections', 0, 'items', 1], target: { sectionId: 'grid', itemId: 'grid-photo' } };
  const slide = { path: ['sections', 0, 'items', 0], target: { sectionId: 'carousel', itemId: 'second-slide' } };
  const crop = { aspect: '1:1', cx: 0.5, cy: 0.5, w: 0.8 };
  const columns = { desktop: 3, tablet: 2, mobile: 1 };
  const layouts = { mobile: { visible: ['grid-photo'] } };
  const text = { document, path: ['sections', 2, 'paragraphs'], target: { sectionId: 'intro' }, value: ['Edited copy'] };

  await session.save('content-batch', {
    text: [text],
    crops: [
      { document, ...gridPhoto, src: 'catalog.jpg', variants: { desktop: crop } },
      { document, ...slide, variants: { mobile: crop } },
    ],
    captions: [{
      document, ...gridPhoto, captions: { desktop: 'New caption', tablet: 'New caption', mobile: 'New caption' },
      captionStyle: 'below', captionPosition: 'left', captionReveal: 'always',
    }],
    grids: [{
      document, path: ['sections', 0], target: { sectionId: 'grid' }, columns, layouts,
      defaultAspectRatio: '4:3', constrained: { desktop: 'text', mobile: 100 },
    }],
    carousels: [{
      document, path: ['sections', 0], target: { sectionId: 'carousel' },
      orientation: 'vertical', heightMode: 'tallest', dotsPlacement: 'over',
    }],
    spacing: [{ document, path: ['sections', 2, 'spacing'], target: { sectionId: 'intro' }, value: 'related' }],
  });

  const saved = session.snapshot();
  const [intro, grid, carousel] = saved.sections;
  assert.deepEqual(intro.paragraphs, ['Edited copy']);
  assert.equal(intro.spacing, 'related');
  assert.deepEqual(grid.columns, columns);
  assert.deepEqual(grid.layouts, layouts);
  assert.equal(grid.constrained.desktop, 'text');
  assert.equal(grid.items[0].src, 'catalog.jpg');
  assert.deepEqual(grid.items[0].variants.desktop, crop);
  assert.equal(grid.items[0].caption, 'New caption');
  assert.equal(carousel.orientation, 'vertical');
  assert.equal(carousel.dotsPlacement, 'over');
  assert.deepEqual(carousel.items[0], seed.sections[2].items[0]);
  assert.deepEqual(carousel.items[1].variants.mobile, crop);

  const { status } = await session.request('POST', 'content-batch', {
    text: [{ ...text, value: ['Will roll back'] }, { ...text, target: { sectionId: 'missing' } }],
  });
  assert.equal(status, 400);
  assert.deepEqual(session.snapshot(), saved);
});

test('playground can upload, insert, and find media in its browser asset library', async () => {
  const storage = {};
  const session = createSession(storage);
  const { filenames } = await session.save('upload', {
    document, files: [{ filename: 'local.png', mimeType: 'image/png', data: 'ZGVtbw==' }],
  });

  const { section } = await session.save('content-section', {
    document, action: 'insert', index: 1, type: 'imageGrid', srcs: [filenames[0], 'catalog.jpg'],
  });
  assert.deepEqual(section.items.map(({ src }) => src), [filenames[0], 'catalog.jpg']);
  assert.equal(section.items[0].srcWidth, dimensions.srcWidth);

  const { status, payload } = await session.request('GET', 'assets');
  assert.equal(status, 200);
  const uploaded = payload.assets.find(({ src }) => src === filenames[0]);
  assert.equal(uploaded.url, 'blob:local-playground-file');
  assert.deepEqual(uploaded.usedBy, [document]);
  assert.deepEqual(payload.assets.find(({ src }) => src === 'catalog.jpg').usedBy, ['public-project', document]);

  const { rows } = (await session.request('GET', 'image-descriptions')).payload;
  const row = rows.find(({ src }) => src === filenames[0]);
  await session.save('image-description-save', { key: row.key, baseToken: row.baseToken, alt: 'Knife handle detail' });
  assert.equal(session.snapshot().sections[1].items[0].alt, 'Knife handle detail');

  const restored = createSession(storage);
  assert.ok((await restored.request('GET', 'assets')).payload.assets.some(({ src }) => src === filenames[0]));
  assert.equal((await restored.request('DELETE', 'assets', { src: filenames[0] })).status, 200);
  assert.deepEqual(restored.snapshot().sections[1].items.map(({ src }) => src), ['catalog.jpg']);
  assert.ok(!(await createSession(storage).request('GET', 'assets')).payload.assets.some(({ src }) => src === filenames[0]));
});

test('playground reorders, deletes, and restores a full block with its outline metadata', async () => {
  const session = createSession();
  await session.save('content-section-order', {
    document, orderIds: ['overview', 'intro', 'carousel', 'grid'],
  });

  const beforeDelete = session.snapshot();
  const { restoreToken } = await session.save('content-section', {
    document, action: 'delete', index: 3, target: { sectionId: 'overview' },
  });
  assert.deepEqual(session.snapshot().sections.map(({ id }) => id), ['intro', 'carousel', 'grid']);
  assert.deepEqual(session.snapshot().outline, []);

  await session.save('content-section', { document, action: 'restore', index: 0, restoreToken });
  assert.deepEqual(session.snapshot(), beforeDelete);
});

test('playground restores its own draft and rejects owner writes', async () => {
  const storage = {};
  const session = createSession(storage);
  const changes = [{ document, path: ['title'], value: 'Local title' }];
  await session.save('content-text', { changes });

  const ownerWrite = await session.request('POST', 'content-text', {
    changes: [{ ...changes[0], document: 'new-classic-utility-knife' }],
  });
  assert.equal(ownerWrite.status, 400);
  for (const endpoint of ['publish', 'commit-engine', 'dev-branch-update']) {
    assert.equal((await session.request('POST', endpoint, { document })).status, 403);
  }
  assert.equal((await session.request('GET', 'publish')).payload.readOnly, true);

  assert.equal(session.snapshot().title, 'Local title');
  assert.equal(createSession(storage).snapshot().title, 'Local title');
  assert.deepEqual(createSession().snapshot(), seed);
  await session.reset();
  assert.deepEqual(createSession(storage).snapshot(), seed);
});
