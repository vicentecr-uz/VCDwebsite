import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPlaceholderImageCarouselSection,
  buildPlaceholderImageGridSection,
  buildPlaceholderImageSection,
  PLACEHOLDER_IMAGE_VARIANTS,
} from '../dev-api-plugins.mjs';

const editor = await readFile(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const picker = await readFile(new URL('../../src/components/DevImageDrop.astro', import.meta.url), 'utf8');
const config = await readFile(new URL('../../astro.config.mjs', import.meta.url), 'utf8');

assert.match(editor, /data-dev-section-type="imageGrid">Grid/);
assert.match(editor, /preferredType: type/);
assert.match(picker, /label="Add image placeholder"/);
assert.match(picker, /'Add grid placeholder'/);
assert.match(picker, /'Add carousel placeholder'/);
assert.match(picker, /placeholderButton\.hidden = hasCarouselTarget\(\)/);
assert.match(picker, /: 'Add image placeholder';/);
assert.match(config, /'placeholderImageGrid'/);
assert.match(config, /'placeholderImageCarousel'/);
assert.match(config, /type === 'placeholderImageGrid'/);
assert.match(config, /type === 'placeholderImageCarousel'/);

const image = buildPlaceholderImageSection();
assert.equal(image.type, 'image');
assert.equal(image.src, 'placeholder.svg');
assert.equal(image.alt, 'Placeholder');
assert.deepEqual(image.variants, PLACEHOLDER_IMAGE_VARIANTS);

const grid = buildPlaceholderImageGridSection();
assert.equal(grid.type, 'imageGrid');
assert.equal(grid.columns, 2);
assert.equal(grid.items.length, 2);
assert.equal(new Set(grid.items.map((item) => item.id)).size, 2);
assert.deepEqual(grid.layouts.desktop.visible, grid.items.map((item) => item.id));
assert.deepEqual(grid.layouts.mobile.visible, grid.items.map((item) => item.id));

const carousel = buildPlaceholderImageCarouselSection();
assert.equal(carousel.type, 'imageCarousel');
assert.equal(carousel.items.length, 2);
assert.equal(new Set(carousel.items.map((item) => item.id)).size, 2);
assert.deepEqual(carousel.visible, carousel.items.map((item) => item.id));

for (const item of [...grid.items, ...carousel.items]) {
  assert.equal(item.src, 'placeholder.svg');
  assert.equal(item.alt, 'Placeholder');
  assert.deepEqual(item.variants, PLACEHOLDER_IMAGE_VARIANTS);
}

console.log('PASS: media placeholder menu, picker labels, and section shapes');
