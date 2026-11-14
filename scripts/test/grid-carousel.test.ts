import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncNestedCarouselChrome } from '../../src/lib/devEditChrome';
import { mountInsertedSection } from '../../src/scripts/devSectionMount';
import { devEditPendingId, editsRemovedMedia, withDevEditTarget } from '../../src/scripts/devEditTarget';
import { resolveContentTarget } from '../../src/lib/devContentTarget.mjs';
import { applyCropChange, contentSectionDevWriter } from '../../astro.config.mjs';

const originalDocument = globalThis.document;
afterEach(() => { globalThis.document = originalDocument; });
const source = () => ({ sections: [{ id: 'grid', type: 'imageGrid', columns: 2, defaultAspectRatio: '4:3',
  layouts: { mobile: { visible: ['photo', 'cell'] } },
  items: [{ id: 'photo', src: 'left.jpg' }, { id: 'cell', src: 'right.jpg', srcWidth: 3000, srcHeight: 4000,
    captions: { desktop: 'Design inspiration' }, mobileInset: true,
    variants: { desktop: { aspect: '2:3', cx: 0.4, cy: 0.5, w: 0.8 } },
  }],
}] });

const post = async (body: unknown, writer = contentSectionDevWriter()) => {
  let handler: any;
  writer.configureServer({ middlewares: { use(_path: string, next: any) { handler = next; } } } as any);
  let result: any;
  await handler({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } },
    { statusCode: 200, setHeader() {}, end(value: string) { result = { status: this.statusCode, body: JSON.parse(value) }; } }, () => {});
  return result;
};

async function fixture(run: (file: string) => Promise<void>) {
  const cwd = process.cwd();
  const root = await mkdtemp(path.join(os.tmpdir(), 'grid-carousel-'));
  const file = path.join(root, 'src/content/projects/fixture.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(source()));
  process.chdir(root);
  try { await run(file); } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
}

test('conversion preserves the grid layout and first-slide crop, then supports nested append and removal', async () => {
  await fixture(async (file) => {
    const before = source().sections[0];
    const converted = await post({ document: 'fixture', action: 'convertImageToCarousel', path: ['sections', 8, 'items', 0], target: { sectionId: 'grid', itemId: 'cell' } });
    expect(converted.status).toBe(200);
    const grid = converted.body.section;
    expect(grid.layouts).toEqual(before.layouts);
    expect(grid.items[0]).toEqual(before.items[0]);
    expect(grid.items[1].id).toBe('cell');
    expect(grid.items[1].mobileInset).toBe(true);
    expect(grid.items[1].items[0]).toEqual({ ...before.items[1], id: 'cell-slide' });
    const appended = await post({ document: 'fixture', action: 'appendMediaItems', path: ['sections', 4, 'items', 0], target: { sectionId: 'grid', itemId: 'cell' }, placeholder: true });
    expect(appended.status).toBe(200);
    expect(appended.body.section.items[1].items).toHaveLength(2);
    const removed = await post({ document: 'fixture', action: 'removeMediaItem', path: ['sections', 0, 'items', 0], target: { sectionId: 'grid', itemId: 'cell' }, itemId: 'cell-slide' });
    expect(removed.status).toBe(200);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.sections[0].items).toHaveLength(2);
    expect(saved.sections[0].items[1].items).toHaveLength(1);
    expect(saved.sections[0].items[0]).toEqual(before.items[0]);
  });
});

test('standalone conversion keeps section identity and first-slide media', async () => {
  await fixture(async (file) => {
    const image = {
      id: 'photo', type: 'image', src: 'photo.jpg', alt: 'Prototype',
      sectionId: 'gallery', spacing: 'major', constrained: 80, maxVh: 70,
      captions: { desktop: 'Design inspiration' },
    };
    await writeFile(file, JSON.stringify({ sections: [source().sections[0], image] }));
    const result = await post({
      document: 'fixture', action: 'convertImageToCarousel', path: ['sections', 0], target: { sectionId: 'photo' },
    });
    expect(result.status).toBe(200);
    expect(result.body.index).toBe(1);
    expect(result.body.section).toMatchObject({
      id: 'photo', type: 'imageCarousel', sectionId: 'gallery', spacing: 'major',
      constrained: 80, maxHeightVh: 70, visible: ['photo-slide'],
      items: [{ id: 'photo-slide', src: 'photo.jpg', alt: 'Prototype', captions: image.captions }],
    });
    const repeated = await post({
      document: 'fixture', action: 'convertImageToCarousel', path: ['sections', 1], target: { sectionId: 'photo' },
    });
    expect(repeated.status).toBe(400);
  });
});

test('nested conversion can be undone and redone through an opaque token without touching siblings', async () => {
  await fixture(async (file) => {
    const before = source();
    const writer = contentSectionDevWriter();
    const target = { document: 'fixture', path: ['sections', 0, 'items', 0], target: { sectionId: 'grid', itemId: 'photo' } };
    const convert = () => post({ ...target, action: 'convertImageToCarousel' }, writer);
    const undo = (undoToken: string) => post({ document: 'fixture', action: 'undoImageToCarousel', undoToken }, writer);
    const converted = await convert();
    expect(converted.status).toBe(200);
    expect(typeof converted.body.undoToken).toBe('string');

    const disk = JSON.parse(await readFile(file, 'utf8'));
    disk.sections.unshift({ type: 'bodyText', id: 'intro' });
    disk.sections[1].items[1].alt = 'Updated sibling';
    await writeFile(file, JSON.stringify(disk));
    const undone = await undo(converted.body.undoToken);
    expect(undone.status).toBe(200);
    expect(undone.body.index).toBe(1);
    expect(undone.body.section.items[0]).toEqual(before.sections[0].items[0]);
    expect(undone.body.section.items[1]).toEqual({ ...before.sections[0].items[1], alt: 'Updated sibling' });
    expect((await undo(converted.body.undoToken)).status).toBe(400);

    const redone = await convert();
    expect(redone.status).toBe(200);
    expect(redone.body.undoToken).not.toBe(converted.body.undoToken);
    const changed = JSON.parse(await readFile(file, 'utf8'));
    changed.sections[1].items[0].items.push({ id: 'added', src: 'added.jpg' });
    await writeFile(file, JSON.stringify(changed));
    expect((await undo(redone.body.undoToken)).status).toBe(400);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(changed);
  });
});

test('single nested carousel reverses to its original image and preserves its cell ID', async () => {
  await fixture(async (file) => {
    const before = source();
    before.sections[0].items[1] = {
      ...before.sections[0].items[1], type: 'imageCarousel', orientation: 'horizontal',
      items: [{ ...before.sections[0].items[1], id: 'cell-slide' }], visible: ['cell-slide'],
    };
    await writeFile(file, JSON.stringify(before));
    const writer = contentSectionDevWriter();
    const result = await post({ document: 'fixture', action: 'convertCarouselToImage', path: ['sections', 0, 'items', 1], target: { sectionId: 'grid', itemId: 'cell' } }, writer);
    expect(result.status).toBe(200);
    expect(result.body.section.items[1]).toMatchObject({ id: 'cell', src: 'right.jpg', captions: before.sections[0].items[1].items[0].captions });
    expect(result.body.section.items[1].type).toBe('image');
    const undone = await post({ document: 'fixture', action: 'undoImageToCarousel', undoToken: result.body.undoToken }, writer);
    expect(undone.status).toBe(200);
    expect(undone.body.section.items[1].type).toBe('imageCarousel');
    expect(undone.body.section.items[1].items[0].id).toBe('cell-slide');
  });
});

test('reverse carousel conversion preserves standalone section metadata and rejects invalid carousels', async () => {
  await fixture(async (file) => {
    const carousel = { id: 'photo', type: 'imageCarousel', sectionId: 'gallery', spacing: 'major', constrained: 80, maxHeightVh: 70,
      annotations: { note: 'keep' }, items: [{ id: 'photo-slide', src: 'photo.jpg', alt: 'Prototype' }], visible: ['photo-slide'] };
    await writeFile(file, JSON.stringify({ sections: [carousel] }));
    const result = await post({ document: 'fixture', action: 'convertCarouselToImage', path: ['sections', 0], target: { sectionId: 'photo' } });
    expect(result.status).toBe(200);
    expect(result.body.section).toMatchObject({ id: 'photo', type: 'image', sectionId: 'gallery', spacing: 'major', constrained: 80, maxVh: 70, annotations: carousel.annotations });
    await writeFile(file, JSON.stringify({ sections: [{ ...carousel, items: [{ id: 'a', src: 'a.jpg' }, { id: 'b', src: 'b.jpg' }] }] }));
    expect((await post({ document: 'fixture', action: 'convertCarouselToImage', path: ['sections', 0], target: { sectionId: 'photo' } })).status).toBe(400);
    await writeFile(file, JSON.stringify({ sections: [{ ...carousel, items: [{ id: 'a', src: 'placeholder.svg' }] }] }));
    expect((await post({ document: 'fixture', action: 'convertCarouselToImage', path: ['sections', 0], target: { sectionId: 'photo' } })).status).toBe(400);
  });
});

function nested() {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  const grid = { id: 'grid', type: 'imageGrid', columns: 2, items: [{ id: 'photo', src: 'left.jpg' },
    { id: 'cell', type: 'imageCarousel', items: [{ id: 'slide', src: 'right.jpg', captions: { desktop: 'Inspiration' } }, { id: 'other', src: 'other.jpg' }] }] };
  const root = mountInsertedSection(grid, 'fixture', 0);
  root.dataset.devContentId = 'grid';
  root.dataset.devSpacingDocument = 'fixture';
  root.dataset.devSpacingPath = JSON.stringify(['sections', 0, 'spacing']);
  document.body.append(root);
  return { grid, root, slide: root.querySelector<HTMLElement>('[data-carousel-slide]')! };
}

test('only the nested carousel under the grid chip gets a vertical offset', () => {
  const { root } = nested();
  const gridButton = root.querySelector<HTMLButtonElement>('[data-dev-edit-trigger="grid"]')!;
  const carousel = root.querySelector<HTMLElement>('[data-dev-carousel-target]')!;
  const cell = carousel.closest<HTMLElement>('.project-image-grid__item')!;
  const carouselButton = carousel.querySelector<HTMLButtonElement>('[data-dev-edit-trigger="carousel"]')!;
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  gridButton.hidden = false;
  gridButton.getBoundingClientRect = () => rect(10, 10, 60, 24);
  carousel.getBoundingClientRect = () => rect(0, 4, 180, 180);
  cell.getBoundingClientRect = () => rect(0, 0, 180, 180);
  syncNestedCarouselChrome(root);
  expect(carouselButton.style.getPropertyValue('--dev-carousel-trigger-top')).toBe('36px');
  cell.getBoundingClientRect = () => rect(190, 0, 180, 180);
  syncNestedCarouselChrome(root);
  expect(carouselButton.style.getPropertyValue('--dev-carousel-trigger-top')).toBe('');
});

test('mounted nested media has one section root and captures slide and container identity separately', () => {
  const { root, slide } = nested();
  expect(root.querySelector('[data-dev-content-id]')).toBeNull();
  expect(root.querySelector('[data-dev-section-deletable]')).toBeNull();
  expect(JSON.parse(root.dataset.devGridItems!)[1].src).toBe('/images/right.jpg');
  expect(slide.dataset.mobileBleedEligible).toBe('false');
  expect(JSON.parse(slide.dataset.devCaptions!).desktop).toBe('Inspiration');
  const change = { document: 'fixture', path: ['sections', 0, 'items', 1, 'items', 0] };
  expect(withDevEditTarget(change, slide).target).toEqual({ sectionId: 'grid', itemIds: ['cell', 'slide'] });
  expect(withDevEditTarget({ ...change, path: [...change.path, 'alt'] }).target).toEqual({ sectionId: 'grid', itemIds: ['cell', 'slide'] });
  expect(withDevEditTarget({ ...change, path: change.path.slice(0, 4) }, slide).target).toEqual({ sectionId: 'grid', itemId: 'cell' });
  expect(withDevEditTarget({ ...change, path: change.path.slice(0, 4) }).target).toEqual({ sectionId: 'grid', itemId: 'cell' });
  const other = root.querySelectorAll<HTMLElement>('[data-carousel-slide]')[1];
  expect(devEditPendingId('crop', slide)).not.toBe(devEditPendingId('crop', other));
});

test('nested saves follow both reordered IDs and removal supersedes only descendants', () => {
  const { grid, slide } = nested();
  const change = withDevEditTarget({ document: 'fixture', path: ['sections', 0, 'items', 1, 'items', 0], background: '#ffffff' }, slide);
  grid.items.reverse();
  (grid.items[0] as any).items.reverse();
  const data = { sections: [grid] };
  expect(resolveContentTarget(data, change.path, change.target)).toEqual(['sections', 0, 'items', 0, 'items', 1]);
  expect(applyCropChange(data, change)).toEqual({ ok: true });
  expect((grid.items[0] as any).items[1].background).toBe('#ffffff');
  expect(editsRemovedMedia(change, { document: 'fixture', target: { sectionId: 'grid', itemId: 'cell' }, itemId: 'slide' })).toBe(true);
  expect(editsRemovedMedia(change, { document: 'fixture', target: { sectionId: 'grid' }, itemId: 'cell' })).toBe(true);
  expect(editsRemovedMedia(change, { document: 'fixture', target: { sectionId: 'grid', itemId: 'cell' }, itemId: 'other' })).toBe(false);
  (grid.items[0] as any).items.push({ id: 'slide' });
  expect(() => resolveContentTarget(data, change.path, change.target)).toThrow('duplicated');
});

test('nested video replacement is accepted without broadening nonmedia paths', () => {
  const { grid, slide } = nested();
  const change = withDevEditTarget({ document: 'fixture', path: ['sections', 0, 'items', 1, 'items', 0], src: 'clip.mp4' }, slide);
  expect(applyCropChange({ sections: [grid] }, change)).toEqual({ ok: true });
});


test('nested identity rejects missing, conflicting and extra IDs', () => {
  const { grid } = nested();
  const data = { sections: [grid] };
  const path = ['sections', 0, 'items', 1, 'items', 0];
  for (const target of [
    { sectionId: 'grid', itemId: 'cell' },
    { sectionId: 'grid', itemIds: ['cell', 'missing'] },
    { sectionId: 'grid', itemIds: 'cell' },
    { sectionId: 'grid', itemId: 'cell', itemIds: ['cell', 'slide'] },
    { sectionId: 'grid', itemIds: ['cell', 'slide', 'extra'] },
  ]) expect(() => resolveContentTarget(data, path, target)).toThrow();
});
