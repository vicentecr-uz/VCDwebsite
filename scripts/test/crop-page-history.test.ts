import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { normalizeImageBackground } from '../../src/lib/imageBackground.mjs';
import { projectImage } from '../../src/lib/images';
import { imageDevEditAttrs, listingCoverDevEditAttrs } from '../../src/lib/projectImageFrame';

// Exercise the actual target restoration used by panel close and page undo.
const source = readFileSync(new URL('../../src/components/project/ProjectImageCropTuner.astro', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('    const applyPageCrop ='), source.indexOf('    const recordPageCrop ='));
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(body);

const restore = new Function('env', `with (env) { ${script}; return applyPageCrop; }`)({
  isListingCover: () => false,
  isGridTarget: (target: any) => target.classList.contains('project-image-grid__item'),
  isStandaloneMedia: () => false,
  isCarouselItem: () => false,
  applyVariantsToTarget: (target: any, variants: any) => { target.dataset.devImageVariants = JSON.stringify(variants); },
  pageImageFor: () => null,
  applySrcLive: () => {},
  applyMobileInsetLive: (target: any, inset: boolean) => { target.dataset.mobileInset = String(inset); },
  applyBackgroundLive: (target: any, background: string) => { target.dataset.devImageBackground = background; },
  appliedSnapshots: new Map(),
  stagedSources: new Map(),
  pendingIdFor: (target: any) => target.id,
  editTarget: null,
  announceFrameChange: () => {},
});

const target = (id: string, ...classes: string[]) => {
  const names = new Set(classes);
  return {
    id, isConnected: true, dataset: {} as Record<string, string>,
    classList: {
      contains: (name: string) => names.has(name),
      toggle: (name: string, enabled: boolean) => enabled ? names.add(name) : names.delete(name),
    },
  };
};
const crop = (zoom: number, cropped = true) => ({
  mobileInset: false, background: 'transparent', cropped, ownVariants: true, allCover: { desktop: { aspect: '3:2', cx: 0.5, cy: 0.5, w: zoom } },
  allHover: null, allConstrained: {}, coverSrc: '', hoverSrc: '',
});

test('restoring either of two grid images retains its responsive frame during undo and redo', () => {
  const a = target('a', 'project-image-grid__item', 'project-responsive-image');
  const b = target('b', 'project-image-grid__item', 'project-responsive-image');
  restore(a, crop(0.8));
  restore(b, crop(0.6));
  expect(a.classList.contains('project-responsive-image')).toBe(true);
  expect(b.classList.contains('project-responsive-image')).toBe(true);
  restore(b, crop(1));
  expect(JSON.parse(a.dataset.devImageVariants).desktop.w).toBe(0.8);
  expect(b.classList.contains('project-responsive-image')).toBe(true);
  restore(b, crop(0.6));
  expect(JSON.parse(b.dataset.devImageVariants).desktop.w).toBe(0.6);
  expect(b.classList.contains('project-cropped')).toBe(false);
});

test('carousel slides retain their grid frame while standalone crops can be removed', () => {
  const slide = target('slide', 'project-image-grid__item', 'project-image-carousel__slide', 'project-responsive-image');
  restore(slide, crop(1));
  expect(slide.classList.contains('project-responsive-image')).toBe(true);
  const image = target('image', 'project-responsive-image', 'project-cropped');
  restore(image, crop(1, false));
  expect(image.classList.contains('project-responsive-image')).toBe(false);
  expect(image.classList.contains('project-cropped')).toBe(false);
});


const sourceReaders = source.slice(source.indexOf('    const canonicalSrcFromUrl ='), source.indexOf('    const snapshotBaseline ='));
const readers = new Function('projectImage', 'window', `${new Bun.Transpiler({ loader: 'ts' }).transformSync(sourceReaders)}; return { readTargetSrc, readTargetDims };`)(projectImage, { location: { origin: 'http://localhost:4324' } });

test('crop history retains the original source and dimensions after preview promotion', () => {
  const attrs = imageDevEditAttrs(true, { documentKey: 'tapico', path: ['sections', 0], cropId: 'image', variants: undefined, src: 'original.jpg', srcWidth: 4000, srcHeight: 4751 });
  const dataset = { devImageSrc: attrs?.['data-dev-image-src'], devImageSrcWidth: attrs?.['data-dev-image-src-width'], devImageSrcHeight: attrs?.['data-dev-image-src-height'] };
  const image = { src: 'http://localhost:4324/images/original.preview.webp', naturalWidth: 2155, naturalHeight: 2560, closest: () => ({ dataset }), classList: { contains: () => false } };
  expect(readers.readTargetSrc(image)).toBe('original.jpg');
  expect(readers.readTargetDims(image)).toEqual({ srcWidth: 4000, srcHeight: 4751 });
  dataset.devImageSrc = '/images/replacement.png';
  expect(readers.readTargetSrc(image)).toBe('replacement.png');
});

test('listing hover identity remains separate from the cover and its dimensions', () => {
  const attrs = listingCoverDevEditAttrs('tapico', 'home', { image: 'cover.jpg', hoverImage: 'hover.png', srcWidth: 4000, srcHeight: 3000 }, false);
  const dataset = { devImageSrc: attrs?.['data-dev-image-src'], devHoverImageSrc: attrs?.['data-dev-hover-image-src'], devImageSrcWidth: attrs?.['data-dev-image-src-width'], devImageSrcHeight: attrs?.['data-dev-image-src-height'] };
  const image = { src: 'http://localhost:4324/images/hover.preview.webp', naturalWidth: 800, naturalHeight: 600, closest: () => ({ dataset }), classList: { contains: (name: string) => name === 'project-grid__img--hover' } };
  expect(readers.readTargetSrc(image)).toBe('hover.png');
  expect(readers.readTargetDims(image)).toEqual({ srcWidth: 800, srcHeight: 600 });
});

test('page history restores each image background independently, including transparency', () => {
  const a = target('a', 'project-image-grid__item');
  const b = target('b', 'project-image-grid__item', 'project-image-carousel__slide');
  restore(a, { ...crop(1), background: '#ff0000' });
  restore(b, { ...crop(1), background: '#0000ff' });
  restore(a, { ...crop(1), background: 'transparent' });
  expect(a.dataset.devImageBackground).toBe('transparent');
  expect(b.dataset.devImageBackground).toBe('#0000ff');
  restore(a, { ...crop(1), background: '#ff0000' });
  expect(a.dataset.devImageBackground).toBe('#ff0000');
});

const backgroundChangeBody = source.slice(source.indexOf('    const changeBackground ='), source.indexOf("    backgroundInput?.addEventListener('change'"));
const backgroundChangeScript = new Bun.Transpiler({ loader: 'ts' }).transformSync(backgroundChangeBody);

test('background control tracks a reversible change and rejects invalid colour input', () => {
  const history: string[] = [];
  const applied: string[] = [];
  const env = {
    draftBackground: 'transparent', normalizeImageBackground, editTarget: {},
    pushUndo: () => history.push(env.draftBackground),
    applyBackgroundLive: (_target: unknown, value: string) => applied.push(value),
    syncDraftDirty: () => {}, syncBackgroundControl: () => {},
    backgroundInput: { setAttribute: () => {} }, status: { textContent: '' },
  };
  const change = new Function('env', `with (env) { ${backgroundChangeScript}; return changeBackground; }`)(env);
  change('#abc');
  expect(env.draftBackground).toBe('#aabbcc');
  change('transparent');
  expect(env.draftBackground).toBe('transparent');
  expect(history).toEqual(['transparent', '#aabbcc']);
  expect(applied).toEqual(['#aabbcc', 'transparent']);
  change('url(https://example.test/image)');
  expect(history).toHaveLength(2);
  expect(env.draftBackground).toBe('transparent');
  expect(env.status.textContent).toContain('hex colour');
});

test('page history restores mobile inset and background together', () => {
  const image = target('combined', 'project-image-grid__item');
  restore(image, { ...crop(0.8), mobileInset: true, background: '#123456' });
  expect(image.dataset.mobileInset).toBe('true');
  expect(image.dataset.devImageBackground).toBe('#123456');
  restore(image, crop(0.8));
  expect(image.dataset.mobileInset).toBe('false');
  expect(image.dataset.devImageBackground).toBe('transparent');
});
