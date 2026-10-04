import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Window } from 'happy-dom';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sectionEditTarget } from '../../src/scripts/devEditTarget';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('    type DetailsSnapshot =');
const end = source.indexOf('    syncIntroRunControls();', start) + '    syncIntroRunControls();'.length;
assert.ok(start > 0 && end > start);
const detailsCode = source.slice(start, end);

type Harness = {
  dom: Window;
  root: HTMLElement;
  textStates: Array<{ element: HTMLElement; path: unknown[]; savedValue: string }>;
  pending: Map<string, any>;
  history: Array<{ undo: () => void; redo: () => void }>;
  click: (selector: string) => void;
  persist: (change: any) => Promise<void>;
  writes: any[];
};

function harness(): Harness {
  const dom = new Window();
  const document = dom.document;
  const root = document.createElement('section');
  root.dataset.devProjectDetails = '';
  root.dataset.devSpacingDocument = 'fixture';
  root.dataset.devSpacingPath = JSON.stringify(['sections', 1, 'spacing']);
  const list = document.createElement('dl');
  root.append(list);
  const add = document.createElement('button');
  add.dataset.projectDetailsAdd = '';
  root.append(add);
  const makeRow = (label: string, value: string) => {
    const row = document.createElement('div');
    row.dataset.projectDetailsRow = '';
    for (const [name, text] of [['label', label], ['value', value]]) {
      const field = document.createElement(name === 'label' ? 'dt' : 'dd');
      field.dataset[`projectDetails${name[0].toUpperCase()}${name.slice(1)}`] = '';
      field.dataset.devTextPath = JSON.stringify(['sections', 1, 'rows', 0, name]);
      field.textContent = text;
      row.append(field);
    }
    const remove = document.createElement('button');
    remove.dataset.projectDetailsRemove = '';
    row.append(remove);
    return row;
  };
  list.append(makeRow('Role <x>', 'Design & Build'));
  document.body.append(root);

  const textStates: Harness['textStates'] = [...root.querySelectorAll<HTMLElement>('[data-dev-text-path]')].map((element) => ({
    element, path: JSON.parse(element.dataset.devTextPath!), savedValue: element.textContent ?? '',
  }));
  const pending = new Map<string, any>();
  const history: Harness['history'] = [];
  const editorSignal = new AbortController().signal;
  const pageHistory = {
    busy: false,
    breakGroup() {},
    push(entry: { undo: () => void; redo: () => void }) { history.push(entry); },
  };
  const registerTextStates = (element: HTMLElement) => {
    element.querySelectorAll<HTMLElement>('[data-dev-text-path]').forEach((field) => {
      if (!textStates.some((state) => state.element === field)) {
        textStates.push({ element: field, path: JSON.parse(field.dataset.devTextPath!), savedValue: field.textContent ?? '' });
      }
    });
  };
  const detachSectionStates = (element: HTMLElement) => {
    for (let index = textStates.length - 1; index >= 0; index -= 1) {
      if (element.contains(textStates[index].element)) textStates.splice(index, 1);
    }
  };
  const renderValue = (state: { element: HTMLElement }, value: string) => { state.element.textContent = value; };
  const updateActions = () => {};
  const captureFieldHistory = () => {};
  const cleanText = (value: string) => value.replaceAll('\u00a0', ' ');
  const isDevContentEditing = () => true;
  const actionsBusy = false;
  const syncIntroRunControls = () => {};
  Object.assign(globalThis, {
    document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    CustomEvent: dom.CustomEvent,
    crypto: { randomUUID },
  });
  const writes: any[] = [];
  const fetch = async (_url: string, options: any) => { writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; };
  const readApiJson = (response: any) => response.json();
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(detailsCode + '\nreturn persistDetailsRows;');
  const run = new Function(
    'document', 'textStates', 'pendingMedia', 'editorSignal', 'pageHistory', 'registerTextStates',
    'detachSectionStates', 'renderValue', 'updateActions', 'captureFieldHistory', 'cleanText',
    'isDevContentEditing', 'actionsBusy', 'syncIntroRunControls', 'fetch', 'readApiJson', 'pageScope', 'sectionEditTarget', compiled,
  );
  const persist = run(document, textStates, pending, editorSignal, pageHistory, registerTextStates, detachSectionStates, renderValue, updateActions, captureFieldHistory, cleanText, isDevContentEditing, actionsBusy, syncIntroRunControls, fetch, readApiJson, { frame: (callback: () => void) => callback() }, sectionEditTarget);
  return { dom, root, textStates, pending, history, persist, writes, click(selector) {
    const target = root.querySelector<HTMLElement>(selector)!;
    target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  } };
}

test('details row add and remove preserve values and undo/redo state references', () => {
  const h = harness();
  h.click('[data-project-details-add]');
  assert.equal(h.root.querySelectorAll('[data-project-details-row]').length, 2);
  assert.equal(h.root.querySelector('[data-project-details-row] dt')?.textContent, 'Role <x>');
  assert.deepEqual(JSON.parse(h.root.querySelectorAll('[data-project-details-row]')[1].querySelector('[data-project-details-label]')!.dataset.devTextPath!), ['sections', 1, 'rows', 1, 'label']);
  const addedField = h.textStates.at(-2)!.element;
  h.history.at(-1)!.undo();
  assert.equal(h.root.querySelectorAll('[data-project-details-row]').length, 1);
  h.history.at(-1)!.redo();
  assert.ok(h.textStates.some((state) => state.element === addedField));
  h.click('[data-project-details-row] [data-project-details-remove]');
  h.history.at(-1)!.undo();
  assert.equal(h.root.querySelectorAll('[data-project-details-row]').length, 2);
});

test('pending prepare resolves the live section index after reorder and escapes markup through datasets', () => {
  const h = harness();
  h.click('[data-project-details-add]');
  const change = [...h.pending.values()][0];
  h.root.dataset.devSpacingPath = JSON.stringify(['sections', 7, 'spacing']);
  assert.equal(change.prepare().index, 7);
  assert.deepEqual(change.prepare().rows[0], { label: 'Role <x>', value: 'Design & Build' });
  assert.equal(h.root.querySelector('[data-project-details-row] dt')?.dataset.devTextPath, JSON.stringify(['sections', 1, 'rows', 0, 'label']));
});


test('saved row changes can be undone and saved again; deleted blocks are not written', async () => {
  const h = harness();
  h.click('[data-project-details-add]');
  let change = [...h.pending.values()][0];
  await h.persist(change);
  h.pending.clear();
  h.history.at(-1)!.undo();
  change = [...h.pending.values()][0];
  assert.equal(change.prepare().rows.length, 1);
  await h.persist(change);
  assert.equal(h.writes.at(-1).rows.length, 1);
  h.root.remove();
  const count = h.writes.length;
  await h.persist(change);
  assert.equal(h.writes.length, count);
});

test('revert restores the saved rows and values without replacing unrelated content', () => {
  const h = harness();
  const neighbour = h.dom.document.createElement('p');
  neighbour.textContent = 'Other unsaved text';
  h.dom.document.body.append(neighbour);
  h.click('[data-project-details-add]');
  h.root.querySelector('dt')!.textContent = 'Changed';
  [...h.pending.values()][0].revert();
  assert.equal(h.root.querySelectorAll('[data-project-details-row]').length, 1);
  assert.equal(h.root.querySelector('dt')!.textContent, 'Role <x>');
  assert.equal(neighbour.textContent, 'Other unsaved text');
});
