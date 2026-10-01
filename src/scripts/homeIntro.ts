import revealConfig from '../lib/homeRevealConfig.json';

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
  reset: () => void;
};
export type HomeIntroConfig = { durationMs?: number };

const controllerKey = '__vcdHomeIntroController';
const introSeenStorageKey = 'vcd:home-intro-seen';

export function syncHomeIntroActions(surface: HTMLElement, editing: boolean) {
  const tag = editing ? 'span' : 'button';
  surface.querySelectorAll<HTMLElement>('[data-home-intro-okay="true"]').forEach((action) => {
    if (action.tagName.toLowerCase() === tag) return;
    const replacement = surface.ownerDocument.createElement(tag);
    replacement.setAttribute('data-home-intro-okay', 'true');
    if (!editing) replacement.setAttribute('type', 'button');
    replacement.textContent = action.textContent;
    action.replaceWith(replacement);
  });
}

const isInteractive = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('a, button, input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [data-dev-mode-only], [data-dev-image-target], [data-dev-edit-trigger], [data-dev-panel-key], .dev-overlay, .dev-panel'));
};

export function createHomeIntroController(
  surface: HTMLElement,
  home: HTMLElement,
  root: HTMLElement = document.documentElement,
  win: Window = window,
  config: HomeIntroConfig = revealConfig.intro,
): HomeIntroController {
  const readIntroSeen = () => {
    try {
      return win.sessionStorage?.getItem(introSeenStorageKey) === 'true';
    } catch {
      return false;
    }
  };
  const introSeen = readIntroSeen();
  if (!introSeen) {
    try { win.sessionStorage?.setItem(introSeenStorageKey, 'true'); } catch {}
  }
  let state: HomeIntroState = 'pending';
  let disposed = false;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissFocus = false;
  let okay: HTMLElement | null = null;
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
    state = next;
    surface.dataset.state = next;
    surface.hidden = next === 'dismissed';
    surface.inert = next === 'dismissed';
    okay?.removeEventListener('click', onOkay);
    syncHomeIntroActions(surface, next === 'editing');
    okay = surface.querySelector<HTMLElement>('[data-home-intro-okay="true"]');
    if (next !== 'editing') okay?.addEventListener('click', onOkay);
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
    dismissFocus = surface.contains(document.activeElement);
    setState('dismissing');
    finishTimer = setTimeout(() => {
      finishTimer = null;
      if (disposed || state !== 'dismissing') return;
      setState('dismissed');
      win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      const main = document.getElementById('main-content');
      if (dismissFocus && main instanceof HTMLElement) {
        const hadTabIndex = main.hasAttribute('tabindex');
        if (!hadTabIndex) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
        if (!hadTabIndex) main.removeAttribute('tabindex');
      }
      announce('vcd:home-intro-dismissed');
    }, config.durationMs ?? revealConfig.intro.durationMs);
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || win.getSelection?.()?.isCollapsed === false || state !== 'active' || root.classList.contains('is-dev-mode') || isInteractive(event.target)) return;
    dismiss();
    event.preventDefault();
    event.stopPropagation();
  };
  const onOkay = (event: MouseEvent) => {
    if (event.defaultPrevented || state !== 'active' || root.classList.contains('is-dev-mode')) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
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
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    setState('dismissed');
    announce('vcd:intro-layout-sync');
  };
  const teardown = () => {
    if (disposed) return;
    disposed = true;
    cancelFinish();
    surface.removeEventListener('click', onClick);
    okay?.removeEventListener('click', onOkay);
    win.removeEventListener('vcd:dev-mode-change', onModeChange);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
    home.inert = originalInert;
    if (originalAriaHidden === null) home.removeAttribute('aria-hidden');
    else home.setAttribute('aria-hidden', originalAriaHidden);
    document.body.style.overflow = originalOverflow;
    root.style.overflow = originalRootOverflow;
  };
  const reset = () => { if (!disposed) { cancelFinish(); surface.hidden = false; setState(root.classList.contains('is-dev-mode') ? 'editing' : 'active'); } };

  surface.addEventListener('click', onClick);
  win.addEventListener('vcd:dev-mode-change', onModeChange);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  setState(introSeen ? 'dismissed' : root.classList.contains('is-dev-mode') ? 'editing' : 'active');
  announce('vcd:intro-layout-sync');

  return { getState: () => state, dismiss, teardown, reset };
}

export function bindHomeIntro(config: HomeIntroConfig = revealConfig.intro): HomeIntroController | null {
  const surface = document.querySelector<HTMLElement>('[data-home-intro-surface]');
  const home = document.querySelector<HTMLElement>('[data-home-page]');
  if (!surface || !home) return null;
  const existing = (window as Window & Record<string, unknown>)[controllerKey] as HomeIntroController | undefined;
  existing?.teardown();
  const controller = createHomeIntroController(surface, home, document.documentElement, window, config);
  (window as Window & Record<string, unknown>)[controllerKey] = controller;
  import.meta.hot?.dispose(() => controller.teardown());
  return controller;
}
