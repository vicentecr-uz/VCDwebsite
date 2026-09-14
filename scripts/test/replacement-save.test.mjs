import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { applyCropChangeFromSource } from '../../astro.config.mjs';

let directory;
let src;
before(async () => {
  directory = await mkdtemp(path.join(process.cwd(), 'media', 'replacement-test-'));
  src = `${path.basename(directory)}/image.png`;
  await sharp({ create: { width: 40, height: 26, channels: 3, background: '#fff' } })
    .png().toFile(path.join(directory, 'image.png'));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

for (const type of ['image', 'imageGrid', 'imageCarousel', 'listing']) {
  test(`${type} save uses source dimensions instead of stale placeholder metadata`, async () => {
    const node = { src: 'placeholder.svg', srcWidth: 1600, srcHeight: 1200 };
    const data = type === 'listing'
      ? { listings: { home: { image: node.src, srcWidth: 1600, srcHeight: 1200 } } }
      : { sections: [type === 'image' ? { type, ...node } : { type, items: [node] }] };
    const fieldPath = type === 'listing' ? ['listings', 'home']
      : type === 'image' ? ['sections', 0] : ['sections', 0, 'items', 0];
    const change = { path: fieldPath, src, srcWidth: 1600, srcHeight: 1200 };
    assert.deepEqual(await applyCropChangeFromSource(data, change), { ok: true });
    const target = fieldPath.reduce((value, part) => value[part], data);
    assert.equal(target.srcWidth, 40);
    assert.equal(target.srcHeight, 26);
    assert.equal(target[type === 'listing' ? 'image' : 'src'], src);
    // A later crop save from an old editor must not reinstate its stale dimensions.
    assert.deepEqual(await applyCropChangeFromSource(data, change), { ok: true });
    assert.equal(target.srcWidth, 40);
  });
}

test('hover replacement preserves cover dimensions', async () => {
  const data = { listings: { home: { image: 'placeholder.svg', srcWidth: 1600, srcHeight: 1200 } } };
  assert.deepEqual(await applyCropChangeFromSource(data, {
    path: ['listings', 'home'], slot: 'hoverImage', src,
  }), { ok: true });
  assert.equal(data.listings.home.srcWidth, 1600);
  assert.equal(data.listings.home.hoverImage, src);
});

test('unreadable replacement and invalid crop leave the document unchanged', async () => {
  for (const change of [
    { src: 'missing-replacement-test.png' },
    { src, variants: { desktop: { aspect: 'original', cx: NaN, cy: 0.5, w: 1 } } },
    { src: 'image.preview.webp' },
  ]) {
    const data = { sections: [{ type: 'image', src: 'placeholder.svg', srcWidth: 1600, srcHeight: 1200 }] };
    const previous = structuredClone(data);
    assert.equal((await applyCropChangeFromSource(data, { path: ['sections', 0], ...change })).ok, false);
    assert.deepEqual(data, previous);
  }
});
