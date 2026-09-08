import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/SectionSidebarNav.astro', import.meta.url), 'utf8');
const helperStart = source.indexOf('    const settleInitialActiveLink = (id) => {');
const helperEnd = source.indexOf('\n    let ticking = false;', helperStart);
if (helperStart < 0 || helperEnd < 0) throw new Error('Could not extract initial sidebar sync helper');
const helper = source.slice(helperStart, source.indexOf('\n    };', helperStart) + 7);

class FakeClassList {
  values = new Set<string>();
  toggle(name: string, force?: boolean) { if (force === false || (force === undefined && this.values.has(name))) this.values.delete(name); else this.values.add(name); }
  remove(...names: string[]) { names.forEach((name) => this.values.delete(name)); }
  contains(name: string) { return this.values.has(name); }
}

class FakeGroup {
  open: boolean;
  classList = new FakeClassList();
  summary = { classList: new FakeClassList() };
  constructor(open: boolean) { this.open = open; }
  querySelector(selector: string) { return selector.includes('summary') ? this.summary : null; }
}

class FakeLink {
  classList = new FakeClassList();
  attrs = new Map<string, string>();
  constructor(private href: string, private group: FakeGroup | null) {}
  getAttribute(name: string) { return name === 'href' ? this.href : this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  closest(selector: string) { return selector === '.section-sidebar-nav__group' ? this.group : null; }
}

const run = ({ activeId, groups, links, editor = false }: {
  activeId: string; groups: FakeGroup[]; links: FakeLink[]; editor?: boolean;
}) => new Function('env', `with (env) { ${helper}; settleInitialActiveLink(activeId); }`)({
  activeId,
  groupAnims: new Map(),
  animRafId: 0,
  getNavLinks: () => links,
  getNavGroups: () => groups,
  isSectionEditorActive: () => editor,
  sectionEditorKeepOpen: editor,
  clearGroupAnimStyles: () => {},
  clearChevronDegrees: () => {},
  cancelAnimationFrame: () => {},
  clearListCtrl: () => {},
  updateAnimatingClass: () => {},
  syncActiveGroupHighlight: (activeGroup: FakeGroup | null) => {
    groups.forEach((group) => group.summary.classList.toggle('is-active', group === activeGroup && !group.open));
  },
  HTMLDetailsElement: FakeGroup,
});

test('initial sync opens only the active group without starting accordion animation', () => {
  const groups = [new FakeGroup(true), new FakeGroup(true), new FakeGroup(true)];
  const links = [new FakeLink('#intro', null), new FakeLink('#active', groups[1]), new FakeLink('#other', groups[2])];
  run({ activeId: 'active', groups, links });
  expect(groups.map((group) => group.open)).toEqual([false, true, false]);
  expect(links.map((link) => link.classList.contains('is-active'))).toEqual([false, true, false]);
  expect(links[1].attrs.get('aria-current')).toBe('true');
});

test('initial sync closes every group for a top-level active link', () => {
  const groups = [new FakeGroup(true), new FakeGroup(true)];
  const links = [new FakeLink('#root', null)];
  run({ activeId: 'root', groups, links });
  expect(groups.every((group) => !group.open)).toBe(true);
});

test('editor mode leaves every group open', () => {
  const groups = [new FakeGroup(true), new FakeGroup(false)];
  const links = [new FakeLink('#active', groups[0])];
  run({ activeId: 'active', groups, links, editor: true });
  expect(groups.map((group) => group.open)).toEqual([true, false]);
});

test('scroll updates animate after the one-shot initial settle and unresolved IDs keep it pending', () => {
  expect(source).toContain('let initialSyncPending = true;');
  expect(source).toContain('if (activeId) {');
  expect(source).toContain('settleInitialActiveLink(activeId);');
  expect(source).toContain('initialSyncPending = false;');
  expect(source).toContain('setActiveLink(activeId);');
  expect(source).toContain('if (initialSyncPending && !isSectionEditorActive() && !sectionEditorKeepOpen)');
});

test('SSR only opens the first group when the first nav item is grouped', () => {
  expect(source).toContain("const firstGroupIndex = sectionLinks[0] && 'children' in sectionLinks[0] ? 0 : -1;");
  expect(source).toContain('open={item.defaultOpen && index === firstGroupIndex}');
});
