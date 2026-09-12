import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createHistory } from '../../src/lib/devHistory';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const between = (a: string, b: string) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync([
  between('    const bumpSectionPath =', '    const remapPathsInStates ='),
  between('    const reindexDevPaths =', '    /** Text entry proper'),
  between('    const detachSectionStates =', '    const revertPendingBlockConverts ='),
  between('    const persistPendingSectionInserts =', '    const persistPendingBlockConverts ='),
  'let deleteSectionAt;',
  between('    const undoSectionDelete =', '    const blockParagraphs ='),
  'return { deleteSectionAt, persistPendingSectionDeletes, persistPendingSectionInserts };',
].join('\n'));

function setup() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main data-doc="home-intro"></main><main data-doc="home"></main>';
  const zone = document.querySelector('main')!;
  const blocks = ['First', 'Second', 'Third'].map((text, index) => {
    const root = document.createElement('section');
    root.id = `block-${index}`;
    root.dataset.devSpacingDocument = 'home-intro';
    root.dataset.devSpacingPath = JSON.stringify(['sections', index, 'spacing']);
    root.dataset.devSpacingValue = 'section';
    root.dataset.devSectionDeletable = 'bodyText';
    root.innerHTML = `<div data-dev-text-document="home-intro" data-dev-text-path='["sections",${index},"paragraphs"]'><p>${text}</p></div>`;
    zone.append(root);
    return root;
  });
  const textStates = blocks.map((root, index) => ({ element: root.firstElementChild, document: 'home-intro', path: ['sections', index, 'paragraphs'], savedValue: [root.textContent] }));
  const spacingStates = blocks.map((element, index) => ({ element, document: 'home-intro', path: ['sections', index, 'spacing'] }));
  const pageHistory = createHistory();
  const requests: any[] = [];
  let token = 0;
  const env: any = {
    window, document, Node: window.Node, HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    detailsBaselines: new Map(), stageProjectDetailsRows() {},
    actionsBusy: false, savedFormatRange: null, pageHistory, textStates, spacingStates,
    pendingSectionDeletes: [], pendingSectionInserts: [], persistedMediaInserts: [], pendingBlockConverts: [],
    pendingMedia: new Map(),
    deletableSections: [...blocks], serverSectionIds: new Map(),
    DEV_PATH_ATTRS: ['data-dev-spacing-path', 'data-dev-text-path'],
    getDropZone: (key: string) => document.querySelector(`[data-doc="${key}"]`),
    shiftSectionOrderIds() {}, syncPageTopSpacingControls() {}, syncDevModeOnSection() {}, mountDeleteButton() {},
    hideFormatBar() {}, syncSpacingCaretSuppression() {}, closeSectionMenus() {}, captureFieldHistory() {}, updateActions() {},
    getDevSectionOutline: () => [], outlineAnchorId: (entry: any) => entry.anchor,
    remapDevSectionOutlineId() {},
    findInsertAnchor: (index: number, key: string) => [...env.getDropZone(key).children].find((root: any) => JSON.parse(root.dataset.devSpacingPath)[1] >= index),
    fetch: async (_url: string, options: any) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => body.action === 'delete' ? { restoreToken: `receipt-${++token}` } : { section: { id: blocks[1].id } } };
    },
  };
  return { ...new Function('env', `with(env) { ${script} }`)(env), env, blocks, zone, textStates, pageHistory, requests };
}

test('trash deletion is an undoable command and redo deletes the same block repeatedly', async () => {
  const { deleteSectionAt, blocks, zone, textStates, pageHistory, env, requests } = setup();
  const secondText = textStates[1];
  await deleteSectionAt(blocks[1]);
  expect([...zone.children]).toEqual([blocks[0], blocks[2]]);
  expect(env.pendingSectionDeletes).toHaveLength(1);
  expect(pageHistory.canUndo).toBe(true);
  await pageHistory.undo();
  expect([...zone.children]).toEqual(blocks);
  expect(env.pendingSectionDeletes).toHaveLength(0);
  expect(env.textStates).toContain(secondText);
  expect(blocks[2].dataset.devSpacingPath).toBe('["sections",2,"spacing"]');
  await pageHistory.redo();
  expect([...zone.children]).toEqual([blocks[0], blocks[2]]);
  await pageHistory.undo();
  expect([...zone.children]).toEqual(blocks);
  expect(env.textStates).toHaveLength(3);
  expect(env.spacingStates).toHaveLength(3);
  expect(requests).toHaveLength(0);
});

test('deleting a section stashes its queued media edit and restores it on undo', async () => {
  const { deleteSectionAt, blocks, pageHistory, env } = setup();
  const pending = {
    id: 'grid:home-intro:1', kind: 'grid',
    payload: { document: 'home-intro', path: ['sections', 1, 'images', 0] },
    revert: () => {},
  };
  env.pendingMedia.set(pending.id, pending);

  await deleteSectionAt(blocks[1]);
  expect(env.pendingMedia.size).toBe(0);
  expect(env.pendingSectionDeletes[0].pendingMedia).toEqual([pending]);
  await pageHistory.undo();
  expect(env.pendingMedia.get(pending.id)?.payload.path).toEqual(['sections', 1, 'images', 0]);
});

test('deleting an unsaved new block restores its insertion queue, content and conversion state', async () => {
  const { deleteSectionAt, blocks, pageHistory, env } = setup();
  const insert = { root: blocks[1], index: 1, type: 'bodyText', documentKey: 'home-intro' };
  const conversion = { root: blocks[1], documentKey: 'home-intro', previousRoot: blocks[1], previousPath: ['sections', 1], index: 1 };
  env.pendingSectionInserts.push(insert);
  env.pendingBlockConverts.push(conversion);
  await deleteSectionAt(blocks[1]);
  expect(env.pendingSectionInserts).toHaveLength(0);
  expect(env.pendingSectionDeletes).toHaveLength(0);
  await pageHistory.undo();
  expect(env.pendingSectionInserts).toEqual([insert]);
  expect(env.pendingBlockConverts).toEqual([conversion]);
  expect(blocks[1].textContent).toBe('Second');
  await pageHistory.redo();
  expect(env.pendingSectionInserts).toHaveLength(0);
  expect(env.pendingSectionDeletes).toHaveLength(0);
});

test('undo after Save queues exact restoration; redo remains undoable after another Save', async () => {
  const { deleteSectionAt, persistPendingSectionDeletes, persistPendingSectionInserts, blocks, pageHistory, env, requests } = setup();
  await deleteSectionAt(blocks[1]);
  await persistPendingSectionDeletes();
  await pageHistory.undo();
  expect(requests).toHaveLength(1);
  expect(env.pendingSectionInserts[0].restoreToken).toBe('receipt-1');
  await persistPendingSectionInserts();
  expect(requests[1]).toMatchObject({ action: 'restore', restoreToken: 'receipt-1', document: 'home-intro', index: 1 });
  await pageHistory.redo();
  await persistPendingSectionDeletes();
  await pageHistory.undo();
  expect(env.pendingSectionInserts[0].restoreToken).toBe('receipt-2');
});

test('deletion stays separate from an earlier text command', async () => {
  const { deleteSectionAt, blocks, pageHistory } = setup();
  let text = 'changed';
  pageHistory.push({ label: 'Typing', undo: () => { text = 'original'; }, redo: () => { text = 'changed'; } });
  await deleteSectionAt(blocks[1]);
  await pageHistory.undo();
  expect(text).toBe('changed');
  expect(blocks[1].isConnected).toBe(true);
  await pageHistory.undo();
  expect(text).toBe('original');
  await pageHistory.redo();
  await pageHistory.redo();
  expect(text).toBe('changed');
  expect(blocks[1].isConnected).toBe(false);
});
