import { createPageScope, onPageLoad } from '../../lib/pageLifecycle';

const VERTICAL_FADE_EM = 2.5;
const HORIZONTAL_FADE_PX = 24;
const progress = (distance: number, length: number) => Math.min(1, Math.max(0, distance / length));

function sync(scroller: HTMLElement, edge: HTMLElement | null) {
  const horizontal = scroller.scrollWidth - scroller.clientWidth;
  const clientHeight = scroller.clientHeight;
  const vertical = scroller.scrollHeight - clientHeight;
  const remaining = edge ? horizontal - scroller.scrollLeft : 0;
  const scrollbarHeight = edge ? scroller.offsetHeight - clientHeight : 0;
  const scrollTop = vertical > 1 ? scroller.scrollTop : 0;
  const fade = vertical > 1 ? VERTICAL_FADE_EM * parseFloat(getComputedStyle(scroller).fontSize) : 0;

  if (horizontal > 1 || vertical > 1) {
    if (scroller.getAttribute('tabindex') !== '0') scroller.tabIndex = 0;
  } else {
    scroller.removeAttribute('tabindex');
  }

  if (edge && !edge.toggleAttribute('hidden', horizontal <= 1 || remaining <= 1)) {
    const opacity = String(progress(remaining, HORIZONTAL_FADE_PX));
    if (edge.style.opacity !== opacity) edge.style.opacity = opacity;
    const scrollbar = `${scrollbarHeight}px`;
    if (edge.style.getPropertyValue('--code-scrollbar-height') !== scrollbar) {
      edge.style.setProperty('--code-scrollbar-height', scrollbar);
    }
  }

  scroller.toggleAttribute('data-code-scroll', vertical > 1);
  if (vertical <= 1) return;
  scroller.style.setProperty('--code-fade-top', String(progress(scrollTop, fade)));
  scroller.style.setProperty('--code-fade-bottom', String(progress(vertical - scrollTop, fade)));
}

let syncBlock: ((root: Element) => void) | undefined;

export function syncCodeBlock(root: Element) {
  syncBlock?.(root);
}

onPageLoad(() => {
  const scope = createPageScope();
  const edges = new WeakMap<HTMLElement, HTMLElement | null>();
  const pending = new Set<HTMLElement>();
  let frame = 0;

  const schedule = (scroller: HTMLElement) => {
    pending.add(scroller);
    if (frame) return;
    frame = scope.frame(() => {
      frame = 0;
      for (const scroller of pending) sync(scroller, edges.get(scroller) ?? null);
      pending.clear();
    });
  };
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const scroller = target.closest<HTMLElement>('.astro-code');
      if (scroller) schedule(scroller);
    }
  });
  scope.add(() => observer.disconnect());

  syncBlock = (root) => {
    for (const scroller of root.querySelectorAll<HTMLElement>('.astro-code')) {
      if (!edges.has(scroller)) {
        const edge = scroller.parentElement?.querySelector<HTMLElement>('[data-code-edge]') ?? null;
        edges.set(scroller, edge);
        scope.listen(scroller, 'scroll', () => schedule(scroller), { passive: true });
        observer.observe(scroller);
        if (edge && scroller.firstElementChild) observer.observe(scroller.firstElementChild);
      }
      sync(scroller, edges.get(scroller) ?? null);
    }
  };
  document.querySelectorAll('[data-code-block]').forEach(syncCodeBlock);

  return () => {
    syncBlock = undefined;
    scope.destroy();
    pending.clear();
  };
});
