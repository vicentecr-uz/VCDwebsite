import { toSvg } from 'drawesome';
import type { SiteAnnotation } from './siteAnnotations';

export const siteAnnotationSvg = (annotation: SiteAnnotation): string => {
  const svg = toSvg(annotation.strokes, annotation.board.w, annotation.board.h, 'transparent');
  return annotation.kind === 'highlight'
    ? svg.replace('<svg ', '<svg preserveAspectRatio="none" ')
    : svg;
};
