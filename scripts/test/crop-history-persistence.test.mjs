import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCropChange } from '../../astro.config.mjs';

const crop = { desktop: { aspect: '3:2', cx: 0.5, cy: 0.5, w: 1 } };

test('restoring an uncropped image also restores its source and frame flags', () => {
  const document = { sections: [{ type: 'image', src: 'new.png', variants: crop, maxVh: 70 }] };
  const result = applyCropChange(document, {
    path: ['sections', 0], clearVariants: true, src: 'original.png',
    srcWidth: 1200, srcHeight: 800, maxVh: 0, constrained: false,
  });
  assert.equal(result.ok, true);
  assert.equal(document.sections[0].src, 'original.png');
  assert.equal(document.sections[0].srcWidth, 1200);
  assert.equal(document.sections[0].variants, undefined);
  assert.equal(document.sections[0].maxVh, undefined);
});

test('undoing a newly added hover image removes its crop without removing the cover', () => {
  const document = { listings: { home: { image: 'cover.png', hoverImage: 'hover.png', variants: crop, hoverVariants: crop } } };
  assert.equal(applyCropChange(document, {
    path: ['listings', 'home'], slot: 'hoverImage', clearHoverImage: true, clearHoverVariants: true,
  }).ok, true);
  assert.equal(document.listings.home.image, 'cover.png');
  assert.deepEqual(document.listings.home.variants, crop);
  assert.equal(document.listings.home.hoverImage, undefined);
  assert.equal(document.listings.home.hoverVariants, undefined);
});

test('crop undo followed by redo round-trips the persisted image', () => {
  const document = { sections: [{ type: 'image', src: 'original.png' }] };
  const after = { path: ['sections', 0], src: 'replacement.png', variants: crop, maxVh: 80 };
  assert.equal(applyCropChange(document, after).ok, true);
  const saved = structuredClone(document);
  assert.equal(applyCropChange(document, { path: ['sections', 0], src: 'original.png', clearVariants: true, maxVh: 0 }).ok, true);
  assert.equal(applyCropChange(document, after).ok, true);
  assert.deepEqual(document, saved);
});

test('history restoration cannot use unsafe paths or invalid crop values', () => {
  const document = { sections: [{ type: 'image', src: 'original.png' }] };
  assert.equal(applyCropChange(document, { path: ['__proto__'], clearVariants: true }).ok, false);
  assert.equal(applyCropChange(document, { path: ['sections', 0], variants: { desktop: { aspect: '3:2', cx: NaN, cy: 0.5, w: 1 } } }).ok, false);
  assert.equal(document.sections[0].src, 'original.png');
});


test('a rendered derivative cannot replace the original image or partially clear its crop', () => {
  for (const src of ['original.preview.webp', '/images/original.thumb.webp']) {
    const document = { sections: [{ type: 'image', src: 'original.jpg', variants: crop }] };
    const before = structuredClone(document);
    const result = applyCropChange(document, { path: ['sections', 0], src, clearVariants: true });
    assert.equal(result.ok, false);
    assert.deepEqual(document, before);
  }
});

test('mobile inset accepts a boolean mutation and preserves it when omitted', () => {
  const document = { sections: [{ type: 'image', src: 'original.png', mobileInset: true }] };
  assert.equal(applyCropChange(document, { path: ['sections', 0], mobileInset: false }).ok, true);
  assert.equal(document.sections[0].mobileInset, undefined);
  assert.equal(applyCropChange(document, { path: ['sections', 0], mobileInset: true }).ok, true);
  assert.equal(document.sections[0].mobileInset, true);
  assert.equal(applyCropChange(document, { path: ['sections', 0], maxVh: 70 }).ok, true);
  assert.equal(document.sections[0].mobileInset, true);
});

test('mobile inset rejects non-boolean mutations without changing the document', () => {
  const document = { sections: [{ type: 'image', src: 'original.png' }] };
  const before = structuredClone(document);
  assert.equal(applyCropChange(document, { path: ['sections', 0], mobileInset: 'true' }).ok, false);
  assert.deepEqual(document, before);
});
