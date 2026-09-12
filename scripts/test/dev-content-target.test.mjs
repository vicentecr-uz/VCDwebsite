import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContentTarget } from '../../src/lib/devContentTarget.mjs';

const document = () => ({
  title: 'Example',
  sections: [
    { id: 'first', type: 'bodyText', paragraphs: ['one'] },
    { id: 'gallery', type: 'imageGrid', items: [
      { id: 'a', src: 'a.jpg' },
      { id: 'b', src: 'b.jpg' },
    ] },
  ],
});

test('resolves a section after insertion or reorder', () => {
  const data = document();
  assert.throws(() => resolveContentTarget(data, ['sections', 0], null), /Invalid content target/);
  data.sections.unshift({ id: 'new', type: 'bodyText' });
  data.sections.reverse();
  assert.deepEqual(resolveContentTarget(data, ['sections', 1, 'paragraphs'], { sectionId: 'first' }), ['sections', 1, 'paragraphs']);
  assert.deepEqual(resolveContentTarget(data, ['sections', 0, 'items', 1, 'src'], { sectionId: 'gallery', itemId: 'b' }), ['sections', 0, 'items', 1, 'src']);
});

test('resolves a nested item after item reorder', () => {
  const data = document();
  data.sections[1].items.reverse();
  assert.deepEqual(resolveContentTarget(data, ['sections', 1, 'items', 0, 'src'], { sectionId: 'gallery', itemId: 'a' }), ['sections', 1, 'items', 1, 'src']);
});

test('deleted or duplicated IDs fail without numeric fallback', () => {
  const deleted = document();
  deleted.sections.splice(1, 1);
  assert.throws(() => resolveContentTarget(deleted, ['sections', 1, 'items', 0, 'src'], { sectionId: 'gallery', itemId: 'a' }), /section was deleted/);

  const duplicate = document();
  duplicate.sections.push({ id: 'gallery', items: [] });
  assert.throws(() => resolveContentTarget(duplicate, ['sections', 1], { sectionId: 'gallery' }), /section ID is duplicated/);

  const duplicateItem = document();
  duplicateItem.sections[1].items.push({ id: 'a' });
  assert.throws(() => resolveContentTarget(duplicateItem, ['sections', 1, 'items', 0], { sectionId: 'gallery', itemId: 'a' }), /item ID is duplicated/);
});

test('rejects malformed stable targets and paths', () => {
  const data = document();
  assert.throws(() => resolveContentTarget(data, ['sections', -1], { sectionId: 'first' }), /Invalid content path/);
  assert.throws(() => resolveContentTarget(data, ['sections', 0], { sectionId: 'first', itemId: 'a' }), /Item IDs require/);
  assert.throws(() => resolveContentTarget(data, ['sections', 1, 'items', 0], { sectionId: 'gallery' }), /item ID is required/);
  assert.throws(() => resolveContentTarget(data, ['sections', 1, 'items', 0], { sectionId: 'gallery', itemId: 'a', extra: true }), /Invalid content target/);
  for (const itemId of [null, '', 1]) {
    assert.throws(() => resolveContentTarget(data, ['sections', 0, 'items', 0], { sectionId: 'first', itemId }), /Item IDs require/);
  }
});

test('retains positional handling for legacy paths', () => {
  const data = document();
  assert.deepEqual(resolveContentTarget(data, [], undefined), []);
  assert.deepEqual(resolveContentTarget(data, ['title']), ['title']);
  assert.deepEqual(resolveContentTarget(data, ['sections', 1, 'items', 0, 'src']), ['sections', 1, 'items', 0, 'src']);
});

test('keeps nonmedia item suffixes positional after section ID resolution', () => {
  const data = document();
  data.sections.push({ id: 'details', type: 'projectDetails', items: [{ value: 'one' }, { value: 'two' }] });
  data.sections.reverse();
  assert.deepEqual(resolveContentTarget(data, ['sections', 0, 'items', 1, 'value'], { sectionId: 'details' }), ['sections', 0, 'items', 1, 'value']);
});
