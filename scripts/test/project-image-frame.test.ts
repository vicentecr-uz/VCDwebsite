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
