import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contentSectionDevWriter } from '../../astro.config.mjs';
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
const mount = await readFile(new URL('../../src/scripts/devSectionMount.ts', import.meta.url), 'utf8');
const gridTuner = await readFile(new URL('../../src/components/project/ProjectImageGridTuner.astro', import.meta.url), 'utf8');
const carouselTuner = await readFile(new URL('../../src/components/project/ProjectImageCarouselTuner.astro', import.meta.url), 'utf8');
assert.match(mount, /'dev-grid-edit-target'/);
assert.match(mount, /'dev-carousel-edit-target'/);
assert.match(gridTuner, /document\.createElement\('div'\)/);
assert.match(gridTuner, /saveDraft\(\);[\s\S]*vcd:dev-grid-image-picker-open/);
assert.match(gridTuner, /aria-label', 'Add image to grid'/);
assert.match(carouselTuner, /document\.createElement\('div'\)/);
assert.match(picker, /hasGridTarget\(\) \? \{ type: 'imageGrid' \}/);
assert.match(picker, /appendToGrid\(\[\], \[\], targetedGrid, true\)/);

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

function request(body) {
  const payload = Buffer.from(JSON.stringify(body));
  return { method: 'POST', async *[Symbol.asyncIterator]() { yield payload; } };
}

function response() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  return { statusCode: 200, setHeader() {}, end(value) { resolve({ status: this.statusCode, body: JSON.parse(value) }); }, done };
}

test('content writer appends one grid placeholder and preserves explicit visibility lists', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-media-placeholder-'));
  const directory = path.join(root, 'src/content/projects');
  const file = path.join(directory, 'fixture.json');
  await mkdir(directory, { recursive: true });
  const source = {
    sections: [{
      type: 'imageGrid', id: 'grid', items: [{ id: 'existing', src: 'one.jpg', alt: '' }],
      layouts: { desktop: { visible: ['existing'] }, mobile: { visible: [] } },
    }],
  };
  await writeFile(file, JSON.stringify(source));
  process.chdir(root);
  try {
    let handler;
    contentSectionDevWriter().configureServer({ middlewares: { use(_path, next) { handler = next; } } });
    let result = response();
    await handler(request({ document: 'fixture', action: 'appendMediaItems', path: ['sections', 0], placeholder: true }), result, () => {});
    const appended = await result.done;
    assert.equal(appended.status, 200);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const items = saved.sections[0].items;
    assert.equal(items.length, 2);
    assert.equal(items[1].src, 'placeholder.svg');
    assert.equal(items[1].alt, 'Placeholder');
    assert.deepEqual(items[1].variants, PLACEHOLDER_IMAGE_VARIANTS);
    assert.equal(saved.sections[0].layouts.desktop.visible.at(-1), items[1].id);
    assert.equal(saved.sections[0].layouts.mobile.visible.at(-1), items[1].id);

    const unchanged = JSON.stringify(saved);
    result = response();
    await handler(request({ document: 'fixture', action: 'appendMediaItems', path: ['sections', 0] }), result, () => {});
    assert.equal((await result.done).status, 400);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved);
    assert.equal(JSON.stringify(saved), unchanged);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
