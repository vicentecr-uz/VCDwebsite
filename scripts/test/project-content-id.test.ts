import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const stackSource = readFileSync(new URL('../../src/lib/projectStack.ts', import.meta.url), 'utf8');
const start = stackSource.indexOf('export function spacingDevAttrs(');
const end = stackSource.indexOf('\n}', start) + 2;
const spacingDevAttrs = new Function(
  'isDev',
  `const resolveProjectStackSpacing = (spacing) => ({ desktop: spacing, tablet: spacing, mobile: spacing }); ${new Bun.Transpiler({ loader: 'ts' }).transformSync(stackSource.slice(start, end).replace('export function', 'function').replace('import.meta.env.DEV', 'isDev'))}; return spacingDevAttrs;`,
)(true) as (
  documentKey: string | undefined,
  sectionPath: Array<string | number> | undefined,
  spacing: string,
  options?: { contentId?: string },
) => Record<string, string> | undefined;

test('DEV spacing metadata carries canonical content IDs separately from section anchors', () => {
  const attrs = spacingDevAttrs('new-classic', ['sections', 2], 'section', { contentId: 'content-42' });
  expect(attrs?.['data-dev-content-id']).toBe('content-42');
  expect(attrs?.['data-dev-spacing-path']).toBe('["sections",2,"spacing"]');
});

test('production spacing metadata omits editor-only content IDs', () => {
  expect(spacingDevAttrs('new-classic', ['sections', 2], 'section', { contentId: 'content-42' })).toBeDefined();
  expect(new Function(
    'isDev',
    `const resolveProjectStackSpacing = (spacing) => ({ desktop: spacing, tablet: spacing, mobile: spacing }); ${new Bun.Transpiler({ loader: 'ts' }).transformSync(stackSource.slice(start, end).replace('export function', 'function').replace('import.meta.env.DEV', 'isDev'))}; return spacingDevAttrs;`,
  )(false)('new-classic', ['sections', 2], 'section', { contentId: 'content-42' })).toBeUndefined();
});

test('client mounted image roots pass section IDs into the shared metadata helper', () => {
  const mountSource = readFileSync(new URL('../../src/scripts/devSectionMount.ts', import.meta.url), 'utf8');
  expect(mountSource).toContain('spacingDevAttrs(documentKey, sectionPath, spacing, { contentId: String(section.id ?? \'\') })');
});
