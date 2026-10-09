interface PanelCollapseOptions {
  beforeChange?: () => void;
  afterChange?: () => void;
}

export function createDevPanelCollapse(panel: HTMLElement, options: PanelCollapseOptions = {}) {
  const body = panel.querySelector<HTMLElement>('[data-overlay-body]')!;
  const button = panel.querySelector<HTMLButtonElement>('[data-minimize-toggle]');
  const win = panel.ownerDocument.defaultView!;
  let animations: Animation[] = [];
  let generation = 0;
  let animating = false;
  let destroyed = false;

  const cancel = () => {
    generation += 1;
    animations.forEach((animation) => animation.cancel());
    animations = [];
  };

  const set = (minimized: boolean, animate = true) => {
    if (destroyed) return;
    const wasMinimized = panel.classList.contains('is-minimized');
    const interrupted = animating;
    if (animate && minimized === wasMinimized && !interrupted) return;
    const fromHeight = panel.getBoundingClientRect().height;
    const fromOpacity = wasMinimized && !interrupted ? 0 : Number(win.getComputedStyle(body).opacity);
    cancel();
    const current = generation;
    if (animate) options.beforeChange?.();

    if (minimized) {
      const height = panel.style.height;
      if (!wasMinimized && height && Number.parseFloat(height) >= 72) panel.dataset.restoredHeight = height;
      panel.style.height = '';
      panel.style.maxHeight = '';
      if (body.contains(panel.ownerDocument.activeElement)) button?.focus({ preventScroll: true });
    } else if (panel.dataset.restoredHeight) {
      panel.style.height = panel.dataset.restoredHeight;
      delete panel.dataset.restoredHeight;
    }
    panel.classList.remove('is-dev-overlay-morphing');
    panel.classList.toggle('is-minimized', minimized);
    body.hidden = minimized;
    body.inert = minimized;
    button?.setAttribute('aria-expanded', String(!minimized));
    button?.setAttribute('aria-label', minimized ? 'Expand' : 'Minimize');
    if (button) button.title = minimized ? 'Expand' : 'Minimize';
    button?.classList.toggle('dev-overlay__light--minimize', !minimized);
    button?.classList.toggle('dev-overlay__light--expand', minimized);

    const toHeight = panel.getBoundingClientRect().height;
    const finish = () => {
      if (destroyed || current !== generation) return;
      body.hidden = minimized;
      panel.classList.remove('is-dev-overlay-morphing');
      animations.forEach((animation) => animation.cancel());
      animations = [];
      animating = false;
      if (animate) options.afterChange?.();
    };
    if (!animate || !fromHeight || !toHeight || typeof panel.animate !== 'function') {
      finish();
      return;
    }
    animating = true;
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = 250;
    body.hidden = false;
    panel.classList.add('is-dev-overlay-morphing');
    if (!reduced) {
      // Only this bounded panel changes size; animating its box avoids scaling text and controls.
      animations.push(panel.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], {
        duration, easing: 'cubic-bezier(0.25, 1, 0.5, 1)', fill: 'both',
      }));
    } else {
      // Keep the final geometry while the body fades, including the header-only collapsed size.
      animations.push(panel.animate([{ height: `${toHeight}px` }, { height: `${toHeight}px` }], { duration, fill: 'both' }));
    }
    animations.push(body.animate([{ opacity: fromOpacity }, { opacity: minimized ? 0 : 1 }], { duration, easing: 'ease', fill: 'both' }));
    void Promise.all(animations.map((animation) => animation.finished)).then(finish, () => {});
  };

  return {
    set,
    get animating() { return animating; },
    destroy() {
      destroyed = true;
      cancel();
      animating = false;
      panel.classList.remove('is-dev-overlay-morphing');
      body.hidden = panel.classList.contains('is-minimized');
    },
  };
}
