import { createPageScope, onPageLoad } from '../../lib/pageLifecycle';

const VERTICAL_FADE_EM = 2.5;
const HORIZONTAL_FADE_PX = 30;
const BLUR_BANDS = [
  { start: 1, full: 1, radius: 0.125 },
  { start: 0.9, full: 0.65, radius: 0.25 },
  { start: 0.65, full: 0.35, radius: 0.5 },
  { start: 0.35, full: 0, radius: 1 },
];
const progress = (distance: number, length: number) => Math.min(1, Math.max(0, distance / length));
const nativeScrollTimeline = CSS.supports('animation-timeline', '--code-block-scroll')
  && CSS.supports('timeline-scope', '--code-block-scroll');

type CodeEdge = { layer: HTMLElement; blur: HTMLElement; code: HTMLElement; needsAlignment: boolean };

function setStyle(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
}

function addBlurBands({ blur, code }: CodeEdge) {
  // Clone only the highlighted runs so the samples do not inherit inline-code styling.
  for (const { start, full, radius } of BLUR_BANDS) {
    const band = document.createElement('span');
    band.className = 'code-block__blur-band';
    band.style.setProperty('--band-start', String(start));
    band.style.setProperty('--band-full', String(full));
    band.style.setProperty('--band-radius', String(radius));
    const sample = document.createElement('span');
    sample.className = 'code-block__blur-sample';
    const copy = document.createElement('span');
    copy.className = 'code-block__blur-code';
    const clone = code.cloneNode(true);
    copy.append(...clone.childNodes);
    sample.append(copy);
    band.append(sample);
    blur.append(band);
  }
}

function alignBlur(scroller: HTMLElement, { blur, code }: CodeEdge, scrollLeft: number) {
  const scrollerBounds = scroller.getBoundingClientRect();
  const codeBounds = code.getBoundingClientRect();
  const { font, letterSpacing, tabSize } = getComputedStyle(code);
  setStyle(blur, '--code-edge-sample-x', `${codeBounds.left + scrollLeft - scrollerBounds.right}px`);
  setStyle(blur, '--code-edge-sample-y', `${codeBounds.top - scrollerBounds.top}px`);
  blur.style.font = font;
  blur.style.letterSpacing = letterSpacing;
  blur.style.tabSize = tabSize;
}

function sync(
  scroller: HTMLElement,
  edge: CodeEdge | null,
  measure: boolean,
  reduceMotion: boolean,
) {
  const horizontal = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const clientHeight = scroller.clientHeight;
  const vertical = scroller.scrollHeight - clientHeight;
  const scrollTop = vertical > 1 ? scroller.scrollTop : 0;
  const fade = vertical > 1 ? VERTICAL_FADE_EM * parseFloat(getComputedStyle(scroller).fontSize) : 0;

  if (edge) {
    const scrollLeft = Math.min(horizontal, Math.max(0, scroller.scrollLeft));
    const remaining = horizontal - scrollLeft;
    const scrollbar = `${scroller.offsetHeight - clientHeight}px`;
    const visible = remaining > 1;
    if (measure) edge.needsAlignment = true;
    if (visible) {
      if (!reduceMotion) {
        if (edge.needsAlignment) {
          alignBlur(scroller, edge, scrollLeft);
          if (!edge.blur.firstElementChild) addBlurBands(edge);
          if (nativeScrollTimeline) setStyle(edge.layer, '--code-edge-travel', `${horizontal}px`);
          edge.needsAlignment = false;
        }
        if (!nativeScrollTimeline) setStyle(edge.layer, '--code-edge-offset', `${-scrollLeft}px`);
      }
      setStyle(edge.layer, '--code-scrollbar-height', scrollbar);
    }
    setStyle(edge.layer, '--code-edge-progress', String(visible ? progress(remaining, HORIZONTAL_FADE_PX) : 0));
    edge.layer.toggleAttribute('hidden', !visible);
  }

  if (horizontal > 1 || vertical > 1) {
    if (scroller.getAttribute('tabindex') !== '0') scroller.tabIndex = 0;
  } else {
    scroller.removeAttribute('tabindex');
  }

  scroller.toggleAttribute('data-code-scroll', vertical > 1);
  if (vertical <= 1) return;
  setStyle(scroller, '--code-fade-top', String(progress(scrollTop, fade)));
  setStyle(scroller, '--code-fade-bottom', String(progress(vertical - scrollTop, fade)));
}

let syncBlock: ((root: Element) => void) | undefined;

export function syncCodeBlock(root: Element) {
  syncBlock?.(root);
}

onPageLoad(() => {
  const scope = createPageScope();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const edges = new WeakMap<HTMLElement, CodeEdge | null>();
  const pending = new Map<HTMLElement, boolean>();
  let frame = 0;

  const schedule = (scroller: HTMLElement, measure: boolean) => {
    pending.set(scroller, measure || pending.get(scroller) === true);
    if (frame) return;
    frame = scope.frame(() => {
      frame = 0;
      for (const [scroller, measure] of pending) sync(scroller, edges.get(scroller) ?? null, measure, reducedMotion.matches);
      pending.clear();
    });
  };
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const scroller = target.closest<HTMLElement>('.astro-code');
      if (scroller) schedule(scroller, true);
    }
  });
  scope.add(() => observer.disconnect());

  syncBlock = (root) => {
    for (const scroller of root.querySelectorAll<HTMLElement>('.astro-code')) {
      if (!edges.has(scroller)) {
        const layer = scroller.parentElement?.querySelector<HTMLElement>('[data-code-edge]');
        const blur = layer?.querySelector<HTMLElement>('[data-code-edge-blur]');
        const code = scroller.querySelector('code');
        const edge = layer && blur && code ? { layer, blur, code, needsAlignment: true } : null;
        edges.set(scroller, edge);
        scope.listen(scroller, 'scroll', () => schedule(scroller, false), { passive: true });
        observer.observe(scroller);
        if (edge) observer.observe(edge.code);
      }
      sync(scroller, edges.get(scroller) ?? null, true, reducedMotion.matches);
    }
  };
  const syncPage = () => document.querySelectorAll('[data-code-block]').forEach(syncCodeBlock);
  scope.listen(reducedMotion, 'change', syncPage);
  syncPage();

  return () => {
    syncBlock = undefined;
    scope.destroy();
    pending.clear();
  };
});
