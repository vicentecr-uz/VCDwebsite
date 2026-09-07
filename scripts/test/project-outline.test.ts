import { describe, expect, test } from 'bun:test';
import {
  blockIdsInSectionRange,
  deriveNavFromOutline,
  outlineFromNav,
  reorderOutlinePreservingGroups,
  resolveProjectOutline,
} from '../../src/lib/projectOutline.ts';

describe('project outline', () => {
  test('retains explicit group boundaries while sorting page positions', () => {
    const outline = reorderOutlinePreservingGroups([
      { kind: 'section', id: 'later', label: 'Later', anchor: 'b' },
      { kind: 'group', id: 'g', label: 'Group', anchor: 'a' },
      { kind: 'section', id: 'first', label: 'First', anchor: 'a' },
    ], (id) => ['a', 'b'].indexOf(id));
    expect(outline).toEqual([
      { kind: 'group', id: 'g', label: 'Group', defaultOpen: true, anchor: 'a' },
      { kind: 'section', id: 'first', label: 'First', anchor: 'a' },
      { kind: 'section', id: 'later', label: 'Later', anchor: 'b' },
    ]);
  });

  test('uses identity rather than labels and does not duplicate markers', () => {
    const outline = reorderOutlinePreservingGroups([
      { kind: 'group', id: 'one', label: 'Same' },
      { kind: 'section', id: 'a', label: 'Same', anchor: 'a' },
      { kind: 'group', id: 'two', label: 'Same' },
      { kind: 'section', id: 'b', label: 'Same', anchor: 'b' },
      { kind: 'group', id: 'one', label: 'Renamed' },
    ], (id) => ['a', 'b'].indexOf(id));
    expect(outline.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'group:one', 'section:a', 'group:two', 'section:b',
    ]);
  });

  test('respects an explicitly empty outline', () => {
    expect(resolveProjectOutline({
      outline: [],
      nav: [{ id: 'legacy', label: 'Legacy' }],
    })).toEqual([]);
  });

  test('resolves an unanchored legacy group from its first section', () => {
    expect(resolveProjectOutline({
      outline: [
        { kind: 'group', id: 'intro', label: 'Intro' },
        { kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' },
      ],
      sections: [{ id: 'overview' }],
    })).toEqual([
      { kind: 'group', id: 'intro', label: 'Intro', defaultOpen: true, anchor: 'overview' },
      { kind: 'section', id: 'overview', label: 'Overview', anchor: 'overview' },
    ]);
  });

  test('preserves nav ids and gives legacy duplicate groups deterministic ids', () => {
    const outline = outlineFromNav([
      { id: 'supplied', anchor: 'start', label: 'Research', children: [] },
      { label: 'Research', children: [{ id: 'target', outlineId: 'stable', label: 'Overview' }] },
    ]);
    expect(outline).toEqual([
      { kind: 'group', id: 'supplied', label: 'Research', defaultOpen: true, anchor: 'start' },
      { kind: 'group', id: 'research', label: 'Research', defaultOpen: true, anchor: 'target' },
      { kind: 'section', id: 'stable', label: 'Overview', anchor: 'target' },
    ]);
    expect(outlineFromNav([{ label: 'Research', children: [] }])[0]).toMatchObject({ id: 'research' });
  });

  test('preserves top-level link identity and anchors groups to fallback child anchors', () => {
    expect(outlineFromNav([
      { label: 'Group', children: [{ label: 'Overview', id: '', outlineId: 'stable' }] },
      { label: 'Standalone', id: 'standalone-dom', outlineId: 'standalone-stable' },
    ])).toEqual([
      { kind: 'group', id: 'group', label: 'Group', defaultOpen: true, anchor: 'overview' },
      { kind: 'section', id: 'stable', label: 'Overview', anchor: 'overview' },
      { kind: 'section', id: 'standalone-stable', label: 'Standalone', anchor: 'standalone-dom' },
    ]);
  });

  test('propagates marker ids and anchors into derived nav', () => {
    expect(deriveNavFromOutline([
      { kind: 'group', id: 'g', label: 'Group', anchor: 'a' },
      { kind: 'section', id: 'stable', label: 'Section', anchor: 'a' },
    ])).toEqual([{
      id: 'g', label: 'Group', anchor: 'a', defaultOpen: true, children: [
        { id: 'a', outlineId: 'stable', label: 'Section' },
      ],
    }]);
  });

  test('ends section ranges at the next page marker', () => {
    const outline = [
      { kind: 'group' as const, id: 'g', label: 'Group', anchor: 'a' },
      { kind: 'section' as const, id: 'first', label: 'First', anchor: 'a' },
      { kind: 'section' as const, id: 'second', label: 'Second', anchor: 'c' },
    ];
    expect(blockIdsInSectionRange(outline, outline[1], ['a', 'b', 'c', 'd'])).toEqual(['a', 'b']);
  });
});
