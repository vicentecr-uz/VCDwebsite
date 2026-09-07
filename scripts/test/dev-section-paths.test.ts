import { describe, expect, test } from 'bun:test';
import {
  captureSectionOrder,
  getSectionRoots,
  sectionIndexFromElement,
} from '../../src/scripts/devSectionPaths';

if (!globalThis.Node) {
  Object.defineProperty(globalThis, 'Node', {
    value: { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 },
  });
}

type FakeElement = {
  dataset: Record<string, string>;
  contains: (other: FakeElement) => boolean;
  querySelectorAll?: () => FakeElement[];
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  compareDocumentPosition: (other: FakeElement) => number;
  order: number;
};

const element = (dataset: Record<string, string>, order: number): FakeElement => {
  const attributes = new Map<string, string>();
  return {
    dataset,
    order,
    contains: () => false,
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    compareDocumentPosition: (other) => other.order > order ? 4 : 2,
  };
};

describe('dev section path helpers', () => {
  test('recognises ordinary and overridden section paths', () => {
    expect(sectionIndexFromElement(element({ devSpacingPath: '["sections",2,"spacing"]' }, 0) as HTMLElement)).toBe(2);
    expect(sectionIndexFromElement(element({ devSpacingPath: '["sections",3,"spacing"]', devSpacingWritePath: '["sections",4,"spacing"]' }, 1) as HTMLElement)).toBe(4);
  });

  test('excludes document-level trailing spacing despite its synthetic section path', () => {
    expect(sectionIndexFromElement(element({ devSpacingPath: '["sections",5,"spacing"]', devSpacingWritePath: '["trailingSpacing"]' }, 0) as HTMLElement)).toBeNull();
    expect(sectionIndexFromElement(element({ devSpacingPath: '{bad' }, 0) as HTMLElement)).toBeNull();
  });

  test('roots and captured order retain blocks while excluding a trailing gap', () => {
    const first = element({ devSpacingPath: '["sections",0,"spacing"]' }, 0);
    const second = element({ devSpacingPath: '["sections",1,"spacing"]' }, 1);
    const trailing = element({ devSpacingPath: '["sections",2,"spacing"]', devSpacingWritePath: '["trailingSpacing"]' }, 2);
    const zone = { querySelectorAll: () => [first, second, trailing] } as unknown as HTMLElement;

    expect(getSectionRoots(zone)).toEqual([first, second]);
    expect(captureSectionOrder(zone)).toEqual([0, 1]);
  });
});
