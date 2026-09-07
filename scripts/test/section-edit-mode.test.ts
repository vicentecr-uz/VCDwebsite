import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isDevContentEditing, syncDevModeOnSection } from '../../src/scripts/devSectionMount';
import { DEV_PATH_ATTRS, remapSectionPaths } from '../../src/scripts/devSectionPaths';

const originalDocument = globalThis.document;
afterEach(() => { globalThis.document = originalDocument; });

class MockElement {
  private attributes = new Map<string, string>();
  constructor(attributes: Record<string, string>) {
    Object.entries(attributes).forEach(([name, value]) => this.attributes.set(name, value));
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}

test('section mode suspends mounted content controls and restores them on return to Edit', () => {
  const classes = new Set(['is-dev-mode']);
  globalThis.document = { documentElement: { classList: { contains: (name: string) => classes.has(name) } } } as unknown as Document;
  const control = { hidden: false };
  const trigger = { disabled: false };
  const block = { querySelectorAll: (selector: string) => selector === '[data-dev-mode-only]' ? [control] : [trigger] } as unknown as HTMLElement;

  expect(isDevContentEditing()).toBe(true);
  classes.add('show-section-nav-editor');
  syncDevModeOnSection(block, true);
  expect(isDevContentEditing()).toBe(false);
  expect(control.hidden).toBe(true);
  expect(trigger.disabled).toBe(true);

  classes.delete('show-section-nav-editor');
  syncDevModeOnSection(block, true);
  expect(isDevContentEditing()).toBe(true);
  expect(control.hidden).toBe(false);
  expect(trigger.disabled).toBe(false);

  classes.delete('is-dev-mode');
  syncDevModeOnSection(block, false);
  expect(isDevContentEditing()).toBe(false);
  expect(control.hidden).toBe(true);
  expect(trigger.disabled).toBe(true);
});

test('section reorder remaps carousel paths with the shared path list', () => {
  const spacing = new MockElement({ 'data-dev-spacing-path': JSON.stringify(['sections', 1, 'spacing']) });
  const carousel = new MockElement({ 'data-dev-carousel-path': JSON.stringify(['sections', 1]) });
  const unrelated = new MockElement({ 'data-dev-other-path': JSON.stringify(['sections', 1, 'other']) });
  globalThis.document = { querySelectorAll: () => [spacing, carousel, unrelated] } as unknown as Document;

  remapSectionPaths({ 0: 2, 1: 0 });

  expect(JSON.parse(spacing.getAttribute('data-dev-spacing-path')!)).toEqual(['sections', 0, 'spacing']);
  expect(JSON.parse(carousel.getAttribute('data-dev-carousel-path')!)).toEqual(['sections', 0]);
  expect(JSON.parse(unrelated.getAttribute('data-dev-other-path')!)).toEqual(['sections', 1, 'other']);
});

const editorSource = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const bumpStart = editorSource.indexOf('    const bumpSectionPath = (');
const bumpEnd = editorSource.indexOf('    const bumpPathAttrsOnElement =', bumpStart);
if (bumpStart < 0 || bumpEnd < 0) throw new Error('Could not extract section path reindexing helpers');
const reindexSource = new Bun.Transpiler({ loader: 'ts' }).transformSync(editorSource.slice(bumpStart, bumpEnd));

test('section insertion and deletion keep carousel paths aligned with other section paths', () => {
  const spacing = new MockElement({ 'data-dev-spacing-path': JSON.stringify(['sections', 1, 'spacing']) });
  const carousel = new MockElement({ 'data-dev-carousel-path': JSON.stringify(['sections', 1]) });
  const env = {
    DEV_PATH_ATTRS,
    document: { querySelectorAll: () => [spacing, carousel] },
    shiftSectionOrderIds: () => {},
    textStates: [],
    spacingStates: [],
    pendingBlockConverts: [],
  };
  const reindexDevPaths = new Function('env', `with (env) { ${reindexSource}; return reindexDevPaths; }`)(env) as (fromIndex: number, delta: number) => void;

  reindexDevPaths(1, 1);
  expect(JSON.parse(spacing.getAttribute('data-dev-spacing-path')!)[1]).toBe(2);
  expect(JSON.parse(carousel.getAttribute('data-dev-carousel-path')!)[1]).toBe(2);
  reindexDevPaths(1, -1);
  expect(JSON.parse(spacing.getAttribute('data-dev-spacing-path')!)[1]).toBe(1);
  expect(JSON.parse(carousel.getAttribute('data-dev-carousel-path')!)[1]).toBe(1);
});
