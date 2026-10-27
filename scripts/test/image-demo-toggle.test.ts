import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/ProgressiveImageDemo.astro', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('    function setLoadingState('), source.indexOf("    load.addEventListener('click', toggleLoading"));
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(controller);
const attempts: Array<{ onError: () => void; destroyed: boolean; open: () => void; bind: () => void; destroy: () => void }> = [];
const thumbnail = { dataset: {}, complete: true, naturalWidth: 4032, src: 'thumb.jpg', remove() {}, insertAdjacentElement(_position: string, image: any) { current = image; return image; } };
let current: any = thumbnail;
let label = 'Load';
const status = { textContent: '' };
const initialize = new Function('createImagePreviewUpgrade', 'template', 'stack', 'load', 'status', 'currentImageArg', `
  const host = { dataset: { imagePreviewUrl: 'preview.jpg' } };
  const toolbar = { toggleAttribute() {} };
  const signal = new AbortController().signal;
  let loading = false, generation = 0, upgrade, frame = 0;
  const thumbnail = arguments[6];
  let activeImage = thumbnail;
  const currentImage = () => activeImage;
  const hideTooltip = () => {};
  const draws = arguments[7];
  const drawSource = () => draws.push(currentImage());
  const syncBadges = () => {};
  const cancelAnimationFrame = () => {};
  ${javascript}
  return { toggleLoading, dispose() { generation++; }, state: () => loading };
`);
const demo = initialize((options: { onError: () => void }) => {
  const attempt = { ...options, destroyed: false, bind() {}, open() {}, destroy() { this.destroyed = true; } };
  attempts.push(attempt);
  return attempt;
}, { content: { cloneNode() {
  const image = { dataset: {}, complete: true, naturalWidth: 4032, src: 'thumb.jpg', remove() { current = thumbnail; }, addEventListener() {} };
  return { querySelector: () => image };
} } }, { prepend() {}, querySelector() { return current; } }, {
  setAttribute(name: string, value: string) { if (name === 'aria-label') label = value; }, querySelector() { return null; },
}, status, () => current, thumbnail, []);

demo.toggleLoading();
assert.equal(label, 'Unload');
assert.equal(attempts.length, 1);
assert.notEqual(current, thumbnail, 'upgrade uses a temporary layer above the original thumbnail');
assert.equal(thumbnail.src, 'thumb.jpg', 'the original thumbnail remains unchanged');
demo.toggleLoading();
assert.equal(label, 'Load');
assert.equal(attempts[0].destroyed, true);
assert.equal(current, thumbnail, 'unload restores synchronously');
attempts[0].onError();
assert.equal(status.textContent, 'Low-resolution image shown', 'cancelled request errors must not replace current status');
demo.toggleLoading();
assert.equal(label, 'Unload');
assert.equal(attempts.length, 2);
attempts[1].onError();
assert.equal(label, 'Load');
assert.match(status.textContent, /Try Load again/);
demo.toggleLoading();
assert.equal(attempts.length, 3, 'failure remains retryable');
thumbnail.complete = false;
demo.toggleLoading();
assert.equal(status.textContent, 'Low-resolution image unavailable. Try Unload again.');
thumbnail.complete = true;
demo.dispose();
attempts[2].onError();
assert.equal(status.textContent, 'Low-resolution image unavailable. Try Unload again.', 'disposed callbacks cannot overwrite state');
console.log('image-demo-toggle: passed (persistent thumbnail, synchronous unload, cancellation, retry, stale error, disposal, unavailable thumb)');
