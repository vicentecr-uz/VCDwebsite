import type { SiteAnnotation } from '../lib/siteAnnotations';

type TextAnchor = NonNullable<SiteAnnotation['anchor']>;
type PositionedAnnotation = Omit<SiteAnnotation, 'strokes'>;

const textBlocks = (section: HTMLElement) => {
  const body = section.querySelector('.project-body-text');
  if (body) return [...body.querySelectorAll<HTMLElement>(':scope > p, :scope > div')];
  const heading = section.querySelector<HTMLElement>('.project-section-title');
  return heading ? [heading] : [];
};

const rangeForOffsets = (block: HTMLElement, start: number, end: number): Range | null => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  let first: { node: Text; offset: number } | null = null;
  let last: { node: Text; offset: number } | null = null;
  for (const node of nodes) {
    const next = offset + node.length;
    if (!first && start < next) first = { node, offset: start - offset };
    if (first && end <= next) {
      last = { node, offset: end - offset };
      break;
    }
    offset = next;
  }
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  return range;
};

const singleLineRect = (range: Range): DOMRect | null => {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length || rects.some((rect) => Math.abs(rect.top - rects[0].top) > 3)) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
};

export const findTextAnchor = (section: HTMLElement, anchor: TextAnchor): DOMRect | null => {
  const blocks = textBlocks(section);
  const candidates: Array<{ range: Range; context: boolean }> = [];
  const order = [blocks[anchor.paragraphIndex], ...blocks.filter((_, index) => index !== anchor.paragraphIndex)]
    .filter((block): block is HTMLElement => Boolean(block));
  for (const block of order) {
    const content = block.textContent ?? '';
    let at = content.indexOf(anchor.exact);
    while (at !== -1) {
      const range = rangeForOffsets(block, at, at + anchor.exact.length);
      if (range) candidates.push({
        range,
        context: content.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix
          && content.slice(at + anchor.exact.length, at + anchor.exact.length + anchor.suffix.length) === anchor.suffix,
      });
      at = content.indexOf(anchor.exact, at + 1);
    }
  }
  const contextual = candidates.filter((item) => item.context);
  const chosen = contextual.length === 1 ? contextual[0]
    : candidates.length === 1 ? candidates[0] : null;
  return chosen ? singleLineRect(chosen.range) : null;
};

export const annotationBlockTarget = (section: HTMLElement, anchor: NonNullable<SiteAnnotation['blockAnchor']>): HTMLElement | null => {
  if (anchor.surface === 'block') return section;
  let item: HTMLElement | undefined = section;
  for (const id of anchor.itemPath ?? []) {
    const parent = item;
    if (!parent) return null;
    item = [...parent.querySelectorAll<HTMLElement>('[data-grid-item-id]')].find((element) => {
      const ancestor = element.parentElement?.closest('[data-grid-item-id]');
      return element.dataset.gridItemId === id && (parent === section
        ? !ancestor || !section.contains(ancestor) : ancestor === parent);
    });
  }
  if (!item || item.closest('[aria-hidden="true"], [data-carousel-parked="true"]')) return null;
  return item.querySelector<HTMLElement>('.project-crop-clip, .project-video-player, .project-image-grid__frame, [data-carousel-frame]')
    ?? item.querySelector<HTMLElement>('iframe, video, img:not([data-site-annotation])')
    ?? item;
};

export const annotationVisibleRect = (target: HTMLElement): DOMRect => {
  let { left, top, right, bottom } = target.getBoundingClientRect();
  let parent = target.parentElement;
  while (parent) {
    if (parent.matches('.project-image-carousel__track, .project-image-carousel__clip')) {
      const bounds = parent.getBoundingClientRect();
      left = Math.max(left, bounds.left);
      top = Math.max(top, bounds.top);
      right = Math.min(right, bounds.right);
      bottom = Math.min(bottom, bounds.bottom);
    }
    parent = parent.parentElement;
  }
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
};

export const annotationBaseRect = (section: HTMLElement, annotation: Pick<SiteAnnotation, 'anchor' | 'blockAnchor'>): DOMRect | null => {
  if (annotation.anchor) return findTextAnchor(section, annotation.anchor);
  const target = annotation.blockAnchor ? annotationBlockTarget(section, annotation.blockAnchor) : section;
  const rect = target?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
};

export const annotationRect = (section: HTMLElement, annotation: PositionedAnnotation): DOMRect | null => {
  const target = annotationBaseRect(section, annotation);
  if (!target || target.width <= 0 || target.height <= 0) return null;
  const parent = section.getBoundingClientRect();
  const box = annotation.box;
  const scaled = annotation.kind === 'highlight' || annotation.blockAnchor;
  const x = scaled ? box.x * target.width : box.x;
  const y = scaled ? box.y * target.height : box.y;
  const w = scaled ? box.w * target.width : box.w;
  const h = scaled ? box.h * target.height : box.h;
  return new DOMRect(target.left - parent.left + x, target.top - parent.top + y, w, h);
};

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let frame = 0;
const lifecycle = new AbortController();

export const positionSiteAnnotations = () => {
  for (const layer of document.querySelectorAll<HTMLElement>('[data-site-annotations]')) {
    const section = layer.closest<HTMLElement>('[data-site-annotation-section-id]');
    if (!section) continue;
    let annotations: PositionedAnnotation[];
    try { annotations = JSON.parse(layer.dataset.siteAnnotations || '[]'); }
    catch { annotations = []; }
    let unresolved = 0;
    for (const annotation of annotations) {
      const image = [...layer.querySelectorAll<HTMLImageElement>('[data-site-annotation]')]
        .find((item) => item.dataset.siteAnnotation === annotation.id);
      if (!image) continue;
      const rect = annotationRect(section, annotation);
      image.dataset.siteAnnotationMobile = annotation.mobile;
      const outside = rect && annotation.kind === 'doodle' && !annotation.blockAnchor
        && (section.getBoundingClientRect().left + rect.left < 8
          || section.getBoundingClientRect().left + rect.right > window.innerWidth - 8);
      if (!rect || outside) {
        image.style.visibility = 'hidden';
        if (!rect) unresolved++;
        continue;
      }
      image.style.left = `${rect.x}px`;
      image.style.top = `${rect.y}px`;
      image.style.width = `${rect.width}px`;
      image.style.height = `${rect.height}px`;
      const blockTarget = annotation.blockAnchor ? annotationBlockTarget(section, annotation.blockAnchor) : null;
      const track = blockTarget?.closest<HTMLElement>('.project-image-carousel__track');
      if (track) {
        const bounds = annotationVisibleRect(track);
        const parent = section.getBoundingClientRect();
        image.style.clipPath = `inset(${Math.max(0, bounds.top - parent.top - rect.top)}px ${Math.max(0, parent.left + rect.right - bounds.right)}px ${Math.max(0, parent.top + rect.bottom - bounds.bottom)}px ${Math.max(0, bounds.left - parent.left - rect.left)}px)`;
      } else image.style.removeProperty('clip-path');
      image.style.visibility = 'visible';
    }
    section.dataset.siteAnnotationUnresolved = String(unresolved);
    const manage = section.querySelector<HTMLButtonElement>('[data-site-draw-manage]');
    if (manage && annotations.length) {
      manage.textContent = unresolved ? `Drawings ${annotations.length} · ${unresolved} needs repair` : `Drawings ${annotations.length}`;
    }
  }
};

const schedule = () => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    positionSiteAnnotations();
  });
};

const bind = () => {
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = new ResizeObserver(schedule);
  mutationObserver = new MutationObserver((changes) => {
    if (changes.some((change) => !(change.target instanceof Element
      ? change.target.closest('.site-annotations, .site-draw-controls, .site-draw-menu')
      : change.target.parentElement?.closest('.site-annotations, .site-draw-controls, .site-draw-menu')))) schedule();
  });
  for (const section of document.querySelectorAll<HTMLElement>('[data-site-annotation-section-id]')) {
    resizeObserver.observe(section);
    for (const media of section.querySelectorAll<HTMLElement>('[data-grid-item-id], .project-crop-clip, .project-video-player, img:not([data-site-annotation]), video, iframe')) resizeObserver.observe(media);
    mutationObserver.observe(section, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'data-carousel-parked'] });
  }
  schedule();
};

window.addEventListener('resize', schedule, { signal: lifecycle.signal });
document.addEventListener('scroll', schedule, { capture: true, passive: true, signal: lifecycle.signal });
document.addEventListener('load', schedule, { capture: true, signal: lifecycle.signal });
window.addEventListener('vcd:site-annotations-changed', schedule, { signal: lifecycle.signal });
document.addEventListener('astro:page-load', bind, { signal: lifecycle.signal });
window.addEventListener('vcd:dev-section-structure-changed', bind, { signal: lifecycle.signal });
window.addEventListener('vcd:site-annotation-targets-changed', bind, { signal: lifecycle.signal });
document.fonts?.ready.then(schedule);
bind();

if (import.meta.hot) import.meta.hot.dispose(() => {
  lifecycle.abort();
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  if (frame) cancelAnimationFrame(frame);
});
