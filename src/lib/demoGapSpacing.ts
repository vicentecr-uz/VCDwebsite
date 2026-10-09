import { pinGapToolbar, unpinGapToolbar, GAP_ENTRY_RADIUS, GAP_RETENTION_RADIUS, GAP_INTENT_DELAY, GAP_FAST_POINTER } from './gapSpacingControl';

export type GapToken = 'related' | 'group' | 'section' | 'major';
const values: Record<GapToken, string> = { related: 'var(--space-related)', group: 'var(--space-group)', section: 'var(--space-section)', major: 'var(--space-major)' };

export interface DemoGapSpacingOptions { initial?: GapToken; onChange?: () => void }

export function createDemoGapSpacing(root: HTMLElement, options: DemoGapSpacingOptions = {}) {
  const win = root.ownerDocument.defaultView!;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  let suppressed = false;
  let escaped = false;
  let latest: { x: number; y: number; time: number } | undefined;
  let intent: ReturnType<typeof win.setTimeout> | undefined;
  let candidate: HTMLElement | undefined;
  const initial = options.initial ?? 'group';
  const states = [...root.querySelectorAll<HTMLElement>('[data-gap-toolbar]')].map((toolbar) => ({
    toolbar,
    block: toolbar.closest<HTMLElement>('[data-reorder-demo-block]')!,
    pill: toolbar.querySelector<HTMLElement>('.dev-gap-toolbar__pill')!,
    choices: [...toolbar.querySelectorAll<HTMLButtonElement>('[data-dev-spacing-option]')],
    relocation: undefined as ReturnType<typeof win.setTimeout> | undefined,
    touch: false,
  }));
  const cancelIntent = () => {
    if (intent !== undefined) win.clearTimeout(intent);
    intent = undefined; candidate = undefined;
  };
  const first = (state: typeof states[number]) => state.block.parentElement?.querySelector('[data-reorder-demo-block]') === state.block;
  const distance = (state: typeof states[number], x: number, y: number) => {
    const rect = state.pill.getBoundingClientRect();
    return Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
  };
  const clearRelocation = (state: typeof states[number]) => {
    if (state.relocation !== undefined) win.clearTimeout(state.relocation);
    state.relocation = undefined;
    state.toolbar.removeAttribute('data-relocating');
  };
  const show = (state: typeof states[number], visible: boolean) => state.toolbar.classList.toggle('is-near-spacing', visible);
  const hide = (state: typeof states[number], immediate = false) => {
    show(state, false);
    clearRelocation(state);
    if (!state.toolbar.hasAttribute('data-gap-top-pinned')) return;
    if (immediate) { unpinGapToolbar(state.toolbar); return; }
    state.toolbar.setAttribute('data-relocating', '');
    state.relocation = win.setTimeout(() => {
      state.relocation = undefined;
      unpinGapToolbar(state.toolbar);
      state.toolbar.removeAttribute('data-relocating');
    }, 150);
  };
  const clear = () => { cancelIntent(); latest = undefined; states.forEach((state) => hide(state, true)); };
  const update = (x: number, y: number, ready?: HTMLElement) => {
    if (suppressed) return;
    if (escaped) {
      if (states.some((state) => !first(state) && distance(state, x, y) <= GAP_RETENTION_RADIUS)) return;
      escaped = false;
    }
    const nearest = states.filter((state) => !first(state) && state.relocation === undefined)
      .map((state) => ({ state, distance: distance(state, x, y) }))
      .filter(({ state, distance }) => distance <= (state.toolbar.classList.contains('is-near-spacing') ? GAP_RETENTION_RADIUS : GAP_ENTRY_RADIUS))
      .sort((a, b) => a.distance - b.distance)[0]?.state;
    for (const state of states) {
      const focused = state.toolbar.contains(root.ownerDocument.activeElement);
      const visible = state.toolbar.classList.contains('is-near-spacing');
      if (state === nearest && (visible || ready === state.toolbar)) {
        show(state, true);
        if (distance(state, x, y) === 0) pinGapToolbar(state.toolbar);
        else if (state.toolbar.hasAttribute('data-gap-top-pinned')) hide(state);
      } else if (!focused) hide(state);
    }
    if (!nearest || nearest.toolbar.classList.contains('is-near-spacing')) { cancelIntent(); return; }
    if (candidate === nearest.toolbar) return;
    cancelIntent();
    candidate = nearest.toolbar;
    intent = win.setTimeout(() => {
      const ready = candidate;
      intent = undefined; candidate = undefined;
      if (latest) update(latest.x, latest.y, ready);
    }, GAP_INTENT_DELAY);
  };
  const select = (state: typeof states[number], value: GapToken, notify = true) => {
    state.block.style.setProperty('--demo-block-gap', values[value]);
    state.choices.forEach((choice) => {
      const active = choice.dataset.devSpacingOption === value;
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
    if (notify) options.onChange?.();
  };
  for (const state of states) {
    select(state, initial, false);
    state.pill.addEventListener('pointerenter', (event) => {
      if (suppressed || first(state) || event.pointerType === 'touch') return;
      cancelIntent(); clearRelocation(state); show(state, true); pinGapToolbar(state.toolbar);
    }, { signal });
    state.pill.addEventListener('pointerleave', () => { if (!state.touch) hide(state); }, { signal });
    state.pill.addEventListener('pointerdown', (event) => { state.touch = event.pointerType === 'touch'; }, { signal });
    state.pill.addEventListener('focusin', () => { if (!suppressed) { cancelIntent(); clearRelocation(state); show(state, true); } }, { signal });
    state.pill.addEventListener('focusout', (event) => { if (!state.pill.contains(event.relatedTarget as Node)) hide(state); }, { signal });
    state.choices.forEach((choice) => choice.addEventListener('click', (event) => {
      const value = choice.dataset.devSpacingOption as GapToken;
      if (suppressed || !values[value]) return;
      event.preventDefault(); event.stopPropagation();
      const keyboard = event.detail === 0;
      if (!state.touch && !keyboard) pinGapToolbar(state.toolbar);
      select(state, value);
      if (!keyboard) choice.blur();
      if (state.touch) hide(state, true);
    }, { signal }));
    state.pill.addEventListener('wheel', (event) => {
      if (!suppressed && state.toolbar.classList.contains('is-near-spacing')) event.preventDefault();
    }, { signal, passive: false });
    state.pill.addEventListener('touchmove', (event) => {
      if (!suppressed) event.preventDefault();
    }, { signal, passive: false });
  }
  root.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || event.buttons || suppressed) { cancelIntent(); return; }
    const speed = latest && event.timeStamp > latest.time ? Math.hypot(event.clientX - latest.x, event.clientY - latest.y) / (event.timeStamp - latest.time) : 0;
    if (speed > GAP_FAST_POINTER) cancelIntent();
    latest = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    update(event.clientX, event.clientY);
  }, { signal, passive: true });
  root.addEventListener('pointerleave', clear, { signal });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape') { clear(); escaped = true; } }, { signal });
  win.addEventListener('scroll', () => { cancelIntent(); latest = undefined; }, { signal, capture: true });
  win.addEventListener('resize', clear, { signal });
  return {
    getState(): GapToken[] { return states.map((state) => state.choices.find((choice) => choice.classList.contains('is-active'))?.dataset.devSpacingOption as GapToken ?? initial); },
    restore(valuesToRestore: GapToken[]) { if (valuesToRestore.length !== states.length || valuesToRestore.some((value) => !values[value])) return; clear(); states.forEach((state, index) => select(state, valuesToRestore[index])); escaped = false; },
    reveal(block: HTMLElement) { const state = states.find((candidate) => candidate.block === block); if (!state) return; cancelIntent(); clearRelocation(state); show(state, true); pinGapToolbar(state.toolbar); },
    select(block: HTMLElement, value: GapToken) { const state = states.find((candidate) => candidate.block === block); if (state && values[value]) select(state, value); },
    hide() { clear(); },
    reset() { clear(); states.forEach((state) => select(state, initial)); escaped = false; },
    setSuppressed(value: boolean) { suppressed = value; root.toggleAttribute('data-gap-suppressed', value); if (value) clear(); },
    destroy() { clear(); lifecycle.abort(); },
  };
}
