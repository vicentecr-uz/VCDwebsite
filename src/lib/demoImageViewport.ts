import type { ImageViewport } from './responsiveImage';

export type DemoImageViewport = ImageViewport;
const widths: Record<DemoImageViewport, number> = { desktop: 1024, tablet: 834, mobile: 390 };
interface Options { root: HTMLElement; column: HTMLElement; iframe: HTMLIFrameElement }

export function createDemoImageViewport({ root, column, iframe }: Options) {
  const ownerWindow = root.ownerDocument.defaultView!;
  const shell = iframe.parentElement as HTMLElement;
  let viewport: DemoImageViewport = 'desktop';
  let scale = 1;
  let fade: Animation | undefined;
  const reducedMotion = ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const mobileViewport = ownerWindow.matchMedia?.('(max-width: 40em)');
  const syncButtons = () => root.querySelectorAll<HTMLElement>('[data-crop-viewport]').forEach((button) => {
    const selected = button.dataset.cropViewport === viewport;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const measureScale = () => {
    const width = widths[viewport];
    return mobileViewport?.matches
      ? column.getBoundingClientRect().width / width
      : Math.min(1, column.getBoundingClientRect().width / widths.desktop);
  };
  const render = () => {
    const width = widths[viewport];
    shell.style.width = `${width * scale}px`;
    shell.style.height = `${900 * scale}px`;
    iframe.style.width = `${width}px`;
    iframe.style.transform = `scale(${scale})`;
  };
  const measure = () => {
    scale = measureScale();
    const shellTransition = shell.style.transition;
    const iframeTransition = iframe.style.transition;
    shell.style.transition = 'none';
    iframe.style.transition = 'none';
    render();
    void shell.offsetWidth;
    shell.style.transition = shellTransition;
    iframe.style.transition = iframeTransition;
  };
  const observer = new ownerWindow.ResizeObserver(measure);
  observer.observe(column);
  const setViewport = (next: DemoImageViewport) => {
    if (!(next in widths)) return;
    viewport = next;
    if (reducedMotion) {
      fade?.cancel();
      fade = iframe.animate?.([{ opacity: 0.65 }, { opacity: 1 }], { duration: 120, easing: 'ease' });
    }
    scale = measureScale();
    render();
    syncButtons();
  };
  measure();
  syncButtons();
  return {
    setViewport,
    getViewport: () => viewport,
    destroy() {
      observer.disconnect();
      fade?.cancel();
      shell.style.removeProperty('width'); shell.style.removeProperty('height'); shell.style.removeProperty('transition');
      iframe.style.removeProperty('width'); iframe.style.removeProperty('transform'); iframe.style.removeProperty('opacity'); iframe.style.removeProperty('transition');
    },
  };
}
