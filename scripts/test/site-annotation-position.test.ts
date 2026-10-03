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

const { findTextAnchor, annotationRect, annotationBlockTarget, annotationVisibleRect, textPartRect } = await import('../../src/scripts/siteAnnotationPosition');
const { captureTextParts, editableTextStrokes } = await import('../../src/lib/siteAnnotationTextParts');
const { validateSiteAnnotations } = await import('../../src/lib/siteAnnotations');

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

test('independent ink runs follow graphemes across hyphen wraps and retain erasers during editing', () => {
  const block = window.document.createElement('section');
  block.innerHTML = '<div class="project-body-text"><p>journaling <em>stream-of-consciousness</em> typing</p></div>';
  block.getBoundingClientRect = () => new window.DOMRect(0, 0, 500, 150);
  const original = window.Range.prototype.getClientRects;
  let wrapAt = 1000;
  window.Range.prototype.getClientRects = function () {
    const paragraph = this.startContainer.parentElement!.closest('p')!;
    const walker = window.document.createTreeWalker(paragraph, window.NodeFilter.SHOW_TEXT);
    let offset = this.startOffset;
    while (walker.nextNode() && walker.currentNode !== this.startContainer) offset += walker.currentNode.textContent!.length;
    return Array.from({ length: this.toString().length }, (_, i) => {
      const at = offset + i;
      return new window.DOMRect((at >= wrapAt ? at - wrapAt : at) * 10, at >= wrapAt ? 70 : 30, 10, 20);
    });
  };
  try {
    const ink: SiteAnnotation['strokes'] = [
      { id: 0, pen: 'highlighter', color: '#ffff00', size: 6, opacity: .5, points: [[5, 40, .5], [95, 40, .5]] },
      { id: 1, pen: 'highlighter', color: '#ffff00', size: 6, opacity: .5, points: [[115, 40, .5], [425, 40, .5]] },
      { id: 2, pen: 'pen', erase: true, color: '#000', size: 4, opacity: 1, points: [[20, 40, .5], [30, 40, .5]] },
    ];
    const crop = new window.DOMRect(0, 20, 450, 40);
    const parts = captureTextParts(block, ink, crop)!;
    expect(parts.length).toBe(2);
    expect(parts[0].anchor.exact).toBe('journaling');
    expect(parts[1].anchor.exact).toBe('stream-of-consciousness typing');
    const marker = [{ ...ink[0], pen: 'marker' as const }];
    expect(captureTextParts(block, marker, crop)).toBeUndefined();
    expect(captureTextParts(block, marker, crop, true)?.[0].anchor.exact).toBe('journaling');
    const drawing: SiteAnnotation = { id: 'group', sectionId: 's', kind: 'doodle', mobile: 'show',
      board: { w: 450, h: 40 }, box: { x: 0, y: 20, w: 450, h: 40 }, textParts: parts,
      strokes: ink.map((stroke) => ({ ...stroke, points: stroke.points.map(([x, y, pressure]) => [x, y - 20, pressure]) })) };
    expect(validateSiteAnnotations([drawing], new Set(['s']))).toBe(true);
    const afterHyphen = parts[1].slices.findIndex((slice) => slice.start === 'stream-of-'.length);
    const originalY = textPartRect(block, parts[1], afterHyphen)!.top;
    const editable = editableTextStrokes(block, drawing)!;
    expect(editable.length).toBe(drawing.strokes.length);
    expect(editable[2].erase).toBe(true);
    expect(editable[2].points).toEqual(ink[2].points);
    wrapAt = 'journaling stream-of-'.length;
    expect(textPartRect(block, parts[1], afterHyphen)!.top).toBe(originalY + 40);
    expect(textPartRect(block, parts[0], 0)!.top).toBe(originalY);
    expect(editableTextStrokes(block, drawing)).toBeNull();
    block.querySelector('em')!.textContent = 'replaced';
    expect(textPartRect(block, parts[1], afterHyphen)).toBeNull();
    expect(textPartRect(block, parts[0], 0)).not.toBeNull();
  } finally { window.Range.prototype.getClientRects = original; }
});
