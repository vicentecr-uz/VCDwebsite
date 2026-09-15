import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { mountInsertedSection } from '../../src/scripts/devSectionMount';
import { projectImageTier } from '../../src/lib/images';

const window = new Window();
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement });

for (const type of ['image', 'imageGrid', 'imageCarousel']) {
  test(`${type}: restored video sections keep playable media and image replacement controls`, () => {
    const item = { id: 'media', src: 'clip.webm', srcWidth: 1920, srcHeight: 1080, alt: 'Demo', variants: { desktop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.6 } } };
    const section = type === 'image' ? { ...item, type } : { id: 'section', type, items: [item] };
    const node = mountInsertedSection(section, 'demo', 0);
    const video = node.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/images/clip.webm');
    expect(video.poster).toBe('/images/clip.webm.poster.webp');
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute('data-project-inline-video')).toBe(true);
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('[data-dev-edit-trigger="image"]')).not.toBeNull();
    expect(projectImageTier('clip.webm', 'thumb')).toBe('/images/clip.webm');
  });
}


for (const type of ['image', 'imageGrid', 'imageCarousel']) {
  test(`${type}: live images retain the full source for the lightbox after leaving Edit`, () => {
    const item = { id: 'photo', src: 'detail.jpg', alt: 'Detail' };
    const section = type === 'image' ? { ...item, type } : { id: 'section', type, items: [item] };
    const node = mountInsertedSection(section, 'demo', 0);
    const image = node.querySelector('img')!;
    expect(image.getAttribute('data-image-original')).toBe('/images/detail.jpg');
    expect(image.getAttribute('role')).toBe('button');
    expect(image.getAttribute('aria-label')).toBe('Open image: Detail');
  });
}
