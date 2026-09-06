import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeOutline } from '../../src/lib/projectOutline.ts';
import { validateProjectOutline } from '../dev-api-plugins.mjs';

test('outline validation accepts an explicit empty outline', () => {
  assert.equal(validateProjectOutline([]), true);
});

test('outline validation rejects malformed and duplicate identities', () => {
  assert.equal(validateProjectOutline([{ kind: 'section', id: 'a', label: 'A' }, { kind: 'section', id: 'a', label: 'Again' }]), false);
  assert.equal(validateProjectOutline([{ kind: 'section', id: 'a', label: 'A' }, { kind: 'section', id: '', label: 'Missing id' }]), false);
});

test('outline normalization preserves supplied ids and anchors while migrating legacy kinds', () => {
  assert.deepEqual(normalizeOutline([
    { kind: 'subsection', id: 'custom-id', label: 'Custom', anchor: 'block-id' },
    { kind: 'section', id: 'legacy-group', label: 'Legacy', defaultOpen: false, anchor: 'first' },
  ]), [
    { kind: 'section', id: 'custom-id', label: 'Custom', anchor: 'block-id' },
    { kind: 'group', id: 'legacy-group', label: 'Legacy', defaultOpen: false, anchor: 'first' },
  ]);
});
