interface HeaderMenuDemoOptions {
  trigger: HTMLElement;
  template: HTMLTemplateElement;
  open: () => void;
  close: (force?: boolean) => void;
  isEditing: () => boolean;
}

const SEEN_KEY = 'vcd:header-menu-demo-seen';
const DELAY = 1200;

export function createHeaderMenuDemo({ trigger, template, open, close, isEditing }: HeaderMenuDemoOptions) {
  const mobileMq = window.matchMedia('(max-width: 40em)');
  const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let overlay: HTMLElement | null = null;
  let pointer: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
  let menuOwned = false;
  let revealListener: (() => void) | undefined;
  let introListener: (() => void) | undefined;
  const introVisible = () => {
    const intro = document.querySelector<HTMLElement>('[data-home-intro-surface]');
    return Boolean(intro && !intro.hidden && intro.dataset.state !== 'dismissed');
  };
  let lifecycleActive = false;
  const animations: Animation[] = [];
  let finishWait: (() => void) | undefined;

  const hasSeen = () => {
    try { return window.sessionStorage.getItem(SEEN_KEY) === 'true'; } catch { return false; }
  };
  const markSeen = () => {
    try { window.sessionStorage.setItem(SEEN_KEY, 'true'); } catch { /* storage is optional */ }
  };
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const cancelAnimations = () => { animations.splice(0).forEach((animation) => animation.cancel()); };
  const removeListeners = () => {
    window.removeEventListener('click', cancelFromUser, true);
    window.removeEventListener('resize', cancelFromUser, true);
    window.removeEventListener('pagehide', cancelFromUser, true);
    window.removeEventListener('vcd:dev-mode-change', cancelFromEdit as EventListener);
    document.removeEventListener('visibilitychange', cancelFromVisibility, true);
    document.removeEventListener('header:navigation-start', cancelFromUser, true);
    document.removeEventListener('header:force-close', cancelFromUser, true);
    mobileMq.removeEventListener('change', cancelFromUser);
    reduceMq.removeEventListener('change', cancelFromUser);
    lifecycleActive = false;
  };
  const cleanup = (interrupted = false, preserveMenu = false) => {
    token += 1;
    clearTimer();
    finishWait?.();
    finishWait = undefined;
    cancelAnimations();
    if (revealListener) window.removeEventListener('vcd:initial-reveal-complete', revealListener);
    revealListener = undefined;
    if (introListener) window.removeEventListener('vcd:home-intro-dismissed', introListener);
    introListener = undefined;
    removeListeners();
    if (interrupted && menuOwned && !preserveMenu && !trigger.matches(':hover') && !trigger.contains(document.activeElement)) close(true);
    menuOwned = false;
    overlay?.remove();
    overlay = null;
    pointer = null;
  };
  function cancelFromUser(event?: Event) {
    if (!lifecycleActive) return;
    if (introVisible() && event?.type === 'click') return;
    const preserveMenu = Boolean(event?.type === 'click' && event.target instanceof Node && trigger.contains(event.target));
    cleanup(true, preserveMenu);
  }
  function cancelFromVisibility() { if (document.visibilityState !== 'visible') cancelFromUser(); }
  function cancelFromEdit(event: Event) {
    if ((event as CustomEvent<{ active?: boolean }>).detail?.active) cancelFromUser();
  }
  const addListeners = () => {
    window.addEventListener('click', cancelFromUser, true);
    window.addEventListener('resize', cancelFromUser, true);
    window.addEventListener('pagehide', cancelFromUser, true);
    window.addEventListener('vcd:dev-mode-change', cancelFromEdit as EventListener);
    document.addEventListener('visibilitychange', cancelFromVisibility, true);
    document.addEventListener('header:navigation-start', cancelFromUser, true);
    document.addEventListener('header:force-close', cancelFromUser, true);
    mobileMq.addEventListener('change', cancelFromUser);
    reduceMq.addEventListener('change', cancelFromUser);
  };
  const wait = (ms: number) => new Promise<void>((resolve) => {
    finishWait = resolve;
    timer = setTimeout(() => { timer = undefined; finishWait = undefined; resolve(); }, ms);
  });
  const animate = (element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions, currentToken: number) => {
    if (currentToken !== token) return Promise.resolve();
    const animation = element.animate(keyframes, options);
    animations.push(animation);
    animation.finished.catch(() => undefined);
    return animation.finished;
  };
  const point = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const outsidePoint = () => {
    const surface = trigger.querySelector<HTMLElement>('.header-trigger__panel') ?? trigger;
    const rect = surface.getBoundingClientRect();
    return {
      x: Math.max(16, Math.min(window.innerWidth - 16, rect.right + 48)),
      y: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 48)),
    };
  };
  const move = (from: { x: number; y: number }, to: { x: number; y: number }, duration: number, currentToken: number, easing = 'cubic-bezier(.22,1,.36,1)') => {
    if (!pointer) return Promise.resolve();
    return animate(pointer, [
      { transform: `translate(${from.x}px, ${from.y}px)` },
      { transform: `translate(${to.x}px, ${to.y}px)` },
    ], { duration, easing, fill: 'forwards' }, currentToken);
  };
  const run = async (currentToken: number) => {
    if (isEditing() || introVisible() || document.visibilityState === 'hidden' || trigger.dataset.menuOpen === 'true' || trigger.dataset.headerTitlePending !== undefined || trigger.matches(':hover') || trigger.contains(document.activeElement)) return cleanup();
    markSeen();
    overlay = template.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    if (!overlay) return cleanup();
    document.body.append(overlay);
    pointer = overlay.querySelector<HTMLElement>(mobileMq.matches ? '[data-header-menu-demo-finger]' : '[data-header-menu-demo-cursor]');
    if (!pointer) return cleanup();
    const start = point(trigger.querySelector<HTMLElement>('.header-trigger__brand') ?? trigger);
    let away = outsidePoint();
    pointer.style.opacity = '0';
    pointer.dataset.cursorState = 'arrow';
    if (currentToken !== token) return;
    if (reduceMq.matches) {
      pointer.style.transform = `translate(${start.x}px, ${start.y}px)`;
      if (!mobileMq.matches) pointer.dataset.cursorState = 'pointer';
      await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      open(); menuOwned = trigger.dataset.menuOpen === 'true';
      if (!menuOwned) return cleanup();
      await wait(1000);
      if (currentToken !== token) return;
      away = outsidePoint();
      await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      pointer.style.transform = `translate(${away.x}px, ${away.y}px)`;
      pointer.dataset.cursorState = 'arrow';
      await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      if (menuOwned) close(true); menuOwned = false;
      await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }, currentToken);
    } else if (mobileMq.matches) {
      const entrance = {
        x: window.innerWidth * (0.5 + (Math.random() - 0.5) * 0.16),
        y: window.innerHeight * (0.5 + (Math.random() - 0.5) * 0.16),
      };
      pointer.style.transform = `translate(${entrance.x}px, ${entrance.y}px)`;
      await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      await wait(150);
      if (currentToken !== token) return;
      await move(entrance, start, 600, currentToken, 'cubic-bezier(.645,.045,.355,1)');
      if (currentToken !== token) return;
      await animate(pointer, [{ transform: `translate(${start.x}px, ${start.y}px) scale(.88)` }], { duration: 120, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      open(); menuOwned = trigger.dataset.menuOpen === 'true';
      if (!menuOwned) return cleanup();
      await animate(pointer, [{ transform: `translate(${start.x}px, ${start.y}px) scale(1)` }], { duration: 120, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      await wait(1000);
      if (currentToken !== token) return;
      away = outsidePoint();
      await move(start, away, 450, currentToken, 'cubic-bezier(.645,.045,.355,1)');
      if (currentToken !== token) return;
      await animate(pointer, [{ transform: `translate(${away.x}px, ${away.y}px) scale(.88)` }], { duration: 120, fill: 'forwards' }, currentToken);
      if (currentToken !== token) return;
      if (menuOwned) close(true); menuOwned = false;
      await animate(pointer, [{ opacity: 1, transform: `translate(${away.x}px, ${away.y}px) scale(.88)` }, { opacity: 0, transform: `translate(${away.x}px, ${away.y}px) scale(1)` }], { duration: 200, fill: 'forwards' }, currentToken);
    } else {
      pointer.style.transform = `translate(${away.x}px, ${away.y}px)`;
      await Promise.all([
        move(away, start, 500, currentToken),
        animate(pointer, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' }, currentToken),
      ]);
      if (currentToken !== token) return;
      pointer.dataset.cursorState = 'pointer';
      open(); menuOwned = trigger.dataset.menuOpen === 'true';
      if (!menuOwned) return cleanup();
      if (currentToken !== token) return;
      await wait(1000);
      if (currentToken !== token) return;
      away = outsidePoint();
      pointer.dataset.cursorState = 'arrow';
      await move(start, away, 450, currentToken);
      if (currentToken !== token) return;
      if (menuOwned) close(true); menuOwned = false;
      await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }, currentToken);
    }
    if (currentToken === token) cleanup();
  };
  const schedule = () => {
    if (hasSeen() || isEditing() || document.visibilityState === 'hidden' || trigger.matches(':hover') || trigger.contains(document.activeElement)) return cleanup();
    const currentToken = token;
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    void fontsReady.then(() => {
      if (currentToken !== token) return;
      if (isEditing() || document.visibilityState === 'hidden') return cleanup();
      timer = setTimeout(() => {
        timer = undefined;
        if (currentToken !== token) return;
        void run(currentToken).catch(() => { if (currentToken === token) cleanup(true); });
      }, DELAY);
    });
  };
  const start = () => {
    if (hasSeen() || lifecycleActive) return;
    lifecycleActive = true;
    addListeners();
    const ready = () => {
      if (!lifecycleActive) return;
      const reveal = document.querySelector<HTMLElement>('[data-vcd-initial-reveal]');
      if (reveal?.dataset.vcdInitialReveal === 'running') {
        if (!revealListener) {
          revealListener = () => { revealListener = undefined; ready(); };
          window.addEventListener('vcd:initial-reveal-complete', revealListener, { once: true });
        }
        return;
      }
      if (introVisible()) {
        if (!introListener) {
          introListener = () => { introListener = undefined; ready(); };
          window.addEventListener('vcd:home-intro-dismissed', introListener, { once: true });
        }
        return;
      }
      schedule();
    };
    ready();
  };
  return { start, cancel: () => cleanup(true) };
}
