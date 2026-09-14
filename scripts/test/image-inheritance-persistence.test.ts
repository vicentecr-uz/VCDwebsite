import { expect, test } from 'bun:test';
import { applyCropChange } from '../../astro.config.mjs';
import { normalizeImageVariants, resolveImageGridConstrained } from '../../src/lib/responsiveImage';

const desktop = { aspect: '4:3', cx: 0.4, cy: 0.6, w: 1.2 };
const path = ['sections', 0];
const imageDocument = () => ({ sections: [{ src: 'image.jpg', variants: { desktop: { ...desktop } } }] });
const reload = (document: any) => JSON.parse(JSON.stringify(document));
const resolve = (document: any) => normalizeImageVariants(document.sections[0].variants, '1:1', { width: 1600, height: 900 });

test('saved desktop crop and unlocked zoom inherit through reload and subsequent edits', () => {
  let document = imageDocument();
  expect(applyCropChange(document, { path, variants: { desktop, tablet: {}, mobile: {} } }).ok).toBe(true);
  document = reload(document);
  expect(resolve(document)).toEqual({ desktop, tablet: desktop, mobile: desktop });
  const next = { ...desktop, cy: 0.7, w: 1.4 };
  expect(applyCropChange(document, { path, variants: { desktop: next } }).ok).toBe(true);
  expect(resolve(reload(document)).mobile).toEqual(next);
});

test('aspect and crop reset independently and inherit future upstream changes', () => {
  let document: any = imageDocument();
  expect(applyCropChange(document, { path, variants: {
    tablet: { aspect: '1:1', cx: 0.2, cy: 0.3, w: 0.6 }, mobile: { aspect: '3:4' },
  } }).ok).toBe(true);
  expect(resolve(document).mobile).toEqual({ aspect: '3:4', cx: 0.2, cy: 0.3, w: 0.6 });
  expect(applyCropChange(document, { path, variants: { tablet: { aspect: '1:1' }, mobile: {} } }).ok).toBe(true);
  document = reload(document);
  expect(document.sections[0].variants.tablet).toEqual({ aspect: '1:1' });
  expect(document.sections[0].variants.mobile).toBeUndefined();
  expect(resolve(document).mobile).toEqual({ ...desktop, aspect: '1:1' });
  expect(applyCropChange(document, { path, variants: { desktop: { ...desktop, cx: 0.8 } } }).ok).toBe(true);
  expect(resolve(reload(document)).mobile).toEqual({ ...desktop, aspect: '1:1', cx: 0.8 });
  expect(applyCropChange(document, { path, variants: { tablet: {} } }).ok).toBe(true);
  expect(resolve(reload(document)).mobile.aspect).toBe('4:3');
});

test('explicit equal crop remains an override while another setting inherits', () => {
  const document: any = imageDocument();
  expect(applyCropChange(document, { path, variants: { tablet: { cx: desktop.cx, cy: desktop.cy, w: desktop.w } } }).ok).toBe(true);
  expect(applyCropChange(document, { path, variants: { desktop: { ...desktop, aspect: '16:9', cx: 0.8 } } }).ok).toBe(true);
  expect(resolve(reload(document)).mobile).toEqual({ ...desktop, aspect: '16:9' });
});

test('width Save preserves sparse inheritance and equal explicit overrides', () => {
  let document: any = imageDocument();
  expect(applyCropChange(document, { path, constrained: { desktop: 80, tablet: 80 } }).ok).toBe(true);
  expect(document.sections[0].constrained).toEqual({ desktop: 80, tablet: 80 });
  expect(applyCropChange(document, { path, constrained: { desktop: 60, tablet: 80 } }).ok).toBe(true);
  expect(resolveImageGridConstrained(reload(document).sections[0].constrained)).toEqual({ desktop: 60, tablet: 80, mobile: 80 });
  expect(applyCropChange(document, { path, constrained: { desktop: 60 } }).ok).toBe(true);
  document = reload(document);
  expect(resolveImageGridConstrained(document.sections[0].constrained)).toEqual({ desktop: 60, tablet: 60, mobile: 60 });
  expect(applyCropChange(document, { path, constrained: {} }).ok).toBe(true);
  expect(document.sections[0].constrained).toBeUndefined();
});

test('undo and redo restore ownership even when resolved crops match', () => {
  const document: any = imageDocument();
  const inherited = { desktop, tablet: {}, mobile: {} };
  const explicit = { desktop, tablet: desktop, mobile: {} };
  for (const variants of [explicit, inherited, explicit, inherited]) {
    expect(applyCropChange(document, { path, variants }).ok).toBe(true);
    expect(Boolean(reload(document).sections[0].variants.tablet)).toBe(variants === explicit);
    expect(resolve(document).mobile).toEqual(desktop);
  }
});

test('invalid sparse input fails before clearing crops or replacing the image', () => {
  const invalid = [null, [], 'bad', {}, { wide: {} }, { mobile: [] }, { mobile: null },
    { tablet: { w: 0 } }, { tablet: { cx: NaN } }, { tablet: { cy: Infinity } },
    { tablet: { w: '1' } }, { tablet: { aspect: 'bad' } }, { tablet: { extra: 1 } }];
  for (const key of ['variants', 'hoverVariants']) {
    for (const value of invalid) {
      const document = imageDocument();
      const before = structuredClone(document);
      expect(applyCropChange(document, { path, src: 'replacement.jpg', clearVariants: true, [key]: value }).ok).toBe(false);
      expect(document).toEqual(before);
    }
  }
});

test('invalid responsive widths cannot silently become full-width overrides', () => {
  for (const constrained of [[], null, { desktop: 'bad' }, { wide: 80 }, { tablet: NaN }, { tablet: 20 }]) {
    const document = imageDocument();
    const before = structuredClone(document);
    expect(applyCropChange(document, { path, src: 'replacement.jpg', constrained }).ok).toBe(false);
    expect(document).toEqual(before);
  }
});

test('linked cover and hover aspect resets remove local aspects while preserving independent crops', () => {
  const cover = { ...desktop, aspect: '1:1' };
  const hover = { ...desktop, cx: 0.1, aspect: '1:1' };
  const document: any = { sections: [{ image: 'cover.jpg', hoverImage: 'hover.jpg',
    variants: { desktop, tablet: cover }, hoverVariants: { desktop, tablet: hover } }] };
  expect(applyCropChange(document, { path, variants: { tablet: { cx: cover.cx, cy: cover.cy, w: cover.w } } }).ok).toBe(true);
  expect(document.sections[0].hoverVariants.tablet).toEqual({ cx: 0.1, cy: desktop.cy, w: desktop.w });
  expect(applyCropChange(document, { path, hoverVariants: { tablet: {}, mobile: {} } }).ok).toBe(true);
  expect(document.sections[0].hoverVariants).toEqual({ desktop });
  expect(document.sections[0].variants.tablet).toEqual({ cx: cover.cx, cy: cover.cy, w: cover.w });
  expect(applyCropChange(document, { path, variants: { desktop, tablet: {}, mobile: {} }, hoverVariants: { desktop, tablet: {}, mobile: {} } }).ok).toBe(true);
  expect(reload(document).sections[0].variants).toEqual({ desktop });
  expect(reload(document).sections[0].hoverVariants).toEqual({ desktop });
});
