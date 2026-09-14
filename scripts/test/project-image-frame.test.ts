import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { syncImageSourceDims, syncPlaceholderState } from '../../src/lib/projectImageFrame';

const cases = [
  ['standalone', 'project-media'],
  ['grid', 'project-image-grid__item'],
  ['carousel', 'project-image-carousel__slide project-image-grid__item'],
] as const;

for (const [name, className] of cases) {
  test(`${name} source replacement and reverse restore placeholder chrome`, () => {
    const window = new Window();
    const target = window.document.createElement('figure');
    target.className = `${className} project-media--placeholder`;
    const label = window.document.createElement('span');
    label.className = 'project-media__placeholder-label';
    const image = window.document.createElement('img');
    target.append(image, label);

    syncPlaceholderState(target, 'replacement.webp');
    assert.equal(target.classList.contains('project-media--placeholder'), false);
    assert.equal(label.hidden, true);
    assert.equal(label.style.display, 'none');

    syncPlaceholderState(target, 'placeholder.svg');
    assert.equal(target.classList.contains('project-media--placeholder'), true);
    assert.equal(label.hidden, false);
    assert.equal(label.style.display, '');
  });
}

test('source dimensions replace prior metadata and clear when unavailable', () => {
  const window = new Window();
  const target = window.document.createElement('figure');

  const frame = window.document.createElement('div');
  frame.className = 'project-image-grid__frame';
  frame.dataset.originalRatioLocked = 'true';
  target.dataset.originalRatioLocked = 'true';
  target.append(frame);
  syncImageSourceDims(target, { srcWidth: 1600, srcHeight: 900 });
  assert.equal(frame.dataset.originalRatioLocked, undefined);
  assert.equal(target.dataset.originalRatioLocked, undefined);
  assert.equal(frame.style.getPropertyValue('--project-image-original-ratio'), '1600 / 900');
  assert.equal(target.dataset.devImageSrcWidth, '1600');
  assert.equal(target.style.getPropertyValue('--project-image-original-ratio'), '1600 / 900');

  syncImageSourceDims(target);
  assert.equal(frame.style.getPropertyValue('--project-image-original-ratio'), '');
  assert.equal(target.dataset.devImageSrcWidth, undefined);
  assert.equal(target.dataset.devImageSrcHeight, undefined);
  assert.equal(target.style.getPropertyValue('--project-image-original-ratio'), '');
});

test('edit attrs preserve authored hover and width maps separately from resolved maps', async () => {
  const { listingCoverDevEditAttrs, imageDevEditAttrs } = await import('../../src/lib/projectImageFrame');
  const listing = listingCoverDevEditAttrs('demo', 'home', {
    image: 'cover.jpg',
    variants: { desktop: { aspect: '3:2' } },
    hoverVariants: { desktop: { cx: 0.2, cy: 0.5, w: 1 } },
  }, false);
  assert.deepEqual(JSON.parse(listing['data-dev-hover-variants-authored']), { desktop: { cx: 0.2, cy: 0.5, w: 1 } });
  const attrs = imageDevEditAttrs(true, {
    documentKey: 'demo', path: ['sections', 0], cropId: 'image', variants: {},
    constrained: { desktop: 100, tablet: 100, mobile: 100 }, authoredConstrained: { desktop: 80 },
  });
  assert.deepEqual(JSON.parse(attrs!['data-dev-image-constrained-authored']), { desktop: 80 });
  const absent = imageDevEditAttrs(true, { documentKey: 'demo', path: ['sections', 0], cropId: 'image', variants: {} });
  assert.deepEqual(JSON.parse(absent!['data-dev-image-constrained-authored']), {});
});

test('hover crops inherit the desktop crop while authored metadata stays sparse', async () => {
  const { listingCoverDevEditAttrs } = await import('../../src/lib/projectImageFrame');
  const attrs = listingCoverDevEditAttrs('demo', 'home', {
    image: 'cover.jpg',
    variants: { desktop: { aspect: '3:2' } },
    hoverVariants: { desktop: { aspect: '16:9', cx: 0.3, cy: 0.6, w: 1.2 } },
  }, false);
  const resolved = JSON.parse(attrs['data-dev-hover-variants']);
  for (const viewport of ['tablet', 'mobile']) {
    assert.equal(resolved[viewport].cx, resolved.desktop.cx);
    assert.equal(resolved[viewport].cy, resolved.desktop.cy);
    assert.equal(resolved[viewport].w, resolved.desktop.w);
  }
  assert.deepEqual(JSON.parse(attrs['data-dev-hover-variants-authored']), {
    desktop: { aspect: '16:9', cx: 0.3, cy: 0.6, w: 1.2 },
  });
});
