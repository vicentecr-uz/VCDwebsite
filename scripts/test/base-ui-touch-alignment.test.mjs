import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  new URL('../../node_modules/@base-ui/react/select/positioner/SelectPositioner.js', import.meta.url),
  new URL('../../node_modules/@base-ui/react/select/positioner/SelectPositioner.mjs', import.meta.url),
];

test('patched Base UI keeps selected-item alignment on touch while retaining touch scroll locking', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /const alignItemWithTriggerActive = mounted && controlledAlignItemWithTrigger;/, file.pathname);
    assert.doesNotMatch(source, /controlledAlignItemWithTrigger && openMethod !== 'touch'/, file.pathname);
    assert.match(source, /alignItemWithTriggerActive \|\| modal/ , file.pathname);
    assert.match(source, /openMethod === 'touch'/, file.pathname);
  }
});
