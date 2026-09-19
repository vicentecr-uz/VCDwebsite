import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SiteAnnotation } from '../../src/lib/siteAnnotations';

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  DOMRect: window.DOMRect,
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => 1,
});

let wordLeft = 120;
let wordWidth = 40;
window.Range.prototype.getClientRects = function () {
  return [new window.DOMRect(wordLeft, 50, wordWidth, 20)];
};

const { findTextAnchor, annotationRect } = await import('../../src/scripts/siteAnnotationPosition');

const section = window.document.createElement('section');
section.innerHTML = '<div class="project-body-text"><p>The word appears, then word appears again.</p></div>';
section.getBoundingClientRect = () => new window.DOMRect(100, 40, 500, 100);
window.document.body.append(section);

test('text context chooses the intended repeated word', () => {
  const rect = findTextAnchor(section, {
    paragraphIndex: 0,
    exact: 'word',
    prefix: 'then ',
    suffix: ' appears',
  });
  expect(rect?.left).toBe(120);
  expect(findTextAnchor(section, {
    paragraphIndex: 0,
    exact: 'word',
    prefix: '',
    suffix: '',
  })).toBeNull();
});

test('a highlight follows the word width while a doodle keeps its own size', () => {
  const base: SiteAnnotation = {
    id: 'a', sectionId: 's', kind: 'highlight',
    anchor: { paragraphIndex: 0, exact: 'word', prefix: 'then ', suffix: ' appears' },
    board: { w: 100, h: 20 }, box: { x: -0.1, y: 0, w: 1.2, h: 1 },
    strokes: [{ id: 1, pen: 'highlighter', color: '#ffff00', size: 8, opacity: 0.5, points: [[0, 0, 0.5]] }],
    mobile: 'show',
  };
  expect(annotationRect(section, base)?.width).toBe(48);
  wordLeft = 180;
  wordWidth = 60;
  expect(annotationRect(section, base)?.x).toBe(74);
  expect(annotationRect(section, base)?.width).toBe(72);
  const doodle = { ...base, kind: 'doodle' as const, box: { x: 30, y: 5, w: 100, h: 20 } };
  expect(annotationRect(section, doodle)?.width).toBe(100);
});
