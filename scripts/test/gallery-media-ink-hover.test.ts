import { expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';

const sampledSources: string[] = [];

mock.module('../../src/scripts/adaptiveMediaInk', () => ({
  applyChipAppearance() {},
  applyChipBrightness() {},
  applyMediaGround(host: HTMLElement, ground: 'light' | 'dark') {
    host.dataset.mediaGround = ground;
  },
  cropHostFor: () => null,
  groundForBox: () => 'dark',
  lumaGridFor: (src: string) => {
    sampledSources.push(src);
    return Promise.resolve({ naturalWidth: 100, naturalHeight: 100, src });
  },
  opaqueBackground: () => '#fff',
  readCropVars: () => null,
  sampleForBox: () => ({ luma: 0.2, pixels: new Uint8ClampedArray() }),
}));

const browser = new Window({ url: 'http://localhost/' });
const { document } = browser;
Object.assign(globalThis, {
  window: browser,
  document,
  HTMLElement: browser.HTMLElement,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: class { observe() {} disconnect() {} },
  getComputedStyle: browser.getComputedStyle.bind(browser),
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});

const { bindGalleryMediaInk } = await import('../../src/scripts/bindGalleryMediaInk');

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fixture(): HTMLElement {
  document.body.innerHTML = `
    <div class="project-grid">
      <article class="project-grid__item" data-dev-dark="false">
        <a class="project-grid__card" href="/project">
          <div class="project-grid__cover project-grid__cover--has-hover">
            <img class="project-grid__img--base" src="base.png" />
            <div class="project-grid__hover-layer"><img class="project-grid__img--hover" src="hover.png" /></div>
          </div>
        </a>
      </article>
    </div>`;
  return document.querySelector<HTMLElement>('.project-grid__item')!;
}

function pointerMove(card: HTMLElement, movementX: number, movementY: number): void {
  const event = new browser.Event('pointermove') as PointerEvent;
  Object.defineProperties(event, { movementX: { value: movementX }, movementY: { value: movementY } });
  card.dispatchEvent(event);
}

test('gallery hover waits for real pointer movement and resets on leave', async () => {
  sampledSources.length = 0;
  const item = fixture();
  const card = item.querySelector<HTMLElement>('.project-grid__card')!;
  const cleanup = bindGalleryMediaInk();
  await tick();

  expect(card.hasAttribute('data-pointer-hover')).toBe(false);
  expect(sampledSources.some((src) => src.endsWith('/base.png'))).toBe(true);

  card.dispatchEvent(new browser.Event('pointerenter'));
  pointerMove(card, 0, 0);
  await tick();
  expect(card.hasAttribute('data-pointer-hover')).toBe(false);
  expect(sampledSources.some((src) => src.endsWith('/hover.png'))).toBe(false);

  pointerMove(card, 4, 0);
  await tick();
  expect(card.hasAttribute('data-pointer-hover')).toBe(true);
  expect(sampledSources.some((src) => src.endsWith('/hover.png'))).toBe(true);

  const samplesAfterActivation = sampledSources.length;
  pointerMove(card, 2, 3);
  await tick();
  expect(sampledSources.length).toBe(samplesAfterActivation);

  card.dispatchEvent(new browser.Event('pointerleave'));
  await tick();
  expect(card.hasAttribute('data-pointer-hover')).toBe(false);
  pointerMove(card, 0, 3);
  expect(card.hasAttribute('data-pointer-hover')).toBe(true);
  cleanup();
  expect(card.hasAttribute('data-pointer-hover')).toBe(false);
  pointerMove(card, 3, 0);
  expect(card.hasAttribute('data-pointer-hover')).toBe(false);
});

test('a newly mounted gallery card starts without pointer hover', async () => {
  const item = fixture();
  const card = item.querySelector<HTMLElement>('.project-grid__card')!;
  card.setAttribute('data-pointer-hover', '');
  const cleanup = bindGalleryMediaInk();
  await tick();
  expect(card.hasAttribute('data-pointer-hover')).toBe(false);
  cleanup();
});
