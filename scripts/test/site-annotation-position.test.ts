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

const { findTextAnchor, annotationRect, annotationBlockTarget, annotationVisibleRect } = await import('../../src/scripts/siteAnnotationPosition');

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

test('media doodles follow their identified image frame through resizing and item reorder', () => {
  const block = window.document.createElement('div');
  block.innerHTML = '<figure data-grid-item-id="first"><img></figure><figure data-grid-item-id="second"><img></figure>';
  block.getBoundingClientRect = () => new window.DOMRect(20, 30, 600, 400);
  const item = block.lastElementChild!;
  const image = item.querySelector('img')!;
  let frame = new window.DOMRect(320, 60, 200, 100);
  image.getBoundingClientRect = () => frame;
  const annotation: SiteAnnotation = {
    id: 'a', sectionId: 's', kind: 'doodle', blockAnchor: { surface: 'media', itemPath: ['second'] },
    board: { w: 50, h: 25 }, box: { x: 0.25, y: 0.1, w: 0.5, h: 0.4 },
    strokes: [{ id: 1, pen: 'pen', color: '#000', size: 2, opacity: 1, points: [[0, 0, 0.5]] }],
    mobile: 'show',
  };
  expect(annotationRect(block, annotation)?.toJSON()).toMatchObject({ x: 350, y: 40, width: 100, height: 40 });
  block.prepend(item);
  frame = new window.DOMRect(20, 60, 400, 200);
  expect(annotationRect(block, annotation)?.toJSON()).toMatchObject({ x: 100, y: 50, width: 200, height: 80 });
  item.remove();
  expect(annotationRect(block, annotation)).toBeNull();
});

test('nested media paths distinguish slides with the same ID in different grid cells', () => {
  const block = window.document.createElement('div');
  block.innerHTML = '<div data-grid-item-id="left"><figure data-grid-item-id="slide"><img></figure></div><div data-grid-item-id="right"><figure data-grid-item-id="slide"><img></figure></div>';
  block.getBoundingClientRect = () => new window.DOMRect(0, 0, 600, 200);
  for (const [index, image] of [...block.querySelectorAll('img')].entries()) {
    image.getBoundingClientRect = () => new window.DOMRect(index * 300, 0, 200, 100);
  }
  const annotation: SiteAnnotation = {
    id: 'a', sectionId: 's', kind: 'doodle', blockAnchor: { surface: 'media', itemPath: ['right', 'slide'] },
    board: { w: 20, h: 10 }, box: { x: 0, y: 0, w: 0.1, h: 0.1 },
    strokes: [{ id: 1, pen: 'pen', color: '#000', size: 2, opacity: 1, points: [[0, 0, 0.5]] }], mobile: 'show',
  };
  expect(annotationRect(block, annotation)?.x).toBe(300);
});

test('cropped carousel media anchors use the frame and respect every clipping ancestor', () => {
  const block = window.document.createElement('div');
  block.innerHTML = '<div class="project-image-carousel__clip"><div class="project-image-carousel__track"><figure data-grid-item-id="slide"><div class="project-image-grid__frame"><img></div></figure></div></div>';
  const clip = block.querySelector<HTMLElement>('.project-image-carousel__clip')!;
  const track = block.querySelector<HTMLElement>('.project-image-carousel__track')!;
  const item = block.querySelector<HTMLElement>('figure')!;
  const frame = block.querySelector<HTMLElement>('.project-image-grid__frame')!;
  clip.getBoundingClientRect = () => new window.DOMRect(0, 0, 200, 100);
  track.getBoundingClientRect = () => new window.DOMRect(0, 0, 200, 300);
  item.getBoundingClientRect = () => new window.DOMRect(150, 0, 200, 300);
  frame.getBoundingClientRect = item.getBoundingClientRect;
  expect(annotationBlockTarget(block, { surface: 'media', itemPath: ['slide'] })).toBe(frame);
  expect(annotationVisibleRect(item).toJSON()).toMatchObject({ x: 150, y: 0, width: 50, height: 100 });
  expect(annotationVisibleRect(track).height).toBe(100);
  item.getBoundingClientRect = () => new window.DOMRect(250, 0, 200, 300);
  expect(annotationVisibleRect(item).width).toBe(0);
});
