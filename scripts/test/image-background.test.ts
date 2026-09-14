import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { applyCropChange } from '../../astro.config.mjs';
import { normalizeImageBackground } from '../../src/lib/imageBackground.mjs';
import { imageDevEditAttrs } from '../../src/lib/projectImageFrame';
import { mountInsertedSection } from '../../src/scripts/devSectionMount';

test('normalizes picker colours to solid RGB and transparent', () => {
  expect(normalizeImageBackground('#abc')).toBe('#aabbcc');
  expect(normalizeImageBackground('#abcd')).toBe('#aabbcc');
  expect(normalizeImageBackground('#abc0')).toBe('transparent');
  expect(normalizeImageBackground('#abcd0000')).toBe('transparent');
  expect(normalizeImageBackground('#11223380')).toBe('#112233');
  expect(normalizeImageBackground('nope')).toBeNull();
});

test('background persistence supports all image section shapes and removal', () => {
  for (const type of ['image', 'imageGrid', 'imageCarousel']) {
    const item = type === 'image' ? { type, src: 'a.jpg' } : { type, items: [{ src: 'a.jpg' }] };
    const document = { sections: [item] };
    const path = ['sections', 0, ...(type === 'image' ? [] : ['items', 0])] as (string | number)[];
    expect(applyCropChange(document, { path, background: '#abc' }).ok).toBe(true);
    expect((type === 'image' ? document.sections[0] : document.sections[0].items[0]).background).toBe('#aabbcc');
    expect(applyCropChange(document, { path, background: 'transparent' }).ok).toBe(true);
    expect((type === 'image' ? document.sections[0] : document.sections[0].items[0]).background).toBeUndefined();
    expect(applyCropChange(document, { path, background: '#123456' }).ok).toBe(true);
    expect(applyCropChange(document, { path, src: 'b.jpg' }).ok).toBe(true);
    expect((type === 'image' ? document.sections[0] : document.sections[0].items[0]).background).toBe('#123456');
  }
});

test('invalid background rejects before source or crop mutation', () => {
  const document = { sections: [{ type: 'image', src: 'a.jpg', variants: { desktop: { aspect: '3:2' } }, background: '#123456' }] };
  const before = structuredClone(document);
  expect(applyCropChange(document, { path: ['sections', 0], src: 'b.jpg', clearVariants: true, background: 'rgb(1, 2, 3)' }).ok).toBe(false);
  expect(document).toEqual(before);
});

test('SSR attrs and mounted image sections carry the canonical background', () => {
  expect(imageDevEditAttrs(true, { documentKey: 'p', path: ['sections', 0], cropId: 'i', variants: undefined, background: '#abcd' })?.['data-dev-image-background']).toBe('#aabbcc');
  const win = new Window();
  const previous = globalThis.document;
  // @ts-expect-error happy-dom document for the mount-only DOM test.
  globalThis.document = win.document;
  try {
    const sections = [
      { type: 'image', src: 'a.jpg', background: '#abc' },
      { type: 'imageGrid', items: [{ src: 'a.jpg', background: '#abc' }] },
      { type: 'imageCarousel', items: [{ src: 'a.jpg', background: '#abc' }] },
    ];
    for (const section of sections) {
      const root = mountInsertedSection(section, 'p', 0);
      const target = root.querySelector<HTMLElement>('[data-dev-image-target]')!;
      expect(target.dataset.devImageBackground).toBe('#aabbcc');
      expect(target.style.getPropertyValue('--project-image-background')).toBe('#aabbcc');
    }
  } finally {
    globalThis.document = previous;
  }
});
