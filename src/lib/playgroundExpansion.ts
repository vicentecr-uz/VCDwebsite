import { viewportMorphProgress } from './viewportMorph';

export function bindPlaygroundExpansion(
  surface: HTMLElement,
  button: HTMLButtonElement,
  frame: HTMLIFrameElement,
  signal: AbortSignal,
) {
  const slot = surface.parentElement!;
  const narrow = matchMedia('(max-width: 40em)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let expanded = false;
  let raf = 0;
  let previousOverflow = '';
  const inertSiblings: HTMLElement[] = [];

  const syncFrame = () => {
    frame.inert = Boolean(raf) || (narrow.matches && !expanded);
    frame.contentWindow?.postMessage({ type: 'vcd:editor-playground-mode', desktop: expanded && !narrow.matches }, location.origin);
  };
  const restorePage = () => {
    document.documentElement.style.overflow = previousOverflow;
    inertSiblings.splice(0).forEach((sibling) => { sibling.inert = false; });
  };
  const stopMotion = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    surface.style.removeProperty('clip-path');
    button.style.removeProperty('transform');
    for (const property of ['position', 'width', 'height', 'top', 'left']) frame.style.removeProperty(property);
  };
  let visibleBounds: DOMRect;
  let visibleRadius = 0;
  const setExpanded = (next: boolean) => {
    if (next === expanded) return;
    const frameFrom = frame.getBoundingClientRect();
    const viewportFrom = surface.getBoundingClientRect();
    const slotFrom = slot.getBoundingClientRect();
    const from = raf ? visibleBounds : viewportFrom;
    const fromRadius = raf ? visibleRadius : expanded ? 0 : parseFloat(getComputedStyle(slot).borderTopLeftRadius) || 0;
    const fromButton = button.getBoundingClientRect();
    stopMotion();
    expanded = next;
    button.setAttribute('aria-expanded', String(next));
    button.setAttribute('aria-label', next ? 'Exit fullscreen' : 'Expand demo');
    if (next && !surface.matches(':popover-open')) {
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      surface.showPopover();
      for (let branch = surface; branch.parentElement; branch = branch.parentElement) {
        const parent = branch.parentElement;
        for (const sibling of parent.children) {
          if (sibling instanceof HTMLElement && sibling !== branch && !sibling.inert) {
            sibling.inert = true;
            inertSiblings.push(sibling);
          }
        }
        if (parent === document.body) break;
      }
    }
    frame.inert = true;

    const finish = () => {
      if (!expanded) {
        surface.hidePopover();
        restorePage();
      }
      stopMotion();
      syncFrame();
    };
    if (reducedMotion.matches) {
      finish();
      button.focus({ preventScroll: true });
      return;
    }

    const viewport = surface.getBoundingClientRect();
    const to = next ? viewport : slotFrom;
    const toButton = button.getBoundingClientRect();
    const buttonX = to.right - (viewport.right - toButton.left);
    const buttonY = to.top + toButton.top - viewport.top;
    const targetRadius = next ? 0 : parseFloat(getComputedStyle(slot).borderTopLeftRadius) || 0;
    // Keep the existing responsive layout and its screen position until the spring settles.
    Object.assign(frame.style, {
      position: 'absolute', width: `${frameFrom.width}px`, height: `${frameFrom.height}px`,
      left: `${frameFrom.left - viewport.left}px`, top: `${frameFrom.top - viewport.top}px`,
    });
    const start = performance.now();
    const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
    const tick = (now: number) => {
      const x = viewportMorphProgress(now - start);
      if (x === 1) { finish(); return; }
      visibleBounds = new DOMRect(
        lerp(from.left, to.left, x), lerp(from.top, to.top, x),
        lerp(from.width, to.width, x), lerp(from.height, to.height, x),
      );
      visibleRadius = lerp(fromRadius, targetRadius, x);
      const rect = visibleBounds;
      surface.style.clipPath = `inset(${rect.top - viewport.top}px ${viewport.right - rect.right}px ${viewport.bottom - rect.bottom}px ${rect.left - viewport.left}px round ${visibleRadius}px)`;
      button.style.transform = `translate(${lerp(fromButton.left, buttonX, x) - toButton.left}px, ${lerp(fromButton.top, buttonY, x) - toButton.top}px)`;
      raf = requestAnimationFrame(tick);
    };
    tick(start);
    button.focus({ preventScroll: true });
  };

  button.addEventListener('click', () => setExpanded(!expanded), { signal });
  window.addEventListener('keydown', (event) => {
    if (expanded && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      event.code === 'KeyE' && !event.repeat && !event.isComposing && !event.defaultPrevented) {
      event.preventDefault();
      frame.contentWindow?.postMessage({ type: 'vcd:editor-playground-toggle-preview' }, location.origin);
    }
    if (expanded && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      setExpanded(false);
    }
  }, { signal });
  window.addEventListener('message', (event) => {
    if (expanded && event.origin === location.origin && event.source === frame.contentWindow &&
      event.data === 'vcd:editor-playground-exit') setExpanded(false);
  }, { signal });
  window.addEventListener('resize', () => {
    if (!raf) return;
    if (!expanded) {
      surface.hidePopover();
      restorePage();
    }
    stopMotion();
    syncFrame();
  }, { signal });
  frame.addEventListener('load', syncFrame, { signal });
  narrow.addEventListener('change', syncFrame, { signal });
  signal.addEventListener('abort', () => {
    stopMotion();
    if (surface.matches(':popover-open') || inertSiblings.length) {
      surface.hidePopover();
      restorePage();
    }
  }, { once: true });
  syncFrame();
}
