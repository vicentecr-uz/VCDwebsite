import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'bun:test';
import { Window } from 'happy-dom';

function extractFunction(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

function compileFunction(source: string, signature: string, name: string, globals: Record<string, unknown> = {}) {
  const functionSource = extractFunction(source, signature);
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${functionSource}\nglobalThis.__extracted = ${name};`,
  );
  const context = { ...globals };
  runInNewContext(compiled, context);
  return (context as { __extracted: Function }).__extracted;
}

function fixture(markup: string) {
  const browser = new Window();
  const { document } = browser;
  document.body.innerHTML = markup;
  return { browser, document, frame: document.querySelector<HTMLElement>('[data-carousel-frame]')! };
}

function setRect(element: Element, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
  });
}

test('carousel media ink skips video elements sharing the image class', async () => {
  const source = readFileSync(new URL('../../src/lib/projectImageCarousel.ts', import.meta.url), 'utf8');
  const sampled: string[] = [];
  const refresh = compileFunction(source, 'async function refreshCarouselMediaInk', 'refreshCarouselMediaInk', {
    lumaGridFor: async (src: string) => { sampled.push(src); return { naturalWidth: 100, naturalHeight: 100 }; },
    applyMediaGround: (dots: HTMLElement, ground: string) => { dots.dataset.mediaGround = ground; },
    opaqueBackground: () => '#fff', groundForBox: () => 'dark', readCropVars: () => null, cropHostFor: () => null,
    clearCarouselMediaInk: (dots: HTMLElement) => { delete dots.dataset.mediaGround; },
    mediaInkGeneration: new WeakMap(),
  });

  const videoFixture = fixture('<div data-carousel-slide><div data-carousel-frame><video class="project-image-grid__image" src="large.mp4"></video></div></div>');
  const dots = videoFixture.document.createElement('div');
  setRect(videoFixture.frame, 100, 100); setRect(dots, 100, 20);
  await refresh({ block: { dataset: { dotsPlacement: 'over' } }, slides: [videoFixture.document.querySelector('[data-carousel-slide]')], active: 0, dotWindow: dots });
  assert.deepEqual(sampled, []);
  assert.equal(dots.dataset.mediaGround, undefined);

  const imageFixture = fixture('<div data-carousel-slide><div data-carousel-frame><img class="project-image-grid__image" src="thumb.jpg"></div></div>');
  const imageDots = imageFixture.document.createElement('div');
  setRect(imageFixture.frame, 100, 100); setRect(imageDots, 100, 20);
  await refresh({ block: { dataset: { dotsPlacement: 'over' } }, slides: [imageFixture.document.querySelector('[data-carousel-slide]')], active: 0, dotWindow: imageDots });
  assert.deepEqual(sampled, ['thumb.jpg']);
  assert.equal(imageDots.dataset.mediaGround, 'dark');
});

test('caption and editor chip helpers ignore video-only media and find images', () => {
  const captionSource = readFileSync(new URL('../../src/scripts/bindCaptionMediaInk.ts', import.meta.url), 'utf8');
  const editorSource = readFileSync(new URL('../../src/scripts/bindEditorChipMediaInk.ts', import.meta.url), 'utf8');
  const captionImage = compileFunction(captionSource, 'function imgIn', 'imgIn');
  const editorImage = compileFunction(editorSource, 'function imageIn', 'imageIn');
  const { frame } = fixture('<div data-carousel-frame><video class="project-media__img" src="large.mp4"></video></div>');
  assert.equal(captionImage(frame), null);
  assert.equal(editorImage(frame), null);
  frame.insertAdjacentHTML('beforeend', '<img class="project-media__img" src="thumb.jpg">');
  assert.equal(captionImage(frame)?.getAttribute('src'), 'thumb.jpg');
  assert.equal(editorImage(frame)?.getAttribute('src'), 'thumb.jpg');
});
