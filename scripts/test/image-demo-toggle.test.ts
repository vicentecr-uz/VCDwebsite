import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/ProgressiveImageDemo.astro', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('    function setLoadingState('), source.indexOf("    load.addEventListener('click', toggleLoading"));
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(controller);
const attempts: Array<{ onError: () => void; destroyed: boolean; open: () => void; bind: () => void; destroy: () => void }> = [];
let current = { dataset: {}, remove() {} };
let restore: (() => void) | undefined;
let label = 'Load';
const status = { textContent: '' };
const initialize = new Function('createImagePreviewUpgrade', 'template', 'stack', 'load', 'status', 'currentImage', `
  const host = { dataset: { imagePreviewUrl: 'preview.jpg' } };
  const toolbar = { toggleAttribute() {} };
  const signal = new AbortController().signal;
  let loading = false, restoreBusy = false, generation = 0, upgrade, frame = 0;
  const hideTooltip = () => {};
  const drawSource = () => {};
  const cancelAnimationFrame = () => {};
  ${javascript}
  return { toggleLoading, dispose() { generation++; }, state: () => loading };
`);
const demo = initialize((options: { onError: () => void }) => {
  const attempt = { ...options, destroyed: false, bind() {}, open() {}, destroy() { this.destroyed = true; } };
  attempts.push(attempt);
  return attempt;
}, { content: { cloneNode() {
  const image = { dataset: {}, complete: false, addEventListener(type: string, callback: () => void) { if (type === 'load') restore = callback; }, remove() {} };
  return { querySelector: () => image };
} } }, { prepend(incoming: { querySelector: () => typeof current }) { current = incoming.querySelector(); } }, {
  setAttribute(name: string, value: string) { if (name === 'aria-label') label = value; }, querySelector() { return null; },
}, status, () => current);

demo.toggleLoading();
assert.equal(label, 'Unload');
assert.equal(attempts.length, 1);
demo.toggleLoading();
assert.equal(label, 'Load');
assert.equal(attempts[0].destroyed, true);
attempts[0].onError();
assert.equal(status.textContent, '', 'cancelled request errors must not replace current status');
demo.toggleLoading();
assert.equal(label, 'Unload');
assert.equal(attempts.length, 1, 'reload waits for the restored thumbnail');
restore!();
assert.equal(attempts.length, 2, 'queued reload starts once the thumbnail is ready');
attempts[1].onError();
assert.equal(label, 'Load');
assert.match(status.textContent, /Try Load again/);
demo.toggleLoading();
assert.equal(attempts.length, 3, 'failure remains retryable');
demo.toggleLoading();
demo.toggleLoading();
demo.toggleLoading();
restore!();
assert.equal(attempts.length, 3, 'a second queued toggle cancels the queued reload');
assert.equal(label, 'Load');
demo.toggleLoading();
demo.toggleLoading();
demo.toggleLoading();
demo.dispose();
restore!();
assert.equal(attempts.length, 4, 'stale restore completion cannot start a load after teardown');
console.log('image-demo-toggle: passed (cancel, queued reload, repeated toggle, stale error, retry, teardown)');
