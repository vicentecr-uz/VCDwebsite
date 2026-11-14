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
  let animations: Animation[] = [];
  let previousOverflow = '';
  const inertSiblings: HTMLElement[] = [];

  const syncFrame = () => { frame.inert = narrow.matches && !expanded; };
  const restorePage = () => {
    document.documentElement.style.overflow = previousOverflow;
    inertSiblings.splice(0).forEach((sibling) => { sibling.inert = false; });
  };
  const stopMotion = () => animations.splice(0).forEach((animation) => animation.cancel());
  const setExpanded = (next: boolean) => {
    if (next === expanded) return;
    const interruptedClip = animations.length ? getComputedStyle(surface).clipPath : null;
    const from = surface.getBoundingClientRect();
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
    syncFrame();

    const finish = () => {
      if (!expanded) {
        surface.hidePopover();
        restorePage();
      }
      stopMotion();
    };
    if (reducedMotion.matches) {
      finish();
      button.focus({ preventScroll: true });
      return;
    }

    const to = next ? surface.getBoundingClientRect() : slot.getBoundingClientRect();
    const toButton = button.getBoundingClientRect();
    const viewport = surface.getBoundingClientRect();
    const buttonX = next ? toButton.left : to.right - (viewport.right - toButton.left);
    const buttonY = next ? toButton.top : narrow.matches
      ? to.top + toButton.top - viewport.top
      : to.bottom - (viewport.bottom - toButton.top);
    const clip = (rect: DOMRect, radius: string) =>
      `inset(${rect.top - viewport.top}px ${viewport.right - rect.right}px ${viewport.bottom - rect.bottom}px ${rect.left - viewport.left}px round ${radius})`;
    const radius = getComputedStyle(slot).borderTopLeftRadius;
    const timing = { duration: next ? 320 : 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
    const frameMotion = surface.animate(
      [{ clipPath: interruptedClip ?? clip(from, next ? radius : '0px') }, { clipPath: clip(to, next ? '0px' : radius) }],
      timing,
    );
    const buttonMotion = button.animate(
      [
        { transform: `translate(${fromButton.left - toButton.left}px, ${fromButton.top - toButton.top}px)` },
        { transform: `translate(${buttonX - toButton.left}px, ${buttonY - toButton.top}px)` },
      ],
      timing,
    );
    animations = [frameMotion, buttonMotion];
    frameMotion.onfinish = finish;
    button.focus({ preventScroll: true });
  };

  button.addEventListener('click', () => setExpanded(!expanded), { signal });
  window.addEventListener('keydown', (event) => {
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
    if (!animations.length) return;
    if (!expanded) {
      surface.hidePopover();
      restorePage();
    }
    stopMotion();
  }, { signal });
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
