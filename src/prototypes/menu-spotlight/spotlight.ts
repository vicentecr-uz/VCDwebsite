import { createDevPanelDrag } from '../../lib/devPanelDrag';

type Config = {
  radius: number;
  feather: number;
  opacity: number;
  startDelay: number;
  circleIn: number;
  veilHold: number;
  circleOut: number;
  exitOffset: number;
  cursorOffset: number;
  cursorWait: number;
  easing: string;
  speed: number;
};
const defaults: Config = {
  radius: 140, feather: 80, opacity: .8, startDelay: 0, circleIn: 700,
  veilHold: 300, circleOut: 500, exitOffset: 0, cursorOffset: -200,
  cursorWait: 600, easing: 'cubic-bezier(.215,.61,.355,1)', speed: 1,
};
const numericKeys = [
  'radius', 'feather', 'opacity', 'startDelay', 'circleIn', 'veilHold',
  'circleOut', 'exitOffset', 'cursorOffset', 'cursorWait',
] as const;
const storageKey = 'vcd:menu-spotlight';

function mountSpotlight(root: HTMLElement) {
  const veil = root.querySelector<HTMLElement>('[data-spotlight-veil]')!;
  const iris = root.querySelector<HTMLElement>('[data-spotlight-iris]')!;
  const template = document.querySelector<HTMLTemplateElement>('[data-header-menu-demo]')!;
  const trigger = document.querySelector<HTMLElement>('.header-trigger--start')!;
  const controls = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-control]')];
  const easingSelect = root.querySelector<HTMLSelectElement>('[data-control="easing"]')!;
  const speedSelect = root.querySelector<HTMLSelectElement>('[data-control="speed"]')!;
  const settings = root.querySelector<HTMLTextAreaElement>('[data-settings-output]')!;
  const copyButton = root.querySelector<HTMLButtonElement>('[data-copy-settings]')!;
  const disclosure = root.querySelector<HTMLDetailsElement>('[data-spotlight-controls]')!;
  const picker = root.querySelector<HTMLElement>('.proto-picker')!;
  const pickerItem = picker.querySelector<HTMLButtonElement>('.proto-picker-item:not(.proto-picker-replay)')!;
  const highlight = picker.querySelector<HTMLElement>('.proto-picker-highlight')!;
  const mobileMq = window.matchMedia('(max-width: 40em)');
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let activeRun: AbortController | undefined;
  let clone: HTMLElement | undefined;
  let menuOwned = false;
  const animations = new Set<Animation>();

  function normalize(raw: Record<string, unknown>): Config {
    const next = { ...defaults };
    for (const key of numericKeys) {
      const input = root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)!;
      const value = raw[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const min = Number(input.min);
      const step = Number(input.step);
      next[key] = Math.max(min, Math.min(Number(input.max), min + Math.round((value - min) / step) * step));
    }
    if ([...easingSelect.options].some(option => option.value === raw.easing)) next.easing = String(raw.easing);
    if ([1, .5, .25].includes(Number(raw.speed))) next.speed = Number(raw.speed);
    return next;
  }

  let config = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) config = normalize(saved);
  } catch { /* Storage is optional. */ }

  function timings(snapshot: Config) {
    const circleEnd = snapshot.startDelay + snapshot.circleIn;
    const cursorFadeStart = Math.max(0, circleEnd + snapshot.cursorOffset);
    const cursorFadeDuration = reducedMq.matches ? 180 : mobileMq.matches ? 240 : 500;
    const cursorVisible = cursorFadeStart + cursorFadeDuration;
    const demoStart = cursorVisible + snapshot.cursorWait;
    const veilOutStart = Math.max(circleEnd + snapshot.veilHold, demoStart + snapshot.exitOffset);
    return { circleEnd, cursorFadeStart, cursorFadeDuration, cursorVisible, demoStart, veilOutStart };
  }

  function applyConfig() {
    for (const control of controls) {
      const key = control.dataset.control as keyof Config;
      control.value = String(config[key]);
      const output = root.querySelector<HTMLOutputElement>(`[data-value="${key}"]`);
      if (!output) continue;
      output.textContent = key === 'opacity' ? `${Math.round(config.opacity * 100)}%`
        : `${config[key]} ${key === 'radius' || key === 'feather' ? 'px' : 'ms'}`;
    }
    for (const key of numericKeys) {
      root.style.setProperty(`--spotlight-${key}`, String(config[key]));
    }
    root.style.setProperty('--spotlight-easing', config.easing);
    root.style.setProperty('--spotlight-speed', String(config.speed));
    iris.style.setProperty('--spotlight-radius', `${config.radius}px`);
    iris.style.setProperty('--spotlight-feather', `${config.feather}px`);
    iris.style.setProperty('--spotlight-opacity', String(config.opacity));
    const t = timings(config);
    const anchors = {
      circleEnd: t.circleEnd / config.speed,
      cursorVisible: t.cursorVisible / config.speed,
      demoStart: t.demoStart / config.speed,
      veilOutStart: t.veilOutStart / config.speed,
    };
    for (const [key, value] of Object.entries(anchors)) {
      root.querySelector<HTMLElement>(`[data-anchor="${key}"]`)!.textContent = `${Math.round(value)} ms`;
    }
    settings.value = JSON.stringify({ ...config, timelineMs: anchors }, null, 2);
  }

  function closeMenu() {
    if (!menuOwned) return;
    menuOwned = false;
    document.dispatchEvent(new CustomEvent('vcd:header-surface-preview', { detail: { side: null } }));
  }

  function stop() {
    activeRun?.abort();
    activeRun = undefined;
    animations.forEach(animation => animation.cancel());
    animations.clear();
    clone?.remove();
    clone = undefined;
    veil.hidden = true;
    closeMenu();
  }

  function wait(ms: number, runSignal: AbortSignal) {
    return new Promise<boolean>(resolve => {
      if (runSignal.aborted) return resolve(false);
      const finish = () => {
        window.clearTimeout(timer);
        runSignal.removeEventListener('abort', finish);
        resolve(!runSignal.aborted);
      };
      const timer = window.setTimeout(finish, Math.max(0, ms));
      runSignal.addEventListener('abort', finish, { once: true });
    });
  }

  function frame(runSignal: AbortSignal) {
    return new Promise<boolean>(resolve => {
      if (runSignal.aborted) return resolve(false);
      const finish = () => {
        window.cancelAnimationFrame(id);
        runSignal.removeEventListener('abort', finish);
        resolve(!runSignal.aborted);
      };
      const id = window.requestAnimationFrame(finish);
      runSignal.addEventListener('abort', finish, { once: true });
    });
  }

  async function animate(element: HTMLElement, frames: Keyframe[], duration: number, easing: string, runSignal: AbortSignal) {
    if (runSignal.aborted) return false;
    const animation = element.animate(frames, { duration, easing, fill: 'forwards' });
    animations.add(animation);
    try {
      await animation.finished;
      return !runSignal.aborted;
    } catch (error) {
      if (!runSignal.aborted) throw error;
      return false;
    }
  }

  async function ready(runSignal: AbortSignal) {
    await document.fonts?.ready;
    if (runSignal.aborted) return false;
    const reveal = document.querySelector<HTMLElement>('#transition-overlay');
    if (reveal && !reveal.hidden && reveal.dataset.vcdInitialReveal !== 'complete') {
      const revealed = await new Promise<boolean>(resolve => {
        const finish = () => {
          window.removeEventListener('vcd:initial-reveal-complete', finish);
          runSignal.removeEventListener('abort', finish);
          resolve(!runSignal.aborted);
        };
        window.addEventListener('vcd:initial-reveal-complete', finish, { once: true });
        runSignal.addEventListener('abort', finish, { once: true });
      });
      if (!revealed) return false;
    }
    return await frame(runSignal) && await frame(runSignal);
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
  const transform = (p: { x: number; y: number }, scale = 1) => `translate(${p.x}px, ${p.y}px) scale(${scale})`;

  async function replay() {
    stop();
    if (signal.aborted || document.hidden) return;
    const controller = new AbortController();
    activeRun = controller;
    const runSignal = controller.signal;
    try {
      if (!await ready(runSignal)) return;
      if (trigger.dataset.menuOpen === 'true') return;
      if (mobileMq.matches) disclosure.open = false;
      const snapshot = { ...config };
      const t = timings(snapshot);
      const ms = (duration: number) => duration / snapshot.speed;
      const mobile = mobileMq.matches;
      const reduced = reducedMq.matches;
      const start = point(trigger.querySelector<HTMLElement>('.header-trigger__brand') ?? trigger);
      const entrance = mobile ? { x: window.innerWidth / 2, y: window.innerHeight / 2 } : outsidePoint();
      const farthestCorner = Math.hypot(
        Math.max(entrance.x, window.innerWidth - entrance.x),
        Math.max(entrance.y, window.innerHeight - entrance.y),
      );
      const coveringScale = farthestCorner / snapshot.radius + 1;
      const irisTransform = (scale: number) => `translate(-50%, -50%) scale(${scale})`;
      iris.style.left = `${entrance.x}px`;
      iris.style.top = `${entrance.y}px`;
      iris.style.width = `${2 * Math.hypot(window.innerWidth, window.innerHeight)}px`;
      iris.style.transform = irisTransform(reduced ? 1 : coveringScale);
      veil.style.opacity = reduced ? '0' : '1';
      clone = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      clone.dataset.headerMenuDemoClone = '';
      document.body.append(clone);
      const pointer = clone.querySelector<HTMLElement>(mobile ? '[data-header-menu-demo-finger]' : '[data-header-menu-demo-cursor]')!;
      const unused = clone.querySelector<HTMLElement>(mobile ? '[data-header-menu-demo-cursor]' : '[data-header-menu-demo-finger]');
      if (unused) unused.style.display = 'none';
      pointer.style.opacity = '0';
      pointer.style.transform = transform(entrance);
      pointer.dataset.cursorState = 'arrow';
      const motionEase = mobile ? 'cubic-bezier(.645,.045,.355,1)' : 'cubic-bezier(.22,1,.36,1)';
      const move = (from: typeof entrance, to: typeof entrance, duration: number) => animate(pointer,
        [{ transform: transform(from) }, { transform: transform(to) }], ms(duration), motionEase, runSignal);
      const press = (at: typeof entrance, scale: number) => animate(pointer,
        [{ transform: transform(at, scale) }], ms(120), 'ease-out', runSignal);
      const openMenu = () => {
        if (runSignal.aborted || trigger.dataset.menuOpen === 'true') return false;
        document.dispatchEvent(new CustomEvent('vcd:header-surface-preview', { detail: { side: 'start' } }));
        menuOwned = trigger.dataset.menuOpen === 'true';
        return menuOwned;
      };

      const playVeil = async () => {
        if (!await wait(ms(snapshot.startDelay), runSignal)) return;
        veil.hidden = false;
        const entered = reduced
          ? await animate(veil, [{ opacity: 0 }, { opacity: 1 }], ms(snapshot.circleIn), snapshot.easing, runSignal)
          : await animate(iris, [{ transform: irisTransform(coveringScale) }, { transform: irisTransform(1) }], ms(snapshot.circleIn), snapshot.easing, runSignal);
        if (!entered || !await wait(ms(t.veilOutStart - t.circleEnd), runSignal)) return;
        const exited = reduced
          ? await animate(veil, [{ opacity: 1 }, { opacity: 0 }], ms(snapshot.circleOut), snapshot.easing, runSignal)
          : await animate(iris, [{ transform: irisTransform(1) }, { transform: irisTransform(coveringScale) }], ms(snapshot.circleOut), snapshot.easing, runSignal);
        if (exited) veil.hidden = true;
      };
      const playCursor = async () => {
        if (!await wait(ms(t.cursorFadeStart), runSignal)) return;
        if (!await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], ms(t.cursorFadeDuration), snapshot.easing, runSignal)) return;
        if (!await wait(ms(snapshot.cursorWait), runSignal)) return;
        if (reduced) {
          if (!await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], ms(120), snapshot.easing, runSignal)) return;
          pointer.style.transform = transform(start);
          if (!mobile) pointer.dataset.cursorState = 'pointer';
          if (!await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], ms(180), snapshot.easing, runSignal)) return;
        } else {
          if (!await move(entrance, start, mobile ? 600 : 500)) return;
          if (mobile && !await press(start, .88)) return;
          if (!mobile) pointer.dataset.cursorState = 'pointer';
        }
        if (!openMenu()) return;
        if (mobile && !reduced && !await press(start, 1)) return;
        if (!await wait(ms(1000), runSignal)) return;
        const away = outsidePoint();
        pointer.dataset.cursorState = 'arrow';
        if (reduced) {
          if (!await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], ms(120), snapshot.easing, runSignal)) return;
          pointer.style.transform = transform(away);
          if (!await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], ms(180), snapshot.easing, runSignal)) return;
        } else {
          if (!await move(start, away, 450)) return;
          if (mobile && !await press(away, .88)) return;
        }
        closeMenu();
        const frames: Keyframe[] = mobile && !reduced
          ? [{ opacity: 1, transform: transform(away, .88) }, { opacity: 0, transform: transform(away) }]
          : [{ opacity: 1 }, { opacity: 0 }];
        if (await animate(pointer, frames, ms(200), snapshot.easing, runSignal)) {
          clone?.remove();
          clone = undefined;
        }
      };
      await Promise.all([playVeil(), playCursor()]);
    } catch (error) {
      if (!runSignal.aborted) console.error('Menu spotlight prototype failed.', error);
    } finally {
      if (activeRun === controller) stop();
    }
  }

  for (const control of controls) {
    control.addEventListener('input', () => {
      const raw: Record<string, unknown> = { ...config };
      raw[control.dataset.control!] = control === easingSelect ? control.value : Number(control.value);
      config = normalize(raw);
      if (control.dataset.control === 'radius') stop();
      applyConfig();
      try { localStorage.setItem(storageKey, JSON.stringify(config)); } catch { /* Storage is optional. */ }
    }, { signal });
  }
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(settings.value);
      if (signal.aborted) return;
      copyButton.textContent = 'Copied';
    } catch {
      if (signal.aborted) return;
      settings.select();
      copyButton.textContent = 'Select settings';
    }
    if (await wait(1400, signal)) copyButton.textContent = 'Copy settings';
  }, { signal });

  const moveHighlight = () => {
    highlight.style.width = `${pickerItem.offsetWidth}px`;
    highlight.style.transform = `translateX(${pickerItem.offsetLeft}px)`;
  };
  const selectVariant = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('v', '1');
    history.replaceState(null, '', url);
    pickerItem.toggleAttribute('data-active', true);
    pickerItem.setAttribute('aria-current', 'true');
    moveHighlight();
  };
  pickerItem.addEventListener('click', () => { selectVariant(); void replay(); }, { signal });
  picker.querySelector('.proto-picker-replay')!.addEventListener('click', () => void replay(), { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') return stop();
    const target = event.target;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (['r', 'R', '1', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      selectVariant();
      void replay();
    }
  }, { signal });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Node) || root.contains(event.target)) return;
    stop();
  }, { capture: true, signal });
  window.addEventListener('resize', () => { stop(); moveHighlight(); }, { signal });
  window.addEventListener('pagehide', stop, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, { signal });
  document.addEventListener('header:navigation-start', stop, { signal });
  document.addEventListener('header:force-close', stop, { signal });
  window.addEventListener('vcd:dev-mode-change', event => {
    if ((event as CustomEvent<{ active?: boolean }>).detail?.active) stop();
  }, { signal });
  mobileMq.addEventListener('change', () => { stop(); applyConfig(); }, { signal });
  reducedMq.addEventListener('change', () => { stop(); applyConfig(); }, { signal });
  const disposeDrag = createDevPanelDrag(root.querySelector<HTMLElement>('[data-spotlight-panel]')!);
  if (mobileMq.matches) disclosure.open = false;
  applyConfig();
  selectVariant();
  void (async () => { if (await frame(signal) && await frame(signal)) picker.dataset.ready = ''; })();
  void replay();
  return () => { lifetime.abort(); stop(); disposeDrag(); };
}

const root = document.querySelector<HTMLElement>('[data-menu-spotlight-harness]');
const dispose = root ? mountSpotlight(root) : () => {};
import.meta.hot?.dispose(dispose);
