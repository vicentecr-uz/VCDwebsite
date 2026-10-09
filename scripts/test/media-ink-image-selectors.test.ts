import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'bun:test';
import { Window } from 'happy-dom';

const selectors = [
  {
    path: '../../src/lib/projectImageCarousel.ts',
    selector: 'img.project-image-grid__image',
  },
  {
    path: '../../src/scripts/bindCaptionMediaInk.ts',
    selector: 'img.project-image-grid__image, img.project-media__img, img.project-image__img',
  },
  {
    path: '../../src/scripts/bindEditorChipMediaInk.ts',
    selector: 'img.project-image-grid__image, img.project-media__img, img.project-image__img, img',
  },
] as const;

test('media ink selectors sample real images without fetching video sources', () => {
  const browser = new Window();
  const { document } = browser;
  document.body.innerHTML = `
    <div class="project-image-grid__frame">
      <video class="project-image-grid__image" src="large.mp4"></video>
      <img class="project-image-grid__image" src="thumb.jpg" />
    </div>`;
  const frame = document.querySelector<HTMLElement>('.project-image-grid__frame')!;
  const sampled: string[] = [];

  for (const { path, selector } of selectors) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes(selector), `${path} must use an image-qualified selector`);
    const candidate = frame.querySelector<HTMLImageElement>(selector);
    assert.equal(candidate?.tagName, 'IMG');
    sampled.push(candidate?.getAttribute('src') ?? '');
  }

  assert.deepEqual(sampled, ['thumb.jpg', 'thumb.jpg', 'thumb.jpg']);
});
