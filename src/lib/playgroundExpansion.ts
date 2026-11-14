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
    for (const property of ['top', 'left', 'width', 'height', 'border-radius']) {
      surface.style.removeProperty(property);
    }
  };
  const setExpanded = (next: boolean) => {
    if (next === expanded) return;
    const from = surface.getBoundingClientRect();
    const fromRadius = parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0;
    cancelAnimationFrame(raf);
    raf = 0;
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

    stopMotion();
    const to = (next ? surface : slot).getBoundingClientRect();
    const targetRadius = next ? 0 : parseFloat(getComputedStyle(slot).borderTopLeftRadius) || 0;
    const start = performance.now();
    const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
    const tick = (now: number) => {
      const x = viewportMorphProgress(now - start);
      if (x === 1) { finish(); return; }
      Object.assign(surface.style, {
        top: `${lerp(from.top, to.top, x)}px`,
        left: `${lerp(from.left, to.left, x)}px`,
        width: `${lerp(from.width, to.width, x)}px`,
        height: `${lerp(from.height, to.height, x)}px`,
        borderRadius: `${lerp(fromRadius, targetRadius, x)}px`,
      });
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
