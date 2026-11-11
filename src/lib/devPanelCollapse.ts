interface PanelCollapseOptions {
  beforeChange?: () => void;
  afterStateChange?: () => void;
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

  const clearMorph = () => {
    panel.classList.remove('is-dev-overlay-morphing');
    panel.style.removeProperty('--dev-overlay-morph-body-height');
  };

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
    const fromRadius = win.getComputedStyle(panel).borderRadius;
    const fromOpacity = wasMinimized && !interrupted ? 0 : Number(win.getComputedStyle(body).opacity);
    let morphBodyHeight = minimized ? body.getBoundingClientRect().height : 0;
    cancel();
    clearMorph();
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
    panel.classList.toggle('is-minimized', minimized);
    body.hidden = minimized;
    body.inert = minimized;
    button?.setAttribute('aria-expanded', String(!minimized));
    button?.setAttribute('aria-label', minimized ? 'Expand' : 'Minimize');
    if (button) button.title = minimized ? 'Expand' : 'Minimize';
    button?.classList.toggle('dev-overlay__light--minimize', !minimized);
    button?.classList.toggle('dev-overlay__light--expand', minimized);
    options.afterStateChange?.();

    const toHeight = panel.getBoundingClientRect().height;
    const toRadius = win.getComputedStyle(panel).borderRadius;
    if (!minimized) morphBodyHeight = body.getBoundingClientRect().height;
    if (Number.isFinite(morphBodyHeight) && morphBodyHeight >= 0) {
      panel.style.setProperty('--dev-overlay-morph-body-height', `${morphBodyHeight}px`);
    }
    const finish = () => {
      if (destroyed || current !== generation) return;
      body.hidden = minimized;
      clearMorph();
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
    const timing = { duration, easing: 'cubic-bezier(0.25, 1, 0.5, 1)', fill: 'both' as FillMode };
    body.hidden = false;
    panel.classList.add('is-dev-overlay-morphing');
    let clipKeyframes: Keyframe[] | null = null;
    if (!reduced && panel.classList.contains('dev-overlay')) {
      const bodyRect = body.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const bodyHeight = bodyRect.height;
      const bodyTop = bodyRect.top - panelRect.top;
      const paddingBottom = Number.parseFloat(win.getComputedStyle(panel).paddingBottom) || 0;
      const bodyStyles = win.getComputedStyle(body);
      // The native body already clips to its shaped corners. The moving inset
      // only limits how much of the body is revealed above the panel padding.
      const corners = bodyStyles.getPropertyValue('corner-shape') === 'superellipse(1.33)'
        ? ''
        : ` round 0 0 ${bodyStyles.borderBottomLeftRadius} ${bodyStyles.borderBottomRightRadius}`;
      const inset = (height: number) => bodyHeight - (height - bodyTop - paddingBottom);
      clipKeyframes = [
        { clipPath: `inset(0 0 ${inset(fromHeight)}px 0${corners})` },
        { clipPath: `inset(0 0 ${inset(toHeight)}px 0${corners})` },
      ];
    }
    if (!reduced) {
      // Only this bounded panel changes size; animating its box avoids scaling text and controls.
      animations.push(panel.animate([
        { height: `${fromHeight}px`, borderRadius: fromRadius },
        { height: `${toHeight}px`, borderRadius: toRadius },
      ], timing));
    } else {
      // Keep the final geometry while the body fades, including the header-only collapsed size.
      animations.push(panel.animate([{ height: `${toHeight}px` }, { height: `${toHeight}px` }], { duration, fill: 'both' }));
    }
    animations.push(body.animate([{ opacity: fromOpacity }, { opacity: minimized ? 0 : 1 }], { duration, easing: 'ease', fill: 'both' }));
    if (clipKeyframes) animations.push(body.animate(clipKeyframes, timing));
    void Promise.all(animations.map((animation) => animation.finished)).then(finish, () => {});
  };

  return {
    set,
    get animating() { return animating; },
    destroy() {
      destroyed = true;
      cancel();
      animating = false;
      clearMorph();
      body.hidden = panel.classList.contains('is-minimized');
    },
  };
}
