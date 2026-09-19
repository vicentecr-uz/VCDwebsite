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

export const annotationRect = (section: HTMLElement, annotation: PositionedAnnotation): DOMRect | null => {
  const target = annotation.anchor ? findTextAnchor(section, annotation.anchor) : section.getBoundingClientRect();
  if (!target || target.width <= 0 || target.height <= 0) return null;
  const parent = section.getBoundingClientRect();
  const box = annotation.box;
  const x = annotation.kind === 'highlight' ? box.x * target.width : box.x;
  const y = annotation.kind === 'highlight' ? box.y * target.height : box.y;
  const w = annotation.kind === 'highlight' ? box.w * target.width : box.w;
  const h = annotation.kind === 'highlight' ? box.h * target.height : box.h;
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
      const outside = rect && annotation.kind === 'doodle'
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
      ? change.target.closest('.site-annotations')
      : change.target.parentElement?.closest('.site-annotations')))) schedule();
  });
  for (const section of document.querySelectorAll<HTMLElement>('[data-site-annotation-section-id]')) {
    resizeObserver.observe(section);
    const text = section.querySelector('.project-body-text, .project-section-title');
    if (text) mutationObserver.observe(text, { subtree: true, childList: true, characterData: true });
  }
  schedule();
};

window.addEventListener('resize', schedule, { signal: lifecycle.signal });
window.addEventListener('vcd:site-annotations-changed', schedule, { signal: lifecycle.signal });
document.addEventListener('astro:page-load', bind, { signal: lifecycle.signal });
document.fonts?.ready.then(schedule);
bind();

if (import.meta.hot) import.meta.hot.dispose(() => {
  lifecycle.abort();
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  if (frame) cancelAnimationFrame(frame);
});
