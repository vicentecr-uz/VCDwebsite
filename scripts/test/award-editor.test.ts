import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { normalizeHref } from '../../src/lib/normalizeHref.mjs';

const source = readFileSync(new URL('../../src/scripts/projectAwardEditor.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

test('new awards apply, clear and restore links; cancel and teardown leave the saved value intact', async () => {
  const dom = new Window();
  const doc = dom.document;
  doc.documentElement.classList.add('is-dev-mode');
  const controller = new dom.AbortController();
  const setup = new Function('window', 'document', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'MutationObserver', 'Event', 'CustomEvent', 'normalizeHref', 'pageHistory', 'isDevContentEditing', `${code}; return bindProjectAwardEditors;`);
  const bind = setup(dom, doc, dom.Element, dom.HTMLElement, dom.HTMLInputElement, dom.HTMLFormElement, dom.MutationObserver, dom.Event, dom.CustomEvent, normalizeHref, { breakGroup() {} }, () => doc.documentElement.classList.contains('is-dev-mode'));
  bind(controller.signal);
  // Mount after binding: the first award on a page must work without a reload.
  doc.body.innerHTML = `<section data-project-award><span class="project-award__proxy" hidden></span><a class="project-award__hit"><img alt="Award"></a><button data-award-edit>Edit award</button><form data-award-editor hidden><button type="button" data-award-remove>Remove</button><input data-award-input></form></section>`;
  const root = doc.querySelector('[data-project-award]')!;
  const proxy = root.querySelector('.project-award__proxy')!;
  const hit = root.querySelector('a')!;
  const edit = root.querySelector('button')!;
  const form = root.querySelector('form')!;
  const input = root.querySelector('input')!;
  let changes = 0;
  proxy.addEventListener('input', () => changes++);
  const open = () => edit.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }));
  const submit = () => form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
  try {
    open();
    assert.equal(form.hidden, false);
    assert.equal(edit.hidden, true);
    input.value = 'example.com/award';
    submit();
    assert.equal(hit.getAttribute('href'), 'https://example.com/award');
    assert.equal(proxy.textContent, 'https://example.com/award');
    assert.equal(changes, 1);
    assert.equal(form.hidden, true);

    open();
    input.value = 'javascript:alert(1)';
    submit();
    assert.equal(form.hidden, false);
    assert.equal(changes, 1);
    assert.equal(input.validity.customError, true);
    doc.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    open();
    assert.equal(input.value, 'https://example.com/award');
    assert.equal(input.validity.customError, false);
    root.querySelector('[data-award-remove]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }));
    assert.equal(hit.hasAttribute('href'), false);
    assert.equal(proxy.textContent, '');

    // The shared page history restores the proxy; the badge must follow it.
    proxy.textContent = '/restored';
    await dom.happyDOM.whenAsyncComplete();
    assert.equal(hit.getAttribute('href'), '/restored');
    open();
    input.value = '/cancelled';
    doc.body.dispatchEvent(new dom.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(form.hidden, true);
    assert.equal(proxy.textContent, '/restored');

    open();
    doc.documentElement.classList.remove('is-dev-mode');
    dom.dispatchEvent(new dom.Event('vcd:dev-mode-change'));
    assert.equal(form.hidden, true);
    controller.abort();
    doc.documentElement.classList.add('is-dev-mode');
    open();
    assert.equal(form.hidden, true);
  } finally {
    controller.abort();
    await dom.happyDOM.close();
  }
});
