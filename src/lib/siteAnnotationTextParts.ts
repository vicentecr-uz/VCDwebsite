import type { Stroke } from 'drawesome';
import type { SiteAnnotation } from './siteAnnotations';
import { textBlocks, rangeForOffsets, textPartRect, annotationRect } from '../scripts/siteAnnotationPosition';

type Box = { x: number; y: number; w: number; h: number };
type Point = [number, number, number];
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const clipSegment = (a: Point, b: Point, box: Box): [Point, Point] | null => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let start = 0, end = 1;
  const edges = [[-dx, a[0] - box.x], [dx, box.x + box.w - a[0]],
    [-dy, a[1] - box.y], [dy, box.y + box.h - a[1]]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const at = q / p;
    if (p < 0) start = Math.max(start, at);
    else end = Math.min(end, at);
    if (start > end) return null;
  }
  const point = (t: number): Point => [a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t];
  return [point(start), point(end)];
};

export const captureTextParts = (section: HTMLElement, strokes: Stroke[], crop: DOMRect, highlightMode = false): SiteAnnotation['textParts'] => {
  const parts: NonNullable<SiteAnnotation['textParts']> = [];
  const blocks = textBlocks(section);
  for (const stroke of strokes) {
    if (stroke.erase || !stroke.points.length) continue;
    const xs = stroke.points.map((point) => point[0]), ys = stroke.points.map((point) => point[1]);
    const horizontal = Math.max(...ys) - Math.min(...ys) <= stroke.size
      && Math.max(...xs) - Math.min(...xs) >= stroke.size * 2;
    if (stroke.pen !== 'highlighter' && !(highlightMode && horizontal)) continue;
    const radius = stroke.size / 2;
    for (const [paragraphIndex, block] of blocks.entries()) {
      const text = block.textContent ?? '';
      const painted = [...segmenter.segment(text)].flatMap(({ segment, index }) => {
        const range = rangeForOffsets(block, index, index + segment.length);
        const rects = range ? [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0) : [];
        if (rects.length !== 1) return [];
        const rect = rects[0];
        const hit = { x: rect.left - radius, y: rect.top - radius, w: rect.width + radius * 2, h: rect.height + radius * 2 };
        const points = stroke.points as Point[];
        const touches = points.some((point, i) => clipSegment(point, points[i + 1] ?? point, hit));
        return touches ? [{ start: index, end: index + segment.length, rect }] : [];
      });
      for (let i = 0; i < painted.length;) {
        let end = i + 1;
        while (end < painted.length && painted[end].start === painted[end - 1].end) end++;
        const run = painted.slice(i, end);
        const startOffset = run[0].start, endOffset = run.at(-1)!.end;
        const slices = run.map((glyph, index) => {
          const rect = glyph.rect;
          const previous = run[index - 1], next = run[index + 1];
          const sameLine = (item: typeof glyph | undefined) => item && Math.abs(item.rect.top - rect.top) < 3;
          const left = sameLine(previous) ? (previous.rect.right + rect.left) / 2 : Math.max(crop.left, rect.left - radius - 2);
          const right = sameLine(next) ? (rect.right + next.rect.left) / 2 : Math.min(crop.right, rect.right + radius + 2);
          const top = Math.max(crop.top, rect.top - radius - 2);
          const bottom = Math.min(crop.bottom, rect.bottom + radius + 2);
          return { start: glyph.start - startOffset, end: glyph.end - startOffset,
            glyph: { x: rect.left - crop.left, y: rect.top - crop.top, w: rect.width, h: rect.height },
            clip: { x: left - crop.left, y: top - crop.top, w: right - left, h: bottom - top } };
        }).filter((slice) => slice.clip.w > 0 && slice.clip.h > 0);
        if (slices.length) parts.push({ strokeId: stroke.id,
          anchor: { paragraphIndex, exact: text.slice(startOffset, endOffset),
            prefix: text.slice(Math.max(0, startOffset - 24), startOffset), suffix: text.slice(endOffset, endOffset + 24) }, slices });
        i = end;
      }
    }
  }
  for (const stroke of strokes) {
    const slices = parts.filter((part) => part.strokeId === stroke.id).flatMap((part) => part.slices);
    const lines = [...new Set(slices.map((slice) => slice.glyph.y + slice.glyph.h / 2))].sort((a, b) => a - b);
    for (const slice of slices) {
      const line = lines.indexOf(slice.glyph.y + slice.glyph.h / 2);
      const top = line ? Math.max(slice.clip.y, (lines[line - 1] + lines[line]) / 2) : slice.clip.y;
      const bottom = line + 1 < lines.length
        ? Math.min(slice.clip.y + slice.clip.h, (lines[line] + lines[line + 1]) / 2) : slice.clip.y + slice.clip.h;
      slice.clip.y = top;
      slice.clip.h = bottom - top;
    }
  }
  // Larger drawings retain block positioning; upgrading this ceiling needs a larger save payload budget.
  return parts.length && parts.length <= 400 && parts.every((part) => part.anchor.exact.length <= 2000)
    && parts.reduce((sum, part) => sum + part.slices.length, 0) <= 2000 ? parts : undefined;
};

export const editableTextStrokes = (section: HTMLElement, annotation: SiteAnnotation): Stroke[] | null => {
  const parent = section.getBoundingClientRect();
  const cache = new Map();
  let transform: { x: number; y: number; scale: number } | undefined;
  for (const part of annotation.textParts ?? []) {
    for (const [index, slice] of part.slices.entries()) {
      const rect = textPartRect(section, part, index, cache);
      if (!rect) return null;
      const scale = rect.width / slice.clip.w;
      if (Math.abs(rect.height - slice.clip.h * scale) > .5) return null;
      const x = rect.left - slice.clip.x * scale, y = rect.top - slice.clip.y * scale;
      if (transform && (Math.abs(x - transform.x) > .5 || Math.abs(y - transform.y) > .5
        || Math.abs(scale - transform.scale) > .001)) return null;
      transform ??= { x, y, scale };
    }
  }
  if (!transform) return null;
  const mapped = new Set(annotation.textParts?.map((part) => part.strokeId));
  if (annotation.strokes.some((stroke) => !stroke.erase && !mapped.has(stroke.id))) {
    const free = annotationRect(section, annotation);
    if (!free || Math.abs(free.left - transform.x) > .5 || Math.abs(free.top - transform.y) > .5
      || Math.abs(free.width - annotation.board.w * transform.scale) > .5
      || Math.abs(free.height - annotation.board.h * transform.scale) > .5) return null;
  }
  // Reflow edits need clipped brush geometry support in Drawesome; keep raw strokes and erasers exact until then.
  const { x, y, scale } = transform;
  return annotation.strokes.map((stroke) => ({ ...stroke, size: stroke.size * scale,
    points: stroke.points.map(([px, py, pressure]) => [parent.left + x + px * scale, parent.top + y + py * scale, pressure]) }));
};
