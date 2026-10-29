import config from './headerMenuDemoConfig.json';
import homeRevealConfig from './homeRevealConfig.json';

interface HeaderMenuDemoOptions {
  trigger: HTMLElement;
  template: HTMLTemplateElement;
  open: () => void;
  close: (force?: boolean) => void;
  isEditing: () => boolean;
}

const SEEN_KEY = 'vcd:header-menu-demo-seen';
const HINT_DELAY = 1200;
const CURSOR_FADE_EASING = 'cubic-bezier(.215,.61,.355,1)';

// Chosen from the spotlight prototype: proportional eased feather, opacity exit,
// and asymmetric cursor travel. Fixed feather, expanding exit, and timed glyphs
// were rejected; the approved values live in headerMenuDemoConfig.json.
export function createHeaderMenuDemo({ trigger, template, open, close, isEditing }: HeaderMenuDemoOptions) {
  const mobileMq = window.matchMedia('(max-width: 40em)');
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set<Animation>();
  let scene: HTMLElement | undefined;
  let controller: AbortController | undefined;
  let cursorFrame: number | undefined;
  let menuOwned = false;
  let idle = false;

  const hasSeen = () => {
    try { return window.sessionStorage.getItem(SEEN_KEY) === 'true'; } catch { return false; }
  };
  const eligible = () => !isEditing() && !document.hidden
    && trigger.dataset.menuOpen !== 'true' && trigger.dataset.headerTitlePending === undefined
    && !trigger.matches(':hover') && !trigger.contains(document.activeElement);
  const introVisible = () => {
    const intro = document.querySelector<HTMLElement>('[data-home-intro-surface]');
    return Boolean(intro && !intro.hidden && intro.dataset.state !== 'dismissed');
  };
  const removeIdle = () => {
    window.removeEventListener('vcd:home-intro-dismissing', onIntroDismissing);
    window.removeEventListener('vcd:home-intro-dismissed', onIntroDismissed);
    idle = false;
  };
  const removeListeners = () => {
    window.removeEventListener('click', cancelFromUser, true);
    trigger.removeEventListener('mouseenter', cancelFromHover);
    window.removeEventListener('resize', cancelFromUser, true);
    window.removeEventListener('scroll', cancelFromScroll);
    window.removeEventListener('pagehide', cancelFromUser, true);
    window.removeEventListener('vcd:dev-mode-change', cancelFromEdit);
    document.removeEventListener('visibilitychange', cancelFromVisibility, true);
    document.removeEventListener('header:navigation-start', cancelFromUser, true);
    document.removeEventListener('header:force-close', cancelFromUser, true);
    mobileMq.removeEventListener('change', cancelFromUser);
    reducedMq.removeEventListener('change', cancelFromUser);
  };
  const closeOwned = () => {
    if (!menuOwned) return;
    menuOwned = false;
    if (!trigger.matches(':hover') && !trigger.contains(document.activeElement)) close(true);
  };
  const cleanup = (preserveMenu = false) => {
    const active = controller;
    controller = undefined;
    active?.abort();
    if (cursorFrame !== undefined) window.cancelAnimationFrame(cursorFrame);
    cursorFrame = undefined;
    removeIdle();
    removeListeners();
    if (preserveMenu) menuOwned = false;
    else closeOwned();
    // Freeze the scene where it is and fade it out, so every dismissal leaves the same way.
    const leaving = scene;
    const running = [...animations];
    scene = undefined;
    animations.clear();
    running.forEach(animation => animation.pause());
    const finish = () => {
      running.forEach(animation => animation.cancel());
      leaving?.remove();
    };
    if (!leaving) return finish();
    const layers = [...leaving.children].filter((layer): layer is HTMLElement => layer instanceof HTMLElement);
    const fades = layers.map(layer => layer.animate(
      [{ opacity: window.getComputedStyle(layer).opacity }, { opacity: 0 }],
      { duration: config.dismissDuration, easing: config.exitEasing, fill: 'forwards' },
    ).finished);
    void Promise.all(fades).catch(() => undefined).then(finish);
  };
  function cancelFromUser(event?: Event) {
    if (!controller) return;
    if (event?.type === 'click' && introVisible()) return;
    cleanup(Boolean(event?.type === 'click' && event.target instanceof Node && trigger.contains(event.target)));
  }
  function cancelFromHover() {
    // The real pointer's mouseenter opens the menu; leave it to the header.
    if (controller) cleanup(true);
  }
  function cancelFromScroll() {
    // The intro's restoration reset lands at the top, where the header still sits.
    if (window.scrollY !== 0) cancelFromUser();
  }
  function cancelFromVisibility() {
    if (document.hidden) cancelFromUser();
  }
  function cancelFromEdit(event: Event) {
    if ((event as CustomEvent<{ active?: boolean }>).detail?.active) cancelFromUser();
  }
  const addListeners = () => {
    window.addEventListener('click', cancelFromUser, true);
    trigger.addEventListener('mouseenter', cancelFromHover);
    window.addEventListener('resize', cancelFromUser, true);
    window.addEventListener('scroll', cancelFromScroll, { passive: true });
    window.addEventListener('pagehide', cancelFromUser, true);
    window.addEventListener('vcd:dev-mode-change', cancelFromEdit);
    document.addEventListener('visibilitychange', cancelFromVisibility, true);
    document.addEventListener('header:navigation-start', cancelFromUser, true);
    document.addEventListener('header:force-close', cancelFromUser, true);
    mobileMq.addEventListener('change', cancelFromUser);
    reducedMq.addEventListener('change', cancelFromUser);
  };

  const wait = (delay: number, signal: AbortSignal) => new Promise<boolean>(resolve => {
    if (signal.aborted) return resolve(false);
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve(!signal.aborted);
    };
    const timer = window.setTimeout(finish, Math.max(0, delay));
    signal.addEventListener('abort', finish, { once: true });
  });
  const frame = (signal: AbortSignal) => new Promise<boolean>(resolve => {
    if (signal.aborted) return resolve(false);
    const finish = () => {
      window.cancelAnimationFrame(id);
      signal.removeEventListener('abort', finish);
      resolve(!signal.aborted);
    };
    const id = window.requestAnimationFrame(finish);
    signal.addEventListener('abort', finish, { once: true });
  });
  async function animate(target: Element | Element[], frames: Keyframe[], duration: number, easing: string, signal: AbortSignal) {
    if (signal.aborted) return false;
    const targets = Array.isArray(target) ? target : [target];
    const running = targets.map(element => element.animate(frames, { duration, easing, fill: 'forwards' }));
    running.forEach(animation => animations.add(animation));
    const finished = Promise.all(running.map(animation => animation.finished));
    void finished.catch(() => undefined);
    try {
      if (running.length > 1) {
        await Promise.all(running.map(animation => animation.ready));
        if (signal.aborted) return false;
        running.slice(1).forEach(animation => { animation.startTime = running[0].startTime; });
      }
      await finished;
      return !signal.aborted;
    } catch (error) {
      if (!signal.aborted) throw error;
      return false;
    }
  }
  async function ready(signal: AbortSignal) {
    await document.fonts?.ready;
    if (signal.aborted) return false;
    const reveal = document.querySelector<HTMLElement>('[data-vcd-initial-reveal]');
    if (reveal?.dataset.vcdInitialReveal === 'running') {
      const revealed = await new Promise<boolean>(resolve => {
        const finish = () => {
          window.removeEventListener('vcd:initial-reveal-complete', finish);
          signal.removeEventListener('abort', finish);
          resolve(!signal.aborted);
        };
        window.addEventListener('vcd:initial-reveal-complete', finish, { once: true });
        signal.addEventListener('abort', finish, { once: true });
      });
      if (!revealed) return false;
    }
    return await frame(signal) && await frame(signal);
  }

  const point = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const outsidePoint = () => {
    const rect = (trigger.querySelector<HTMLElement>('.header-trigger__panel') ?? trigger).getBoundingClientRect();
    return {
      x: Math.max(16, Math.min(window.innerWidth - 16, rect.right + 48)),
      y: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 48)),
    };
  };
  const headerExitPoint = () => {
    const row = trigger.closest<HTMLElement>('.site-header__row')!;
    const left = trigger.querySelector<HTMLElement>('.header-trigger__panel')!.getBoundingClientRect();
    const right = row.querySelector<HTMLElement>('.header-trigger--end .header-trigger__panel')!.getBoundingClientRect();
    return { x: (left.right + right.left) / 2, y: point(row).y };
  };
  const transform = (at: { x: number; y: number }, scale = 1) =>
    'translate(' + at.x + 'px, ' + at.y + 'px) scale(' + scale + ')';
  const openMenu = () => {
    if (trigger.dataset.menuOpen === 'true') return menuOwned;
    open();
    menuOwned = trigger.dataset.menuOpen === 'true';
    return menuOwned;
  };

  async function run(origin: number, active: AbortController) {
    const { signal } = active;
    try {
      if (!await ready(signal) || isEditing() || document.hidden || hasSeen()) return;
      const mobile = mobileMq.matches;
      const reduced = reducedMq.matches;
      const circleStart = Math.max(0, homeRevealConfig.intro.durationMs + HINT_DELAY + config.startDelay);
      const circleEnd = circleStart + config.circleIn;
      const cursorFadeStart = Math.max(0, circleEnd + config.cursorOffset);
      const cursorFadeDuration = reduced ? 180 : mobile ? 240 : 500;
      const demoStart = cursorFadeStart + cursorFadeDuration + config.cursorWait;
      const veilOutStart = Math.max(circleEnd + config.veilHold, demoStart + config.exitOffset);
      const firstStart = Math.min(circleStart, cursorFadeStart);
      const timelineOrigin = Math.max(origin, window.performance.now() - firstStart);
      const waitUntil = (offset: number) => wait(offset - (window.performance.now() - timelineOrigin), signal);
      if (!await waitUntil(firstStart) || !eligible() || hasSeen()) return;
      const visual = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      scene = visual;
      document.body.append(visual);
      const veil = visual.querySelector<HTMLElement>('[data-header-menu-demo-veil]')!;
      const iris = visual.querySelector<SVGCircleElement>('[data-header-menu-demo-iris]')!;
      const position = visual.querySelector<SVGGElement>('[data-header-menu-demo-position]')!;
      const cursorLayer = visual.querySelector<HTMLElement>('[data-header-menu-demo-cursor-layer]')!;
      const pointer = visual.querySelector<HTMLElement>(mobile ? '[data-header-menu-demo-finger]' : '[data-header-menu-demo-cursor]')!;
      visual.querySelector<HTMLElement>(mobile ? '[data-header-menu-demo-cursor]' : '[data-header-menu-demo-finger]')!.style.display = 'none';
      const entrance = mobile ? { x: window.innerWidth / 2, y: window.innerHeight / 2 } : outsidePoint();
      const fullScale = Math.max(1, (Math.hypot(
        Math.max(entrance.x, window.innerWidth - entrance.x),
        Math.max(entrance.y, window.innerHeight - entrance.y),
      ) + 1) / config.radius);
      let began = false;
      const begin = () => {
        if (began) return true;
        if (!eligible() || hasSeen()) { cleanup(); return false; }
        began = true;
        try { window.sessionStorage.setItem(SEEN_KEY, 'true'); } catch { /* Storage is optional. */ }
        return true;
      };
      iris.style.transform = 'scale(' + (reduced ? 1 : fullScale) + ')';
      position.style.transform = transform(entrance);
      veil.style.opacity = reduced ? '0' : '1';
      pointer.style.opacity = '0';
      pointer.style.transform = transform(entrance);
      let hoverActive = false;
      const sampleCursor = () => {
        const rect = pointer.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left, rect.top);
        const cursor = hit ? window.getComputedStyle(hit).cursor : 'default';
        const state = cursor === 'pointer' || cursor === 'grab' || cursor === 'grabbing' ? cursor : 'arrow';
        if (pointer.dataset.cursorState !== state) pointer.dataset.cursorState = state;
        if (hoverActive) {
          if (hit && trigger.contains(hit)) openMenu();
          else closeOwned();
        }
      };
      const trackCursor = () => {
        if (signal.aborted || !pointer.isConnected) return;
        sampleCursor();
        cursorFrame = window.requestAnimationFrame(trackCursor);
      };
      const move = (from: typeof entrance, to: typeof entrance, duration: number) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy);
        const normal = distance ? { x: -dy / distance, y: dx / distance } : { x: 0, y: 0 };
        const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const inward = normal.x * (window.innerWidth / 2 - midpoint.x) + normal.y * (window.innerHeight / 2 - midpoint.y) >= 0 ? 1 : -1;
        const bend = Math.min(config.cursorBend, distance * .03) * inward;
        const frames = Array.from({ length: 61 }, (_, index) => {
          const time = index / 60;
          const biased = time + config.cursorBias * time * (1 - time);
          const progress = biased ** 2 * (3 - 2 * biased);
          const bow = 4 * (1 - progress) * progress * bend;
          const at = index === 0 ? from : index === 60 ? to : {
            x: from.x + dx * progress + normal.x * bow,
            y: from.y + dy * progress + normal.y * bow,
          };
          return { offset: time, transform: transform(at) };
        });
        return animate([pointer, position], frames, duration, 'linear', signal);
      };
      const press = (at: typeof entrance, from: number, to: number) => animate(pointer,
        [{ transform: transform(at, from) }, { transform: transform(at, to) }], 120, 'ease-out', signal);
      const relocate = async (at: typeof entrance) => {
        if (!await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], 120, CURSOR_FADE_EASING, signal)) return false;
        pointer.style.transform = transform(at);
        position.style.transform = transform(at);
        if (!mobile) sampleCursor();
        return animate(pointer, [{ opacity: 0 }, { opacity: 1 }], 180, CURSOR_FADE_EASING, signal);
      };
      const playVeil = async () => {
        if (!await waitUntil(circleStart) || !begin()) return;
        veil.hidden = false;
        const entered = reduced
          ? await animate(veil, [{ opacity: 0 }, { opacity: 1 }], config.circleIn, config.scaleEasing, signal)
          : await animate(iris, [{ transform: 'scale(' + fullScale + ')' }, { transform: 'scale(1)' }], config.circleIn, config.scaleEasing, signal);
        if (!entered || !await waitUntil(veilOutStart)) return;
        if (await animate(veil, [{ opacity: 1 }, { opacity: 0 }], config.circleOut, config.exitEasing, signal)) veil.hidden = true;
      };
      const playCursor = async () => {
        if (!await waitUntil(cursorFadeStart) || !begin()) return;
        if (mobile) pointer.dataset.cursorState = 'arrow';
        else trackCursor();
        if (!await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], cursorFadeDuration, CURSOR_FADE_EASING, signal)) return;
        if (!await wait(config.cursorWait, signal)) return;
        const start = point(trigger.querySelector<HTMLElement>('.header-trigger__brand') ?? trigger);
        if (reduced) {
          if (!await relocate(start)) return;
        } else {
          hoverActive = !mobile;
          if (!await move(entrance, start, mobile ? 600 : 500)) return;
          if (!mobile) sampleCursor();
          if (mobile && !await press(start, 1, .88)) return;
        }
        if ((mobile || reduced) && !openMenu()) return;
        if (!menuOwned) return;
        if (mobile && !reduced && !await press(start, .88, 1)) return;
        const finishRoutine = async () => {
          if (!await wait(1000, signal)) return false;
          const away = mobile ? outsidePoint() : headerExitPoint();
          if (reduced) {
            if (!await relocate(away)) return false;
          } else {
            if (!await move(start, away, 450)) return false;
            if (!mobile) sampleCursor();
            if (mobile && !await press(away, 1, .88)) return false;
          }
          hoverActive = false;
          closeOwned();
          return away;
        };
        const ending = finishRoutine();
        const release = async () => {
          const away = await ending;
          if (!away) return false;
          return mobile && !reduced ? press(away, .88, 1) : true;
        };
        const fadeOut = async () => {
          if (config.cursorOutDelay < 0) {
            const remaining = 1000 + (reduced ? 300 : 450 + (mobile ? 120 : 0));
            if (!await wait(remaining + config.cursorOutDelay, signal)) return false;
          } else if (!await ending || !await wait(config.cursorOutDelay, signal)) return false;
          return animate(cursorLayer, [{ opacity: 1 }, { opacity: 0 }], config.cursorOutDuration, config.cursorOutEasing, signal);
        };
        await Promise.all([release(), fadeOut()]);
      };
      await Promise.all([playVeil(), playCursor()]);
    } catch (error) {
      if (!signal.aborted) console.error('Header menu demo failed.', error);
    } finally {
      if (controller === active) cleanup();
    }
  }

  const arm = (origin: number) => {
    if (controller || hasSeen() || isEditing() || document.hidden) return;
    removeIdle();
    const active = new AbortController();
    controller = active;
    addListeners();
    void run(origin, active);
  };
  function onIntroDismissing() {
    const intro = document.querySelector<HTMLElement>('[data-home-intro-surface]');
    if (document.querySelector('.project-grid') && intro?.dataset.state === 'dismissing') arm(window.performance.now());
  }
  function onIntroDismissed() {
    const intro = document.querySelector<HTMLElement>('[data-home-intro-surface]');
    if (document.querySelector('.project-grid') && intro?.dataset.state === 'dismissed') arm(window.performance.now() - homeRevealConfig.intro.durationMs);
  }
  const start = () => {
    if (idle || controller || hasSeen()) return;
    idle = true;
    window.addEventListener('vcd:home-intro-dismissing', onIntroDismissing);
    window.addEventListener('vcd:home-intro-dismissed', onIntroDismissed);
  };
  return { start, cancel: () => cleanup() };
}
