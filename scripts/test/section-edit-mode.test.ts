import { afterEach, expect, test } from 'bun:test';
import { isDevContentEditing, syncDevModeOnSection } from '../../src/scripts/devSectionMount';

const originalDocument = globalThis.document;
afterEach(() => { globalThis.document = originalDocument; });

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
