import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { initEditorSelectBridge, type EditorSelectSnapshot } from '../../src/lib/editorSelect';

const window = new Window();
const { document } = window;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  document,
  MutationObserver: window.MutationObserver,
  HTMLSelectElement: window.HTMLSelectElement,
  queueMicrotask,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

try {
  const form = document.createElement('form');
  const select = document.createElement('select');
  select.name = 'status';
  select.innerHTML = '<optgroup label="Active"><option value="draft">Draft</option><option value="published">Published</option></optgroup><option value="archived">Archived</option>';
  form.append(select);
  document.body.append(form);
  const snapshots: EditorSelectSnapshot[] = [];
  const values: Array<string | null> = [];
  const dispose = initEditorSelectBridge(select as unknown as HTMLSelectElement, (snapshot) => {
    values.push(snapshot.value);
    snapshots.push(snapshot);
  });

  assert.equal(select.value, 'draft');
  select.value = 'published';
  assert.equal(values.at(-1), 'published', 'direct value assignments sync React state');
  select.selectedIndex = 2;
  assert.equal(values.at(-1), 'archived', 'selectedIndex assignments sync React state');
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(values.at(-1), 'archived', 'native change events are observed');

  const extra = document.createElement('option');
  extra.value = 'long';
  extra.textContent = 'A long status';
  select.append(extra);
  await window.happyDOM.waitUntilComplete();
  assert.equal(snapshots.at(-1)?.options.at(-1)?.label, 'A long status', 'dynamic options are observed');
  extra.disabled = true;
  await window.happyDOM.waitUntilComplete();
  assert.equal(snapshots.at(-1)?.options.at(-1)?.disabled, true, 'option disabled state is observed');

  select.selectedIndex = 2;
  form.reset();
  await window.happyDOM.waitUntilComplete();
  assert.equal(values.at(-1), 'draft', 'form reset syncs after the native default action');

  select.dataset.emptyLabel = 'Mixed';
  select.value = 'missing';
  await window.happyDOM.waitUntilComplete();
  assert.equal(snapshots.at(-1)?.value, null, 'unmatched native value has no selected option');
  assert.equal(snapshots.at(-1)?.emptyLabel, 'Mixed');
  const group = select.querySelector('optgroup')!;
  group.disabled = true;
  select.options[0].setAttribute('label', 'Draft label');
  select.options[0].dataset.iconSvg = '<svg></svg>';
  await window.happyDOM.waitUntilComplete();
  assert.equal(snapshots.at(-1)?.options[0].disabled, true);
  assert.equal(snapshots.at(-1)?.options[0].label, 'Draft label');
  assert.equal(snapshots.at(-1)?.options[0].iconSvg, '<svg></svg>');
  const secondForm = document.createElement('form');
  document.body.append(secondForm);
  const beforeOtherReset = values.length;
  secondForm.reset();
  await window.happyDOM.waitUntilComplete();
  assert.equal(values.length, beforeOtherReset, 'another form reset does not update this control');

  const beforeReset = values.length;
  form.dispatchEvent(new window.Event('reset'));
  dispose();
  await window.happyDOM.waitUntilComplete();
  assert.equal(values.length, beforeReset, 'queued reset cannot update a disposed bridge');

  const count = values.length;
  select.value = 'draft';
  assert.equal(values.length, count, 'cleanup restores native descriptors');
  assert.equal(Object.hasOwn(select, 'value'), false);
  assert.equal(Object.hasOwn(select, 'selectedIndex'), false);
  const remount = initEditorSelectBridge(select as unknown as HTMLSelectElement, snapshot => values.push(snapshot.value));
  select.value = 'published';
  assert.equal(values.at(-1), 'published', 'bridge can remount after cleanup');
  remount();
  assert.deepEqual(new window.FormData(form).getAll('status'), ['published']);
  console.log('editor-select-bridge: passed (value, index, change, dynamic options, cleanup)');
} finally {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
