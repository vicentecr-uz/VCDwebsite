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
  const template = document.createElement('template');
  template.dataset.projectDetailsMenuTemplate = '';
  template.innerHTML = '<div class="dev-menu" popover="manual" role="menu"><button data-details-row-action="up">Move up</button><button data-details-row-action="down">Move down</button><button data-details-row-action="remove">Remove row</button></div>';
  document.body.append(template);
  const matches = dom.HTMLElement.prototype.matches;
  dom.HTMLElement.prototype.matches = function(selector: string) { return selector === ':popover-open' ? this.dataset.open === 'true' : matches.call(this, selector); };
  dom.HTMLElement.prototype.showPopover = function() { this.dataset.open = 'true'; };
  dom.HTMLElement.prototype.hidePopover = function() { delete this.dataset.open; };

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
    remove.dataset.projectDetailsActions = '';
    remove.className = 'dev-btn dev-btn--ghost project-details__actions';
    remove.setAttribute('aria-haspopup', 'menu');
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
    'window', 'placeBeside', 'document', 'textStates', 'pendingMedia', 'editorSignal', 'pageHistory', 'registerTextStates',
    'detachSectionStates', 'renderValue', 'updateActions', 'captureFieldHistory', 'cleanText',
    'isDevContentEditing', 'actionsBusy', 'syncIntroRunControls', 'fetch', 'readApiJson', 'pageScope', 'sectionEditTarget', compiled,
  );
  const persist = run(dom, () => {}, document, textStates, pending, editorSignal, pageHistory, registerTextStates, detachSectionStates, renderValue, updateActions, captureFieldHistory, cleanText, isDevContentEditing, actionsBusy, syncIntroRunControls, fetch, readApiJson, { frame: (callback: () => void) => callback(), add() {}, listen(target: EventTarget, event: string, listener: EventListener, options?: AddEventListenerOptions) { target.addEventListener(event, listener, options); } }, sectionEditTarget);
  return { dom, root, textStates, pending, history, persist, writes, click(selector) {
    const target = document.querySelector<HTMLElement>(selector)!;
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
  h.click('[data-project-details-row] [data-project-details-actions]');
  h.click('[data-details-row-action=remove]');
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


test('row menu moves edited fields and reindexes paths, with undo and redo', () => {
  const h = harness();
  h.click('[data-project-details-add]');
  const rows = [...h.root.querySelectorAll<HTMLElement>('[data-project-details-row]')];
  rows[1].querySelector('dt')!.textContent = 'Edited label';
  rows[1].querySelector('dd')!.textContent = 'Edited value';
  h.click('[data-project-details-row]:nth-child(2) [data-project-details-actions]');
  h.click('[data-details-row-action=up]');
  assert.equal(h.root.querySelector('dt')?.textContent, 'Edited label');
  assert.deepEqual(h.textStates.find((field) => field.element === rows[1].querySelector('dt'))?.path, ['sections', 1, 'rows', 0, 'label']);
  h.history.at(-1)!.undo();
  assert.equal(h.root.querySelector('dt')?.textContent, 'Role <x>');
  h.history.at(-1)!.redo();
  assert.equal(h.root.querySelector('dd')?.textContent, 'Edited value');
  h.click('[data-project-details-row]:first-child [data-project-details-actions]');
  h.click('[data-details-row-action=down]');
  assert.equal(h.root.querySelector('dt')?.textContent, 'Role <x>');
});

test('row menu guards boundaries and last row, and newly created controls match', () => {
  const h = harness();
  h.click('[data-project-details-actions]');
  for (const action of ['up', 'down', 'remove']) {
    assert.equal(h.dom.document.querySelector<HTMLButtonElement>(`[data-details-row-action=${action}]`)?.disabled, true);
    h.click(`[data-details-row-action=${action}]`);
  }
  assert.equal(h.history.length, 0);
  h.click('[data-project-details-add]');
  const buttons = [...h.root.querySelectorAll('[data-project-details-actions]')];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].className, buttons[1].className);
  assert.equal(buttons[1].getAttribute('aria-haspopup'), 'menu');
  assert.match(buttons[1].getAttribute('aria-label')!, /^Row actions for Detail$/);
});

test('reordered pending rows use the moved section target and revert restores baseline order', () => {
  const h = harness();
  h.click('[data-project-details-add]');
  h.root.querySelectorAll('dt')[1].textContent = 'Second';
  h.click('[data-project-details-row]:first-child [data-project-details-actions]');
  h.click('[data-details-row-action=down]');
  h.root.dataset.devSpacingPath = JSON.stringify(['sections', 9, 'spacing']);
  const change = [...h.pending.values()][0];
  assert.equal(change.prepare().index, 9);
  assert.deepEqual(change.prepare().rows.map((row: {label: string}) => row.label), ['Second', 'Role <x>']);
  change.revert();
  assert.equal(h.root.querySelectorAll('[data-project-details-row]').length, 1);
  assert.equal(h.root.querySelector('dt')?.textContent, 'Role <x>');
});

test('client Divider insertion registers no text state, emits divider metadata and reverts cleanly', () => {
  const dom = new Window(); const document = dom.document;
  document.body.innerHTML = '<template data-divider-template><section class="project-block project-divider" data-dev-section-deletable="divider"><hr></section></template><section data-anchor data-dev-spacing-document="fixture" data-dev-spacing-path=\'["sections",2,"spacing"]\'></section>';
  const anchor = document.querySelector<HTMLElement>('[data-anchor]')!;
  const inserts: any[] = [], textStates: any[] = [], spacingStates: any[] = [], deletableSections: any[] = [], events: any[] = [];
  const start = source.indexOf('    const insertSectionAt =');
  const end = source.indexOf('    splitBlockAtCaret =', start);
  const revertStart = source.indexOf('    const revertPendingSectionInserts =');
  const revertEnd = source.indexOf('    const revertPendingSectionDeletes =', revertStart);
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end) + source.slice(revertStart, revertEnd) + '\nreturn { insertSectionAt, revertPendingSectionInserts };');
  const environment = {
    document, HTMLElement: dom.HTMLElement, CustomEvent: dom.CustomEvent,
    window: { dispatchEvent(event: CustomEvent) { events.push(event.detail); } },
    spacingStates, textStates, deletableSections, pendingSectionInserts: inserts,
    closeSectionMenus() {}, reindexDevPaths() {}, projectStackClassName: (spacing: string) => `project-stack--${spacing}`,
    resolveProjectStackSpacing: (spacing: string) => ({ desktop: spacing, tablet: spacing, mobile: spacing }),
    buildInsertedSection() { throw new Error('Divider must not become a text block'); },
    mountSpacingControl: (element: HTMLElement) => ({ element }), wireSectionAddMenu() {},
    registerTextStates() { throw new Error('Divider must not register editable text'); },
    bindTextState() { throw new Error('Divider must not bind editable text'); },
    isDevContentEditing: () => true, mountDeleteButton() {}, syncPageTopSpacingControls() {}, updateActions() {},
    pageScope: { frame(callback: () => void) { callback(); } },
  };
  const commands = new Function('env', `with (env) { ${script} }`)(environment);
  const built = commands.insertSectionAt(anchor, 'divider');
  assert.equal(built.textElement, null);
  assert.equal(built.root.getAttribute('contenteditable'), null);
  assert.equal(built.root.tabIndex, -1);
  assert.equal(built.root.getAttribute('aria-label'), 'Divider');
  assert.equal(built.root.dataset.devSectionDeletable, 'divider');
  assert.deepEqual(JSON.parse(built.root.dataset.devSpacingPath), ['sections', 2, 'spacing']);
  assert.equal(built.root.nextElementSibling, anchor);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].textStates, []);
  assert.match(inserts[0].sectionId, /^divider-/);
  assert.equal(textStates.length, 0);
  assert.equal(events[0].section.type, 'divider');
  assert.equal('title' in events[0].section, false);
  commands.revertPendingSectionInserts();
  assert.equal(inserts.length, 0);
  assert.equal(built.root.isConnected, false);
  assert.equal(anchor.isConnected, true);
  assert.equal(deletableSections.length, 0);
  assert.equal(spacingStates.length, 0);
});


test('row menu keyboard navigation returns focus on Escape and closes on Edit exit', () => {
  const h = harness();
  h.click('[data-project-details-add]');
  const trigger = h.root.querySelector<HTMLButtonElement>('[data-project-details-actions]')!;
  h.click('[data-project-details-actions]');
  const menu = h.dom.document.querySelector<HTMLElement>('[role=menu]')!;
  assert.equal(menu.dataset.open, 'true');
  h.dom.document.dispatchEvent(new h.dom.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(h.dom.document.activeElement?.textContent, 'Remove row');
  const escape = new h.dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  h.dom.document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(menu.dataset.open, undefined);
  assert.equal(h.dom.document.activeElement, trigger);
  h.click('[data-project-details-actions]');
  h.dom.dispatchEvent(new h.dom.CustomEvent('vcd:dev-mode-change', { detail: { active: false } }));
  assert.equal(menu.dataset.open, undefined);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});
