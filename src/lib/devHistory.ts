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
  const past: Array<HistoryCommand & { id: number; time: number }> = [];
  const future: typeof past = [];
  let sequence = 0;
  let grouping = false;
  let replaying = false;
  let busy = false;
  const move = async (from: typeof past, to: typeof past, direction: 'undo' | 'redo') => {
    if (busy || !from.length) return;
    const command = from.at(-1)!;
    busy = true;
    replaying = true;
    grouping = false;
    changed();
    try {
      await command[direction]();
      from.pop();
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
    push(command: HistoryCommand) {
      if (replaying) return;
      const previous = past.at(-1);
      const now = Date.now();
      if (grouping && command.mergeKey && command.mergeKey === previous?.mergeKey
        && !future.length && now - previous.time < 750) {
        previous.redo = command.redo;
        previous.time = now;
      } else {
        past.push({ ...command, id: ++sequence, time: now });
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
    scope(): HistoryController {
      const boundary = sequence;
      grouping = false;
      return {
        undo: () => past.at(-1)?.id! > boundary ? history.undo() : undefined,
        redo: () => future.at(-1)?.id! > boundary ? history.redo() : undefined,
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
  let lastTarget: Element | null = null;
  let saving = false;
  document.addEventListener('pointerdown', (event) => {
    lastTarget = event.target instanceof Element ? event.target : null;
    pageHistory.breakGroup();
  }, { capture: true, signal });
  window.addEventListener('vcd:dev-save-state', ((event: CustomEvent<{ saving: boolean }>) => {
    saving = event.detail.saving;
    pageHistory.breakGroup();
  }) as EventListener, { signal });
  document.addEventListener('keydown', (event) => {
    if (!document.documentElement.classList.contains('is-dev-mode') || event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && !(key === 'y' && !event.shiftKey)) return;
    const target = event.target instanceof Element ? event.target : null;
    const scope = [...scopes].reverse().find(({ element, owns }) =>
      element.isConnected && !element.closest('[hidden], [aria-hidden="true"]')
      && (element.contains(target) || owns?.(target)
        || ((target === document.body || target === document.documentElement) && element.contains(lastTarget))),
    );
    const nativeField = target?.closest('input, textarea, [contenteditable="true"]');
    // Unregistered text controls keep native undo; authored page text belongs to the page stack.
    if (!scope && nativeField && !nativeField.hasAttribute('data-dev-text-document')
      && !nativeField.hasAttribute('data-dev-history-text')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saving || pageHistory.busy) return;
    const controller = scope?.controller ?? pageHistory;
    Promise.resolve((event.shiftKey || key === 'y') ? controller.redo() : controller.undo()).catch((error) => {
      window.dispatchEvent(new CustomEvent('vcd:dev-history-error', {
        detail: { message: error instanceof Error ? error.message : 'Could not restore that edit.' },
      }));
    });
  }, { capture: true, signal });
}
