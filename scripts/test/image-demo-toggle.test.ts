import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/ProgressiveImageDemo.astro', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('    function setLoadingState('), source.indexOf("    load.addEventListener('click', toggleLoading"));
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(controller);
type Image = { dataset: Record<string, string>; complete: boolean; naturalWidth: number; src: string; removed: number; remove(): void; addEventListener(): void };
const thumbnail: Image & { insertAdjacentElement(position: string, image: Image): Image } = { dataset: {}, complete: true, naturalWidth: 4032, src: 'thumb.jpg', removed: 0, remove() { this.removed++; }, addEventListener() {}, insertAdjacentElement() { return latestImage; } };
const draws: Image[] = [];
let label = 'Load';
const status = { textContent: '' };
const attempts: Array<{ image: Image; onError: () => void; destroyed: boolean; open: () => void; bind: () => void; destroy: () => void }> = [];
let latestImage: Image = thumbnail;
const template = { content: { cloneNode() {
  const image: Image = { dataset: {}, complete: false, naturalWidth: 0, src: 'thumb.jpg', removed: 0, remove() { this.removed++; }, addEventListener() {} };
  latestImage = image;
  return { querySelector: () => image };
} } };
const stack = { querySelector() { return thumbnail; } };
const load = { setAttribute(name: string, value: string) { if (name === 'aria-label') label = value; }, querySelector() { return null; } };
const initialize = new Function('createImagePreviewUpgrade', 'template', 'stack', 'load', 'status', 'thumbnail', 'draws', `
  const host = { dataset: { imagePreviewUrl: 'preview.jpg' } };
  const toolbar = { toggleAttribute() {} };
  const signal = new AbortController().signal;
  let loading = false, generation = 0, upgrade, frame = 0;
  let activeImage = thumbnail;
  const currentImage = () => activeImage;
  const hideTooltip = () => {};
  const syncBadges = () => {};
  const drawSource = () => { const current = currentImage(); draws.push(current.complete && current.naturalWidth ? current : thumbnail); };
  const cancelAnimationFrame = () => {};
  ${javascript}
  return { toggleLoading, dispose() { generation++; }, state: () => loading, active: () => activeImage };
`);
const demo = initialize((options: { onError: () => void }) => {
  const image = latestImage;
  const attempt = { image, ...options, destroyed: false, bind() {}, open() {}, destroy() { this.destroyed = true; } };
  attempts.push(attempt);
  return attempt;
}, template, stack, load, status, thumbnail, draws);

demo.toggleLoading();
assert.equal(label, 'Unload');
assert.equal(attempts.length, 1);
const first = demo.active();
assert.notEqual(first, thumbnail);
assert.equal(thumbnail.src, 'thumb.jpg');
assert.equal(thumbnail.removed, 0);
first.complete = true; first.naturalWidth = 4032; first.src = 'preview.jpg'; first.dataset.imageUpgraded = 'true';
demo.toggleLoading();
assert.equal(label, 'Load');
assert.equal(first.removed, 1);
assert.equal(demo.active(), thumbnail);
assert.equal(draws.at(-1), thumbnail, 'unload draws the ready original synchronously');
assert.equal(thumbnail.src, 'thumb.jpg');

demo.toggleLoading();
demo.toggleLoading();
demo.toggleLoading();
assert.equal(label, 'Unload', 'rapid toggles leave the intended final loading state');
assert.equal(attempts.filter((attempt) => !attempt.destroyed).length, 1, 'only the current upgrade remains live');
const retry = attempts.at(-1)!;
retry.onError();
assert.equal(label, 'Load');
assert.match(status.textContent, /Try Load again/);
demo.toggleLoading();
assert.equal(demo.active().removed, 0, 'retry starts a fresh temporary layer');
assert.equal(attempts.filter((attempt) => !attempt.destroyed).length, 1);
attempts[1].onError();
assert.equal(label, 'Unload', 'an earlier error cannot reset the newer run');
assert.equal(status.textContent, '', 'an earlier error cannot replace the newer run status');
const stale = attempts.at(-1)!;
demo.dispose();
stale.onError();
assert.equal(status.textContent, '', 'disposed callback cannot overwrite status');

thumbnail.complete = false;
const unavailable = initialize((options: { onError: () => void }) => ({ ...options, bind() {}, open() {}, destroy() {} }), template, stack, load, status, thumbnail, draws);
unavailable.toggleLoading();
const unavailableImage = unavailable.active();
unavailableImage.complete = true;
unavailableImage.naturalWidth = 4032;
unavailableImage.src = 'preview.jpg';
unavailableImage.dataset.imageUpgraded = 'true';
unavailable.toggleLoading();
assert.equal(unavailable.active(), unavailableImage, 'missing thumbnail retains the active high image');
assert.equal(label, 'Unload');
assert.equal(status.textContent, 'Low-resolution image unavailable. Try Unload again.');
console.log('image-demo-toggle: passed (persistent thumbnail, synchronous unload, bounded retries, rapid toggles, stale error, disposal, unavailable thumb)');
