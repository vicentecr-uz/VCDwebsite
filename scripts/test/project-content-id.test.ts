import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { withDevEditTarget } from '../../src/scripts/devEditTarget';

const originalDocument = globalThis.document;

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

test('mounted section and nested item metadata resolve canonical IDs independently of outline anchors', () => {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  document.body.innerHTML = `<section id="outline-anchor" data-dev-content-id="content-42" data-dev-spacing-document="knife" data-dev-spacing-path='["sections",2,"spacing"]'>
    <figure data-grid-item-id="image-7" data-dev-image-path='["sections",2,"items",0]'></figure>
  </section>`;
  const item = document.querySelector<HTMLElement>('figure')!;
  const queued = withDevEditTarget<Record<string, unknown>>({ document: 'knife', path: ['sections', 2, 'items', 0] }, item);
  expect(queued.target).toEqual({ sectionId: 'content-42', itemId: 'image-7' });
  expect(queued.target?.sectionId).not.toBe('outline-anchor');
});

afterEach(() => { globalThis.document = originalDocument; });
