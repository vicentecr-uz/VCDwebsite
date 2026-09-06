import { afterEach, expect, test } from 'bun:test';
import { getDevSectionOutline, remapDevSectionOutlineId, setDevSectionOutline } from '../../src/scripts/devSectionOutlineSync';

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;
afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.HTMLElement = originalHTMLElement;
});

test('server anchor remapping preserves both marker identities and unrelated targets', () => {
  globalThis.HTMLElement = class {} as typeof HTMLElement;
  globalThis.document = { getElementById: () => null, querySelector: () => null } as unknown as Document;
  setDevSectionOutline([
    { kind: 'group', id: 'stable-group', label: 'Research', anchor: 'client-anchor' },
    { kind: 'section', id: 'stable-section', label: 'Research', anchor: 'client-anchor' },
    { kind: 'section', id: 'client-anchor', label: 'Independent', anchor: 'other-block' },
  ]);
  remapDevSectionOutlineId('client-anchor', 'server-anchor');
  expect(getDevSectionOutline()).toEqual([
    { kind: 'group', id: 'stable-group', label: 'Research', anchor: 'server-anchor' },
    { kind: 'section', id: 'stable-section', label: 'Research', anchor: 'server-anchor' },
    { kind: 'section', id: 'client-anchor', label: 'Independent', anchor: 'other-block' },
  ]);
});

test('legacy markers gain explicit target anchors without changing identity', () => {
  globalThis.HTMLElement = class {} as typeof HTMLElement;
  globalThis.document = { getElementById: () => null, querySelector: () => null } as unknown as Document;
  setDevSectionOutline([{ kind: 'section', id: 'client-anchor', label: 'Overview' }]);
  remapDevSectionOutlineId('client-anchor', 'server-anchor');
  expect(getDevSectionOutline()).toEqual([{ kind: 'section', id: 'client-anchor', label: 'Overview', anchor: 'server-anchor' }]);
});
