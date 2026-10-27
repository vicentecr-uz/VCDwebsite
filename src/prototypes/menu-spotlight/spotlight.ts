import { createDevPanelDrag } from '../../lib/devPanelDrag';

type Config = { radius: number; feather: number; opacity: number; startDelay: number; circleIn: number; veilHold: number; circleOut: number; exitOffset: number; cursorOffset: number; cursorWait: number; easing: string; speed: number };
const defaults: Config = { radius: 140, feather: 80, opacity: .8, startDelay: 0, circleIn: 700, veilHold: 300, circleOut: 500, exitOffset: 0, cursorOffset: -200, cursorWait: 600, easing: 'cubic-bezier(.215,.61,.355,1)', speed: 1 };
const numericKeys = ['radius', 'feather', 'opacity', 'startDelay', 'circleIn', 'veilHold', 'circleOut', 'exitOffset', 'cursorOffset', 'cursorWait'] as const;
const easingValues = ['cubic-bezier(.215,.61,.355,1)', 'cubic-bezier(.165,.84,.44,1)', 'cubic-bezier(.23,1,.32,1)', 'cubic-bezier(.645,.045,.355,1)'];
const root = document.querySelector<HTMLElement>('[data-menu-spotlight-harness]');

if (root) {
  const veil = root.querySelector<HTMLElement>('[data-spotlight-veil]');
  const iris = root.querySelector<HTMLElement>('[data-spotlight-iris]');
  const template = document.querySelector<HTMLTemplateElement>('[data-header-menu-demo]');
  const controls = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-control]')];
  const animations: Animation[] = [];
  const waits: number[] = [];
  let clone: HTMLElement | null = null;
  let generation = 0;
  let config = loadConfig();
  let startupAbort = new AbortController();
  let panelCleanup = () => {};
  if (!veil || !iris || !template) throw new Error('Menu spotlight prototype is missing required elements.');

  const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.matchMedia('(max-width: 40em)').matches;
  const physical = (ms: number, speed: number) => Math.max(0, ms / speed);
  const isInputTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

  function loadConfig(): Config {
    let saved: Record<string, unknown> = {};
    try { const parsed = JSON.parse(localStorage.getItem('vcd:menu-spotlight') || '{}'); if (parsed && typeof parsed === 'object') saved = parsed; } catch { /* optional storage */ }
    const next = { ...defaults } as Config;
    for (const key of numericKeys) {
      const input = root!.querySelector<HTMLInputElement>(`[data-control="${key}"]`);
      const value = Number(saved[key]);
      next[key] = input && Number.isFinite(value) ? Math.min(Number(input.max), Math.max(Number(input.min), value)) : defaults[key];
    }
    next.easing = typeof saved.easing === 'string' && easingValues.includes(saved.easing) ? saved.easing : defaults.easing;
    next.speed = saved.speed === 1 || saved.speed === .5 || saved.speed === .25 ? saved.speed : defaults.speed;
    return next;
  }
  function saveConfig() { try { localStorage.setItem('vcd:menu-spotlight', JSON.stringify(config)); } catch { /* optional storage */ } }
  function rangeValue(key: string, fallback: number) { const input = root!.querySelector<HTMLInputElement>(`[data-control="${key}"]`); const value = Number(input?.value); return input && Number.isFinite(value) ? Math.min(Number(input.max), Math.max(Number(input.min), value)) : fallback; }
  function timings(snapshot: Config) { const circleEnd = snapshot.startDelay + snapshot.circleIn; const cursorVisible = Math.max(0, circleEnd + snapshot.cursorOffset) + (isReduced() ? 180 : isMobile() ? 240 : 500); const demoStart = cursorVisible + snapshot.cursorWait; return { circleEnd, cursorVisible, demoStart, veilOutStart: Math.max(circleEnd + snapshot.veilHold, demoStart + snapshot.exitOffset), fadeDuration: cursorVisible - Math.max(0, circleEnd + snapshot.cursorOffset) }; }
  function updateAnchors() { const t = timings(config); const values = { circleEnd: t.circleEnd, cursorVisible: t.cursorVisible, demoStart: t.demoStart, veilOutStart: t.veilOutStart }; for (const [key, value] of Object.entries(values)) root!.querySelector<HTMLElement>(`[data-anchor="${key}"]`)!.textContent = `${Math.round(physical(value, config.speed))} ms`; }
  function updateCopy() { const t = timings(config); const output = root!.querySelector<HTMLTextAreaElement>('[data-settings-output]'); if (output) output.value = JSON.stringify({ ...config, circleSettled: physical(t.circleEnd, config.speed), cursorVisible: physical(t.cursorVisible, config.speed), demoStarts: physical(t.demoStart, config.speed), veilOutStarts: physical(t.veilOutStart, config.speed) }, null, 2); }
  function applyConfig() { for (const control of controls) { const key = control.dataset.control as keyof Config; control.value = String(config[key]); const output = root!.querySelector<HTMLOutputElement>(`[data-value="${key}"]`); if (output) { const unit = key === 'opacity' ? '' : key === 'radius' || key === 'feather' ? ' px' : key === 'speed' ? '×' : ' ms'; output.textContent = key === 'opacity' ? `${Math.round(config[key] * 100)}%` : `${config[key]}${unit}`; } } iris!.style.setProperty('--spotlight-radius', `${config.radius}px`); iris!.style.setProperty('--spotlight-feather', `${config.feather}px`); iris!.style.setProperty('--spotlight-opacity', String(config.opacity)); root!.style.setProperty('--spotlight-circle-in', `${physical(config.circleIn, config.speed)}ms`); root!.style.setProperty('--spotlight-circle-out', `${physical(config.circleOut, config.speed)}ms`); updateAnchors(); updateCopy(); }
  function cancelMenu() { document.dispatchEvent(new CustomEvent('vcd:header-surface-preview', { detail: { side: null } })); }
  function clearRun() { generation += 1; startupAbort.abort(); startupAbort = new AbortController(); animations.splice(0).forEach((animation) => animation.cancel()); waits.splice(0).forEach((timer) => window.clearTimeout(timer)); clone?.remove(); clone = null; veil!.hidden = true; cancelMenu(); }
  function wait(ms: number, token: number, speed: number) {
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, physical(ms, speed));
      const finish = () => { window.clearTimeout(timer); resolve(); };
      startupAbort.signal.addEventListener('abort', finish, { once: true });
      waits.push(timer);
    }).then(() => { if (token !== generation) return; });
  }
  function animate(element: HTMLElement, frames: Keyframe[], duration: number, easing: string, token: number, speed: number) { if (token !== generation) return Promise.resolve(); const animation = element.animate(frames, { duration: physical(duration, speed), easing, fill: 'forwards' }); animations.push(animation); return animation.finished.catch(() => undefined); }
  function point(element: HTMLElement) { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

  async function run() {
    clearRun(); const token = generation; const snapshot = { ...config }; applyConfig();
    const trigger = document.querySelector<HTMLElement>('.header-trigger--start'); if (!trigger) return;
    const start = point(trigger.querySelector<HTMLElement>('.header-trigger__brand') || trigger);
    const center = isMobile() ? { x: innerWidth / 2, y: innerHeight / 2 } : (() => { const rect = (trigger.querySelector<HTMLElement>('.header-trigger__panel') || trigger).getBoundingClientRect(); return { x: Math.max(16, Math.min(innerWidth - 16, rect.right + 48)), y: Math.max(16, Math.min(innerHeight - 16, rect.bottom + 48)) }; })();
    const coveringScale = Math.max(1, Math.hypot(Math.max(center.x, innerWidth - center.x), Math.max(center.y, innerHeight - center.y)) / Math.max(1, snapshot.radius) + 1);
    iris!.style.left = `${center.x}px`; iris!.style.top = `${center.y}px`; iris!.style.width = `${Math.max(innerWidth, innerHeight) * 2}px`; iris!.style.transform = `translate(-50%, -50%) scale(${isReduced() ? 1 : coveringScale})`; veil!.hidden = false;
    clone = template!.content.firstElementChild?.cloneNode(true) as HTMLElement | null; if (!clone) return clearRun(); document.body.append(clone);
    const pointer = clone.querySelector<HTMLElement>(isMobile() ? '[data-header-menu-demo-finger]' : '[data-header-menu-demo-cursor]'); const unused = clone.querySelector<HTMLElement>(isMobile() ? '[data-header-menu-demo-cursor]' : '[data-header-menu-demo-finger]'); if (unused) unused.style.display = 'none'; if (!pointer) return clearRun(); pointer.style.opacity = '0'; pointer.style.transform = `translate(${center.x}px, ${center.y}px)`;
    const timeline = timings(snapshot); const speed = snapshot.speed;
    const veilOutTimer = window.setTimeout(() => {
      if (token !== generation) return;
      if (isReduced()) void animate(veil!, [{ opacity: 1 }, { opacity: 0 }], snapshot.circleOut, 'linear', token, speed);
      else void animate(iris!, [{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: `translate(-50%, -50%) scale(${coveringScale})` }], snapshot.circleOut, snapshot.easing, token, speed);
    }, physical(timeline.veilOutStart, speed));
    waits.push(veilOutTimer);
    await wait(snapshot.startDelay, token, speed); if (token !== generation) return;
    if (isReduced()) await animate(veil!, [{ opacity: 0 }, { opacity: 1 }], snapshot.circleIn, 'linear', token, speed); else await animate(iris!, [{ transform: `translate(-50%, -50%) scale(${coveringScale})` }, { transform: 'translate(-50%, -50%) scale(1)' }], snapshot.circleIn, snapshot.easing, token, speed);
    await wait(Math.max(0, timeline.cursorVisible - timeline.circleEnd), token, speed); if (token !== generation) return;
    await animate(pointer, [{ opacity: 0 }, { opacity: 1 }], timeline.fadeDuration, 'linear', token, speed); await wait(snapshot.cursorWait, token, speed); if (token !== generation) return;
    if (isReduced()) {
      document.dispatchEvent(new CustomEvent('vcd:header-surface-preview', { detail: { side: 'start' } }));
      await wait(1000, token, speed);
    } else if (!isMobile()) { await animate(pointer, [{ transform: `translate(${center.x}px, ${center.y}px)` }, { transform: `translate(${start.x}px, ${start.y}px)` }], 500, 'cubic-bezier(.22,1,.36,1)', token, speed); document.dispatchEvent(new CustomEvent('vcd:header-surface-preview', { detail: { side: 'start' } })); await wait(1000, token, speed); const rect = (trigger.querySelector<HTMLElement>('.header-trigger__panel') || trigger).getBoundingClientRect(); const away = { x: Math.max(16, Math.min(innerWidth - 16, rect.right + 48)), y: Math.max(16, Math.min(innerHeight - 16, rect.bottom + 48)) }; await animate(pointer, [{ transform: `translate(${start.x}px, ${start.y}px)` }, { transform: `translate(${away.x}px, ${away.y}px)` }], 450, 'cubic-bezier(.22,1,.36,1)', token, speed); }
    else { await animate(pointer, [{ transform: `translate(${center.x}px, ${center.y}px)` }, { transform: `translate(${start.x}px, ${start.y}px)` }], 600, 'cubic-bezier(.645,.045,.355,1)', token, speed); await animate(pointer, [{ transform: `translate(${start.x}px, ${start.y}px) scale(.88)` }], 120, 'linear', token, speed); document.dispatchEvent(new CustomEvent('vcd:header-surface-preview', { detail: { side: 'start' } })); await animate(pointer, [{ transform: `translate(${start.x}px, ${start.y}px) scale(1)` }], 120, 'linear', token, speed); await wait(1000, token, speed); const rect = (trigger.querySelector<HTMLElement>('.header-trigger__panel') || trigger).getBoundingClientRect(); const away = { x: Math.max(16, Math.min(innerWidth - 16, rect.right + 48)), y: Math.max(16, Math.min(innerHeight - 16, rect.bottom + 48)) }; await animate(pointer, [{ transform: `translate(${start.x}px, ${start.y}px)` }, { transform: `translate(${away.x}px, ${away.y}px)` }], 450, 'cubic-bezier(.645,.045,.355,1)', token, speed); await animate(pointer, [{ transform: `translate(${away.x}px, ${away.y}px) scale(.88)` }], 120, 'linear', token, speed); }
    if (token !== generation) return; cancelMenu(); await animate(pointer, [{ opacity: 1 }, { opacity: 0 }], 200, 'linear', token, speed); if (token === generation) { veil!.hidden = true; clone?.remove(); clone = null; clearRun(); }
  }

  function scheduleAutoplay() { const token = generation; const reveal = document.querySelector<HTMLElement>('#transition-overlay'); const ready = () => !reveal || reveal.hidden || reveal.dataset.vcdInitialReveal === 'complete' || getComputedStyle(reveal).opacity === '0'; const start = async () => { await document.fonts?.ready; if (!ready()) await new Promise<void>((resolve) => window.addEventListener('vcd:initial-reveal-complete', () => resolve(), { once: true, signal: startupAbort.signal })); await new Promise(requestAnimationFrame); if (token === generation) void run(); }; void start(); }
  controls.forEach((control) => control.addEventListener('input', () => { const key = control.dataset.control as keyof Config; config[key] = control instanceof HTMLSelectElement ? (key === 'speed' ? Number(control.value) : control.value) as never : rangeValue(key, defaults[key] as number) as never; saveConfig(); applyConfig(); }));
  root.querySelector('[data-copy-settings]')?.addEventListener('click', async (event) => { const button = event.currentTarget as HTMLButtonElement; const output = root!.querySelector<HTMLTextAreaElement>('[data-settings-output]')!; try { await navigator.clipboard.writeText(output.value); button.textContent = 'Copied'; } catch { output.select(); button.textContent = 'Select settings'; } window.setTimeout(() => { button.textContent = 'Copy settings'; }, 1400); });
  const picker = root.querySelector<HTMLElement>('.proto-picker');
  const pickerItem = root.querySelector<HTMLButtonElement>('.proto-picker-item:not(.proto-picker-replay)');
  const highlight = root.querySelector<HTMLElement>('.proto-picker-highlight');
  const moveHighlight = () => { if (pickerItem && highlight) { highlight.style.width = `${pickerItem.offsetWidth}px`; highlight.style.transform = `translateX(${pickerItem.offsetLeft}px)`; } };
  pickerItem?.addEventListener('click', () => { pickerItem.dataset.active = ''; pickerItem.setAttribute('aria-current', 'true'); history.replaceState(null, '', `${location.pathname}?v=1`); run(); });
  root.querySelector('.proto-picker-replay')?.addEventListener('click', run);
  window.addEventListener('resize', moveHighlight);
  requestAnimationFrame(() => requestAnimationFrame(() => { picker?.setAttribute('data-ready', ''); moveHighlight(); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { clearRun(); return; } if (event.defaultPrevented || isInputTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return; if (event.key === 'r' || event.key === 'R') void run(); });
  window.addEventListener('resize', clearRun); window.addEventListener('pagehide', clearRun); document.addEventListener('visibilitychange', () => { if (document.hidden) clearRun(); }); document.addEventListener('header:navigation-start', clearRun); document.addEventListener('header:force-close', clearRun); window.addEventListener('vcd:dev-mode-change', clearRun);
  const dispose = () => { clearRun(); panelCleanup(); }; panelCleanup = createDevPanelDrag(root.querySelector<HTMLElement>('[data-spotlight-panel]') || root); applyConfig(); scheduleAutoplay(); import.meta.hot?.dispose(dispose);
}
