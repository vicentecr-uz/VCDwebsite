import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAssetRefsFromDocument } from '../dev-assets.mjs';

const fixture = () => ({ sections: [{
  type: 'imageGrid', id: 'grid',
  layouts: { desktop: { visible: ['photo', 'carousel'] }, mobile: { visible: ['carousel'] } },
  items: [{ id: 'photo', src: 'keep.jpg' }, {
    type: 'imageCarousel', id: 'carousel', visible: ['first', 'second'],
    breakpoints: { mobile: { visible: ['second', 'first'] } },
    items: [{ id: 'first', src: 'delete.jpg' }, { id: 'second', src: 'keep.jpg' }],
  }],
}] });

test('asset deletion removes nested slide references and their visibility entries', () => {
  const data = fixture();
  assert.equal(stripAssetRefsFromDocument(data, 'delete.jpg'), 1);
  const grid = data.sections[0];
  const carousel = grid.items[1];
  assert.deepEqual(carousel.items.map((item) => item.id), ['second']);
  assert.deepEqual(carousel.visible, ['second']);
  assert.deepEqual(carousel.breakpoints.mobile.visible, ['second']);
  assert.deepEqual(grid.layouts.desktop.visible, ['photo', 'carousel']);
  assert.equal(JSON.stringify(data).includes('delete.jpg'), false);
});

test('deleting the final nested slide removes the cell from all grid layouts', () => {
  const data = fixture();
  data.sections[0].items[1].items[1].src = 'delete.jpg';
  assert.equal(stripAssetRefsFromDocument(data, 'delete.jpg'), 2);
  assert.deepEqual(data.sections[0].items.map((item) => item.id), ['photo']);
  assert.deepEqual(data.sections[0].layouts.desktop.visible, ['photo']);
  assert.deepEqual(data.sections[0].layouts.mobile.visible, []);
});

test('unreferenced deletion preserves empty carousels and existing media', () => {
  const data = fixture();
  data.sections[0].items[1].items = [];
  const before = structuredClone(data);
  assert.equal(stripAssetRefsFromDocument(data, 'unrelated.jpg'), 0);
  assert.deepEqual(data, before);
});

test('retains standalone, grid, carousel and listing asset cleanup', () => {
  const data = {
    sections: [
      { type: 'image', src: 'delete.jpg' },
      { type: 'bodyText', paragraphs: ['keep'] },
      { type: 'imageCarousel', items: [{ id: 'a', src: 'delete.jpg' }, { id: 'b', src: 'keep.jpg' }], visible: ['a', 'b'] },
    ],
    listings: { home: { image: 'keep.jpg', hoverImage: 'delete.jpg' } },
    teaser: { coverImage: 'delete.jpg' },
  };
  assert.equal(stripAssetRefsFromDocument(data, 'delete.jpg'), 4);
  assert.equal(data.sections.length, 2);
  assert.deepEqual(data.sections[1].visible, ['b']);
  assert.equal(data.listings.home.hoverImage, undefined);
  assert.equal(data.teaser.coverImage, '');
});
