export type HomeIntroState = 'pending' | 'active' | 'editing' | 'dismissing' | 'dismissed';

export function nextHomeIntroModeState(state: HomeIntroState, editActive: boolean): HomeIntroState {
  if (state === 'dismissed') return state;
  if (editActive) return state === 'dismissing' || state === 'pending' ? 'editing' : state === 'active' ? 'editing' : state;
  return state === 'editing' || state === 'pending' ? 'active' : state;
}

type HomeIntroController = {
  getState: () => HomeIntroState;
  dismiss: () => void;
  teardown: () => void;
};

const controllerKey = '__vcdHomeIntroController';

const isInteractive = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('a, button, input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [data-dev-mode-only], [data-dev-image-target], [data-dev-edit-trigger], [data-dev-panel-key], .dev-overlay, .dev-panel'));
};

export function createHomeIntroController(
  surface: HTMLElement,
  home: HTMLElement,
  root: HTMLElement = document.documentElement,
  win: Window = window,
): HomeIntroController {
  let state: HomeIntroState = 'pending';
  let disposed = false;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;
  const originalInert = home.inert;
  const originalOverflow = document.body.style.overflow;
  const originalRootOverflow = root.style.overflow;
  const originalAriaHidden = home.getAttribute('aria-hidden');
  let previousSurface = '';

  const announce = (name: string) => win.dispatchEvent(new CustomEvent(name, {
    detail: { surface: state === 'dismissed' ? 'home' : 'home-intro', state },
  }));
  const setState = (next: HomeIntroState) => {
    if (disposed) return;
    hideCursor();
    state = next;
    surface.dataset.state = next;
    surface.hidden = next === 'dismissed';
    surface.inert = next === 'dismissed';
    const veilVisible = next !== 'dismissed';
    home.inert = veilVisible || originalInert;
    if (veilVisible) home.setAttribute('aria-hidden', 'true');
    else if (originalAriaHidden === null) home.removeAttribute('aria-hidden');
    else home.setAttribute('aria-hidden', originalAriaHidden);
    document.body.style.overflow = veilVisible ? 'hidden' : originalOverflow;
    root.style.overflow = veilVisible ? 'hidden' : originalRootOverflow;
    const nextSurface = veilVisible ? 'home-intro' : 'home';
    if (nextSurface !== previousSurface) {
      previousSurface = nextSurface;
      win.dispatchEvent(new CustomEvent('vcd:page-surface-change', { detail: { documentKey: nextSurface } }));
    }
  };

  const cancelFinish = () => {
    if (finishTimer !== null) clearTimeout(finishTimer);
    finishTimer = null;
  };

  const dismiss = () => {
    if (disposed || state !== 'active' || root.classList.contains('is-dev-mode')) return;
    cancelFinish();
    setState('dismissing');
    finishTimer = setTimeout(() => {
      finishTimer = null;
      if (disposed || state !== 'dismissing') return;
      const hadFocus = surface.contains(document.activeElement);
      setState('dismissed');
      const main = document.getElementById('main-content');
      if (hadFocus && main instanceof HTMLElement) {
        const hadTabIndex = main.hasAttribute('tabindex');
        if (!hadTabIndex) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
        if (!hadTabIndex) main.removeAttribute('tabindex');
      }
      announce('vcd:home-intro-dismissed');
    }, 250);
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || win.getSelection?.()?.isCollapsed === false || state !== 'active' || root.classList.contains('is-dev-mode') || isInteractive(event.target)) return;
    dismiss();
  };
  const onOkay = () => dismiss();
  const onPointerMove = (event: PointerEvent) => {
    const cursor = surface.querySelector<HTMLElement>('[data-home-intro-cursor]');
    if (event.pointerType !== 'mouse' || state !== 'active' || !surface.matches(':hover') || !cursor || !win.matchMedia('(pointer: fine)').matches) return;
    if (isInteractive(event.target)) { cursor.style.display = 'none'; return; }
    const rect = surface.getBoundingClientRect();
    cursor.style.display = 'block';
    cursor.style.transform = `translate(${event.clientX - rect.left + 12}px, ${event.clientY - rect.top + 8}px)`;
  };
  const hideCursor = () => {
    const cursor = surface.querySelector<HTMLElement>('[data-home-intro-cursor]');
    if (cursor) cursor.style.display = 'none';
  };
  const onModeChange = (event: Event) => {
    const active = (event as CustomEvent<{ active?: boolean }>).detail?.active === true;
    if (active) {
      cancelFinish();
    }
    const next = nextHomeIntroModeState(state, active);
    if (next !== state) setState(next);
  };
  const restoreAfterPageHide = () => {
    cancelFinish();
    home.inert = originalInert;
    if (originalAriaHidden === null) home.removeAttribute('aria-hidden');
    else home.setAttribute('aria-hidden', originalAriaHidden);
    document.body.style.overflow = originalOverflow;
    root.style.overflow = originalRootOverflow;
  };
  const onPageHide = () => restoreAfterPageHide();
  const onPageShow = () => {
    setState(root.classList.contains('is-dev-mode') ? 'editing' : 'active');
    surface.hidden = false;
    announce('vcd:intro-layout-sync');
  };
  const teardown = () => {
    if (disposed) return;
    disposed = true;
    cancelFinish();
    hideCursor();
    surface.removeEventListener('click', onClick);
    surface.querySelector('[data-home-intro-okay]')?.removeEventListener('click', onOkay);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerleave', hideCursor);
    surface.removeEventListener('pointercancel', hideCursor);
    win.removeEventListener('vcd:dev-mode-change', onModeChange);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
    home.inert = originalInert;
    if (originalAriaHidden === null) home.removeAttribute('aria-hidden');
    else home.setAttribute('aria-hidden', originalAriaHidden);
    document.body.style.overflow = originalOverflow;
    root.style.overflow = originalRootOverflow;
  };

  surface.addEventListener('click', onClick);
  surface.querySelector('[data-home-intro-okay]')?.addEventListener('click', onOkay);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerleave', hideCursor);
  surface.addEventListener('pointercancel', hideCursor);
  win.addEventListener('vcd:dev-mode-change', onModeChange);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  setState(root.classList.contains('is-dev-mode') ? 'editing' : 'active');
  announce('vcd:intro-layout-sync');

  return { getState: () => state, dismiss, teardown };
}

export function bindHomeIntro(): HomeIntroController | null {
  const surface = document.querySelector<HTMLElement>('[data-home-intro-surface]');
  const home = document.querySelector<HTMLElement>('[data-home-page]');
  if (!surface || !home) return null;
  const existing = (window as Window & Record<string, unknown>)[controllerKey] as HomeIntroController | undefined;
  existing?.teardown();
  const controller = createHomeIntroController(surface, home);
  (window as Window & Record<string, unknown>)[controllerKey] = controller;
  import.meta.hot?.dispose(() => controller.teardown());
  return controller;
}
