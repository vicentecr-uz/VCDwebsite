import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { devEditPendingId, editsRemovedMedia, sectionEditTarget, withDevEditTarget } from '../../src/scripts/devEditTarget';
import { applyCropChange } from '../../astro.config.mjs';

const originalDocument = globalThis.document;
afterEach(() => { globalThis.document = originalDocument; });

function setup() {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  document.body.innerHTML = `<section data-dev-content-id="section-a" data-dev-spacing-document="knife" data-dev-spacing-path='["sections",2,"spacing"]'>
    <figure data-dev-document="knife" data-grid-item-id="image-a" data-dev-image-path='["sections",2,"items",0]'><span>Caption</span></figure>
    <figure data-dev-document="knife" data-grid-item-id="image-b" data-dev-image-path='["sections",2,"items",1]'></figure>
  </section>
  <section data-dev-content-id="other-section" data-dev-spacing-document="other" data-dev-spacing-path='["sections",2,"spacing"]'></section>`;
  return {
    root: document.querySelector<HTMLElement>('section')!,
    item: document.querySelector<HTMLElement>('figure')!,
  };
}

test('queued media captures canonical section and item IDs without mutating the caller', () => {
  setup();
  const change: Record<string, unknown> = { document: 'knife', path: ['sections', 2, 'items', 1] };
  const queued = withDevEditTarget(change);
  expect(queued.target).toEqual({ sectionId: 'section-a', itemId: 'image-b' });
  expect(change.target).toBeUndefined();
});

test('captured identity survives section and item moves', () => {
  const { root, item } = setup();
  const queued = withDevEditTarget<Record<string, unknown>>({ document: 'knife', path: ['sections', 2, 'items', 0] }, item);
  root.dataset.devSpacingPath = '["sections",0,"spacing"]';
  item.dataset.devImagePath = '["sections",0,"items",1]';
  expect(withDevEditTarget(queued).target).toEqual({ sectionId: 'section-a', itemId: 'image-a' });
  expect(withDevEditTarget<Record<string, unknown>>({ document: 'knife', path: ['sections', 2, 'items', 0] }, item).target)
    .toEqual({ sectionId: 'section-a', itemId: 'image-a' });
});

test('editing the same image again after moving it replaces the same pending entry', () => {
  const { root, item } = setup();
  const key = devEditPendingId('crop', item);
  root.dataset.devSpacingPath = '["sections",0,"spacing"]';
  item.dataset.devImagePath = '["sections",0,"items",1]';
  expect(devEditPendingId('crop', item)).toBe(key);
  expect(devEditPendingId('caption', item)).not.toBe(key);
});

test('an edit captured in the browser saves to the same image after server-side reordering', () => {
  const { item } = setup();
  const queued = withDevEditTarget({
    document: 'knife', path: ['sections', 2, 'items', 0], src: 'replacement.jpg',
  }, item);
  const intended = { id: 'image-a', src: 'original.jpg' };
  const neighbour = { id: 'image-b', src: 'neighbour.jpg' };
  const data = { sections: [{ id: 'section-a', items: [neighbour, intended] }] };
  expect(applyCropChange(data, queued)).toEqual({ ok: true });
  expect(intended.src).toBe('replacement.jpg');
  expect(neighbour.src).toBe('neighbour.jpg');
  data.sections[0].items.pop();
  expect(applyCropChange(data, queued).ok).toBe(false);
  expect(neighbour.src).toBe('neighbour.jpg');
});

test('text and spacing identify their containing section, scoped to the document', () => {
  const { root } = setup();
  expect(withDevEditTarget<Record<string, unknown>>({ document: 'knife', path: ['sections', 2, 'spacing'] }, root).target)
    .toEqual({ sectionId: 'section-a' });
  expect(withDevEditTarget<Record<string, unknown>>({ document: 'other', path: ['sections', 2, 'title'] }).target)
    .toEqual({ sectionId: 'other-section' });
});

test('nonsection settings and legacy roots keep their existing payload', () => {
  setup();
  const documentSetting = { document: 'knife', path: ['introHeight'], value: 75 };
  const legacy = { document: 'legacy', path: ['sections', 2, 'title'], value: 'Title' };
  expect(withDevEditTarget(documentSetting)).toBe(documentSetting);
  expect(withDevEditTarget(legacy)).toBe(legacy);
});

test('removing an image supersedes its queued edits but preserves its neighbours', () => {
  const { item } = setup();
  const edit = withDevEditTarget({ document: 'knife', path: ['sections', 2, 'items', 0] }, item);
  const removal = { document: 'knife', target: { sectionId: 'section-a' }, itemId: 'image-a' };
  expect(editsRemovedMedia(edit, removal)).toBe(true);
  expect(editsRemovedMedia(edit, { ...removal, itemId: 'image-b' })).toBe(false);
  expect(editsRemovedMedia(edit, { ...removal, document: 'other' })).toBe(false);
  expect(editsRemovedMedia(edit, { ...removal, target: { sectionId: 'section-b' } })).toBe(false);
});

test('a deleted section retains its canonical target while detached for undo', () => {
  const { root } = setup();
  root.id = 'outline-label';
  root.remove();
  expect(sectionEditTarget(root)).toEqual({ sectionId: 'section-a' });
});
