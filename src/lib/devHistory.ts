export type HistoryCommand = {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  mergeKey?: string;
};

type HistoryController = { undo: () => void | Promise<void>; redo: () => void | Promise<void> };

const changed = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vcd:dev-history-change'));
};

export function createHistory() {
  const past: Array<HistoryCommand & { id: number; time: number; owner?: symbol }> = [];
  const future: typeof past = [];
  let sequence = 0;
  let grouping = false;
  let replaying = false;
  let busy = false;
  const move = async (from: typeof past, to: typeof past, direction: 'undo' | 'redo', index = from.length - 1) => {
    if (busy || index < 0) return;
    const command = from[index];
    busy = true;
    replaying = true;
    grouping = false;
    changed();
    try {
      await command[direction]();
      from.splice(index, 1);
      to.push(command);
    } finally {
      replaying = false;
      busy = false;
      changed();
    }
  };
  const history = {
    get replaying() { return replaying; },
    get busy() { return busy; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    push(command: HistoryCommand, owner?: symbol) {
      if (replaying) return;
      const previous = past.at(-1);
      const now = Date.now();
      if (grouping && command.mergeKey && command.mergeKey === previous?.mergeKey && previous.owner === owner
        && !future.length && now - previous.time < 750) {
        previous.redo = command.redo;
        previous.time = now;
      } else {
        past.push({ ...command, id: ++sequence, time: now, owner });
      }
      future.length = 0;
      grouping = true;
      changed();
    },
    undo: () => move(past, future, 'undo'),
    redo: () => move(future, past, 'redo'),
    breakGroup() { grouping = false; },
    clear() {
      if (busy) return;
      past.length = 0;
      future.length = 0;
      grouping = false;
      changed();
    },
    scope() {
      const boundary = sequence;
      const owner = Symbol('panel');
      grouping = false;
      const indexIn = (entries: typeof past) => entries.findLastIndex((entry) => entry.owner === owner && entry.id > boundary);
      return {
        get canUndo() { return indexIn(past) >= 0; },
        get canRedo() { return indexIn(future) >= 0; },
        push: (command: HistoryCommand) => history.push(command, owner),
        undo: () => move(past, future, 'undo', indexIn(past)),
        redo: () => move(future, past, 'redo', indexIn(future)),
      };
    },
  };
  return history;
}

export const pageHistory = createHistory();
const scopes = new Set<{
  element: HTMLElement;
  controller: HistoryController;
  owns?: (target: Element | null) => boolean;
}>();

export function registerHistoryScope(
  element: HTMLElement,
  controller: HistoryController,
  options: { owns?: (target: Element | null) => boolean; signal?: AbortSignal } = {},
) {
  const scope = { element, controller, owns: options.owns };
  scopes.add(scope);
  const dispose = () => { scopes.delete(scope); };
  options.signal?.addEventListener('abort', dispose, { once: true });
  return dispose;
}

export function installHistoryShortcuts(signal: AbortSignal) {
  let lastInteractionTarget: Element | null = null;
  const activeScopes = () => [...scopes].reverse().filter(({ element }) =>
    element.isConnected && !element.closest('[hidden], [aria-hidden="true"]'),
  );
  const scopeFor = (target: Element | null) => activeScopes().find(({ element, owns }) =>
    element.contains(target) || element.closest('[data-dev-overlay]')?.contains(target) || owns?.(target),
  );
  let selectedScope: ReturnType<typeof scopeFor>;
  const selectHistory = (event: Event) => {
    lastInteractionTarget = event.target instanceof Element ? event.target : null;
    selectedScope = scopeFor(lastInteractionTarget);
  };
  let saving = false;
  document.addEventListener('pointerdown', (event) => {
    selectHistory(event);
    pageHistory.breakGroup();
  }, { capture: true, signal });
  document.addEventListener('focusin', selectHistory, { capture: true, signal });
  window.addEventListener('vcd:dev-save-state', ((event: CustomEvent<{ saving: boolean }>) => {
    saving = event.detail.saving;
    pageHistory.breakGroup();
  }) as EventListener, { signal });
  const route = (event: Event, redo: boolean) => {
    if (!document.documentElement.classList.contains('is-dev-mode')) return;
    const keyboardTarget = event.target instanceof Element ? event.target : null;
    const target = lastInteractionTarget ?? keyboardTarget;
    const scope = activeScopes().find((entry) => entry === selectedScope) ?? scopeFor(target);
    const nativeField = target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    // Unregistered text controls keep native undo; authored page text belongs to the page stack.
    if (!scope && nativeField && !nativeField.hasAttribute('data-dev-text-document')
      && !nativeField.hasAttribute('data-dev-history-text')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saving || pageHistory.busy) return;
    const controller = scope?.controller ?? pageHistory;
    Promise.resolve(redo ? controller.redo() : controller.undo()).catch((error) => {
      window.dispatchEvent(new CustomEvent('vcd:dev-history-error', {
        detail: { message: error instanceof Error ? error.message : 'Could not restore that edit.' },
      }));
    });
  };
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && !(key === 'y' && !event.shiftKey)) return;
    route(event, event.shiftKey || key === 'y');
  }, { capture: true, signal });
  document.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') route(event, event.inputType === 'historyRedo');
  }, { capture: true, signal });
}
