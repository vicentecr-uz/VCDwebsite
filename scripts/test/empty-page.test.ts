import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getSectionRoots } from '../../src/scripts/devSectionPaths';

class FakeClassList {
  private values = new Set<string>();
  toggle(name: string, force?: boolean) {
    const next = force === undefined ? !this.values.has(name) : force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
  contains(name: string) { return this.values.has(name); }
}

type FakeNode = {
  dataset: Record<string, string>;
  parentElement: FakeZone | null;
  classList: FakeClassList;
  contains: (other: FakeNode) => boolean;
};

class FakeZone {
  dataset: Record<string, string>;
  classList = new FakeClassList();
  nodes: FakeNode[] = [];
  constructor(documentKey: string) {
    this.dataset = { pageDocument: documentKey };
  }
  querySelectorAll() { return this.nodes; }
}

const node = (zone: FakeZone, path: string, writePath?: string, deletable = true): FakeNode => {
  const value: FakeNode = {
    dataset: {
      devSpacingPath: path,
      ...(writePath ? { devSpacingWritePath: writePath } : {}),
      ...(deletable ? { devSectionDeletable: 'bodyText' } : {}),
    },
    parentElement: zone,
    classList: new FakeClassList(),
    contains: () => false,
  };
  zone.nodes.push(value);
  return value;
};

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const syncEmptyZoneState = () => {');
const end = source.indexOf('    let lastSpacingViewport', start);
if (start < 0 || end < 0) throw new Error('Could not extract empty-page state helper');
const helperSource = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end));

test('empty state follows actual roots and targets only the trailing sentinel per zone', () => {
  const filled = new FakeZone('home');
  const text = node(filled, '["sections",0,"spacing"]');
  node(filled, '["sections",1,"spacing"]', undefined, false); // project grid root
  const sentinel = node(filled, '["sections",2,"spacing"]', '["trailingSpacing"]', false);
  const hidden = new FakeZone('home-intro');
  node(hidden, '["sections",0,"spacing"]', undefined, false);
  const hiddenSentinel = node(hidden, '["sections",0,"spacing"]', '["trailingSpacing"]', false);
  const states = [text, sentinel, hiddenSentinel].map((element) => ({
    element,
    control: { classList: new FakeClassList() },
  }));
  const document = { querySelectorAll: () => [filled, hidden] };
  const syncEmptyZoneState = new Function('env', `with (env) { ${helperSource}; return syncEmptyZoneState; }`)({
    document,
    getSectionRoots,
    spacingStates: states,
  }) as () => void;

  syncEmptyZoneState();
  expect(filled.classList.contains('is-dev-empty-page')).toBe(false);
  expect(states[1].control.classList.contains('is-dev-empty-add')).toBe(false);
  expect(hidden.classList.contains('is-dev-empty-page')).toBe(false);
  expect(hiddenSentinel.classList.contains('is-dev-empty-add')).toBe(false);

  filled.nodes = [sentinel];
  syncEmptyZoneState();
  expect(filled.classList.contains('is-dev-empty-page')).toBe(true);
  expect(states[1].control.classList.contains('is-dev-empty-add')).toBe(true);
  expect(states.filter((state) => state.control.classList.contains('is-dev-empty-add'))).toHaveLength(1);

  filled.nodes.push(node(filled, '["sections",0,"spacing"]'));
  syncEmptyZoneState();
  expect(filled.classList.contains('is-dev-empty-page')).toBe(false);
  expect(states[1].control.classList.contains('is-dev-empty-add')).toBe(false);
});
