import { toSvg } from 'drawesome';
import type { SiteAnnotation } from './siteAnnotations';

type SiteAnnotationSvgPart = { partIndex: number; sliceIndex: number } | { strokeIndex: number };
const strokeSvgCache = new WeakMap<SiteAnnotation, Map<number, string>>();

const mappedStrokeIds = (annotation: SiteAnnotation): Set<number> =>
  new Set(annotation.textParts?.map(({ strokeId }) => strokeId) ?? []);

const strokesForPart = (annotation: SiteAnnotation, partIndex: number): SiteAnnotation['strokes'] => {
  const part = annotation.textParts?.[partIndex];
  if (!part) return [];
  const strokeIndex = annotation.strokes.findIndex(({ id }) => id === part.strokeId);
  if (strokeIndex < 0) return [];
  return annotation.strokes.filter((stroke, index) => index === strokeIndex || (index > strokeIndex && stroke.erase));
};

const strokesForStroke = (annotation: SiteAnnotation, strokeIndex: number): SiteAnnotation['strokes'] => {
  if (!annotation.strokes[strokeIndex] || annotation.strokes[strokeIndex].erase) return [];
  return annotation.strokes.filter((stroke, index) => index === strokeIndex || (index > strokeIndex && stroke.erase));
};

export const siteAnnotationHasFreeInk = (annotation: SiteAnnotation): boolean => {
  const mapped = mappedStrokeIds(annotation);
  return annotation.strokes.some((stroke) => !stroke.erase && !mapped.has(stroke.id));
};

export const siteAnnotationSvg = (annotation: SiteAnnotation, part?: SiteAnnotationSvgPart): string => {
  const strokes = part && 'partIndex' in part
    ? strokesForPart(annotation, part.partIndex)
    : part && 'strokeIndex' in part
      ? strokesForStroke(annotation, part.strokeIndex)
    : annotation.textParts?.length
      ? annotation.strokes.filter((stroke) => stroke.erase || !mappedStrokeIds(annotation).has(stroke.id))
      : annotation.strokes;
  const slice = part && 'partIndex' in part ? annotation.textParts?.[part.partIndex]?.slices[part.sliceIndex] : undefined;
  if (part && 'partIndex' in part && !slice) return '';
  const width = slice?.clip.w ?? annotation.board.w;
  const height = slice?.clip.h ?? annotation.board.h;
  const strokeIndex = part && ('strokeIndex' in part ? part.strokeIndex
    : annotation.strokes.findIndex((stroke) => stroke.id === annotation.textParts?.[part.partIndex]?.strokeId));
  let cache = strokeSvgCache.get(annotation);
  if (!cache) { cache = new Map(); strokeSvgCache.set(annotation, cache); }
  let svg = strokeIndex !== undefined ? cache.get(strokeIndex) : undefined;
  if (!svg) {
    svg = toSvg(strokes, annotation.board.w, annotation.board.h, 'transparent');
    if (strokeIndex !== undefined) cache.set(strokeIndex, svg);
  }
  if (slice) {
    svg = svg.replace(/<svg ([^>]+)>/, (_, attributes) =>
      `<svg ${attributes.replace(/\s(?:viewBox|width|height)="[^"]*"/g, '')} viewBox="${slice.clip.x} ${slice.clip.y} ${slice.clip.w} ${slice.clip.h}" width="${width}" height="${height}">`);
  }
  return slice || annotation.kind === 'highlight' || annotation.blockAnchor
    ? svg.replace('<svg ', '<svg preserveAspectRatio="none" ')
    : svg;
};
