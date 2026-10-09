import { createReorderController } from '../scripts/sectionReorder';

export interface DemoBlockReorderOptions {
  scroll?: boolean;
  onLift?: () => void;
  onSettle?: () => void;
}

export interface DemoBlockReorderHandle {
  reset(): void;
  destroy(): void;
  getOrder(): HTMLElement[];
  restore(order: HTMLElement[]): void;
  guideLift(item: HTMLElement, x: number, y: number): boolean;
  guideMove(x: number, y: number): void;
  guideDrop(): Promise<void>;
  cancel(): void;
  guideTarget(index: number): void;
}

export function createDemoBlockReorder(
  root: HTMLElement,
  { scroll = false, onLift, onSettle }: DemoBlockReorderOptions = {},
): DemoBlockReorderHandle {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const list = root.querySelector<HTMLElement>('[data-reorder-demo-list]');
  const resetButton = root.querySelector<HTMLButtonElement>('[data-reorder-demo-reset]');
  const status = root.querySelector<HTMLElement>('.reorder-demo__status');
  if (!list || !resetButton || !status) {
    lifecycle.abort();
    return { reset: () => {}, destroy: () => {}, getOrder: () => [], restore: () => {}, guideLift: () => false, guideMove: () => {}, guideDrop: async () => {}, cancel: () => {}, guideTarget: () => {} };
  }

  const originalNodes = [...list.childNodes];
  const initialBlocks = new Set([...list.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')]);
  list.querySelectorAll('img').forEach((image) => {
    image.removeAttribute('role');
    image.removeAttribute('tabindex');
    image.removeAttribute('aria-label');
    image.draggable = false;
  });
  let controller: ReturnType<typeof createReorderController> | undefined;
  let dragItem: HTMLElement | null = null;
  let dragHandle: HTMLButtonElement | null = null;
  let pointerId: number | null = null;
  let liftNodes: ChildNode[] | null = null;
  let generation = 0;
  let syncFrame = 0;
  let announceFrame = 0;
  let syncResolve: (() => void) | undefined;
  let dropping = false;
  let destroyed = false;

  const items = () => [...list.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')]
    .filter((item) => item !== dragItem);
  const allItems = () => [...list.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')];
  const measureGaps = (item: HTMLElement) => {
    const style = getComputedStyle(item);
    return { top: style.marginTop, bottom: style.marginBottom };
  };
  const announce = () => {
    if (!dragItem) return;
    const state = controller?.getState();
    const position = state?.phase === 'lifted' ? state.targetIndex : allItems().indexOf(dragItem);
    if (position >= 0) status.textContent = `${dragItem.dataset.title} · ${position + 1}`;
  };
  const makeController = () => {
    const config = {
      getItems: items,
      getDropZone: () => list,
      getDragItem: () => dragItem,
      classes: {
        indicator: 'dev-section-drop-indicator',
        indicatorBody: 'dev-section-drop-indicator__body',
        flipMoving: 'is-section-flip-moving',
        lifted: 'is-section-lifted',
        liftBackdrop: 'dev-section-lift-backdrop',
        fadeGhost: 'is-drop-indicator-fade-ghost',
      },
      measureLiftGaps: () => {
        if (!scroll || !dragItem) return { top: '0px', bottom: '0px' };
        return measureGaps(dragItem);
      },
      measureInsertGaps: (insertIndex, sourceIndex, liftGaps) => {
        if (!scroll) return { top: '0px', bottom: '0px', marginTop: '0px' };
        const movedAway = insertIndex !== sourceIndex;
        const retainedGap = dragItem
          ? getComputedStyle(dragItem).getPropertyValue('--demo-block-gap').trim()
          : '';
        return {
          top: '0px',
          bottom: '0px',
          marginTop: !movedAway ? liftGaps.top : insertIndex === 0 ? '0px' : retainedGap || liftGaps.top,
        };
      },
      ...(scroll ? {} : { scrollTuning: { maxScrollSpeed: 0 } }),
      onStatus: announce,
    } satisfies Parameters<typeof createReorderController>[0];
    return createReorderController(config);
  };
  controller = makeController();

  const releaseCapture = () => {
    const handle = dragHandle;
    const currentPointerId = pointerId;
    pointerId = null;
    if (handle && currentPointerId !== null && handle.hasPointerCapture(currentPointerId)) {
      handle.releasePointerCapture(currentPointerId);
    }
  };
  const cancelFrames = () => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    if (announceFrame) cancelAnimationFrame(announceFrame);
    syncFrame = 0;
    announceFrame = 0;
    syncResolve?.();
    syncResolve = undefined;
  };
  const setPressed = (pressed: boolean) => {
    allItems().forEach((item) => {
      const active = pressed && item === dragItem;
      item.classList.toggle('is-section-lifted-session', active);
      item.querySelector('.dev-section-lift-backdrop')?.classList.toggle('is-visible', active);
      item.querySelector<HTMLButtonElement>('[data-reorder-demo-handle]')?.setAttribute('aria-pressed', String(active));
    });
    if (pressed) onLift?.();
    else onSettle?.();
  };
  const restoreNodes = (nodes: ChildNode[]) => {
    for (const node of nodes) list.append(node);
  };
  const reset = (nodes = originalNodes) => {
    generation += 1;
    dropping = false;
    cancelFrames();
    releaseCapture();
    controller?.destroy();
    controller = makeController();
    restoreNodes(nodes);
    dragItem = null;
    dragHandle = null;
    liftNodes = null;
    setPressed(false);
    status.textContent = '';
  };
  const finishDrop = async (focus = true) => {
    const activeController = controller;
    const activeGeneration = generation;
    const handle = dragHandle;
    if (dropping || !activeController || !dragItem || activeController.getState().phase !== 'lifted') return;
    dropping = true;
    await new Promise<void>((resolve) => {
      syncResolve = resolve;
      syncFrame = requestAnimationFrame(() => {
        syncFrame = 0;
        if (activeGeneration !== generation || activeController !== controller || signal.aborted) {
          resolve();
          syncResolve = undefined;
          return;
        }
        syncFrame = requestAnimationFrame(() => {
          syncFrame = 0;
          syncResolve = undefined;
          resolve();
        });
      });
    });
    if (activeGeneration !== generation || activeController !== controller || signal.aborted) return;
    await activeController.endDrop();
    if (activeGeneration !== generation || activeController !== controller || signal.aborted) return;
    const committedItem = dragItem;
    const position = committedItem ? allItems().indexOf(committedItem) : -1;
    if (committedItem && position >= 0) status.textContent = `${committedItem.dataset.title} · ${position + 1}`;
    releaseCapture();
    dropping = false;
    dragItem = null;
    dragHandle = null;
    liftNodes = null;
    setPressed(false);
    if (focus && activeGeneration === generation && !signal.aborted) handle?.focus();
  };
  const pickUp = (item: HTMLElement, handle: HTMLButtonElement, x: number, y: number, followPointer = true) => {
    if (controller?.isActive() || dragItem) return false;
    const sourceIndex = items().indexOf(item);
    liftNodes = [...list.childNodes];
    dragItem = item;
    dragHandle = handle;
    generation += 1;
    setPressed(true);
    controller?.beginLift(item, handle, x, y, sourceIndex, { followPointer });
    announce();
    return true;
  };
  const dropOrPick = (item: HTMLElement, handle: HTMLButtonElement, event: KeyboardEvent) => {
    event.preventDefault();
    if (dragItem === item && controller?.getState().phase === 'lifted') {
      void finishDrop();
      return;
    }
    if (!dragItem) pickUp(item, handle, 0, 0, false);
  };

  for (const item of items()) {
    const handle = item.querySelector<HTMLButtonElement>('[data-reorder-demo-handle]');
    if (!handle) continue;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (!pickUp(item, handle, event.clientX, event.clientY)) return;
      handle.blur();
      pointerId = event.pointerId;
      handle.setPointerCapture(event.pointerId);
    }, { signal });
    handle.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId || dragItem !== item) return;
      controller?.setPointer(event.clientX, event.clientY);
    }, { signal });
    handle.addEventListener('pointerup', (event) => {
      if (event.pointerId !== pointerId || dragItem !== item) return;
      releaseCapture();
      void finishDrop(false);
    }, { signal });
    handle.addEventListener('pointercancel', (event) => {
      if (event.pointerId !== pointerId) return;
      reset(liftNodes ?? originalNodes);
    }, { signal });
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (dragItem !== item || !controller?.isActive()) return;
        event.preventDefault();
        reset(liftNodes ?? originalNodes);
        handle.focus();
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        dropOrPick(item, handle, event);
        return;
      }
      if (dragItem !== item || controller?.getState().phase !== 'lifted') return;
      const state = controller.getState();
      const max = items().length;
      const next = event.key === 'ArrowUp' ? state.targetIndex - 1
        : event.key === 'ArrowDown' ? state.targetIndex + 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? max : null;
      if (next === null) return;
      event.preventDefault();
      controller.setTargetIndex(next);
      if (announceFrame) cancelAnimationFrame(announceFrame);
      const activeGeneration = generation;
      announceFrame = requestAnimationFrame(() => {
        announceFrame = 0;
        if (activeGeneration === generation && controller?.isActive()) announce();
      });
    }, { signal });
    handle.addEventListener('lostpointercapture', (event) => {
      if (pointerId !== event.pointerId || !controller?.isActive()) return;
      pointerId = null;
      reset(liftNodes ?? originalNodes);
    }, { signal });
  }
  resetButton.addEventListener('click', () => reset(), { signal });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    dropping = false;
    cancelFrames();
    const handle = dragHandle;
    const currentPointerId = pointerId;
    pointerId = null;
    if (handle && currentPointerId !== null && handle.hasPointerCapture(currentPointerId)) handle.releasePointerCapture(currentPointerId);
    lifecycle.abort();
    controller?.destroy();
    root.querySelectorAll('.is-section-lifted-session').forEach((item) => item.classList.remove('is-section-lifted-session'));
    root.querySelectorAll('.dev-section-lift-backdrop').forEach((backdrop) => backdrop.classList.remove('is-visible'));
    controller = undefined;
    dragItem = null;
    dragHandle = null;
    onSettle?.();
  };

  const sameItems = (order: HTMLElement[]) => {
    const seen = new Set(order);
    return order.length === initialBlocks.size && seen.size === initialBlocks.size && order.every((item) => initialBlocks.has(item));
  };
  const guideLift = (item: HTMLElement, x: number, y: number) => {
    const handle = item.querySelector<HTMLButtonElement>('[data-reorder-demo-handle]');
    return Boolean(handle && pickUp(item, handle, x, y));
  };
  return {
    reset,
    destroy,
    getOrder: () => allItems(),
    restore(order: HTMLElement[]) { if (!sameItems(order)) return; reset(order); },
    guideLift,
    guideMove(x: number, y: number) { if (dragItem && controller?.isActive()) controller.setPointer(x, y); },
    guideDrop: () => finishDrop(false),
    cancel() { reset(liftNodes ?? [...list.childNodes]); },
    guideTarget(index: number) { if (controller?.isActive()) controller.setTargetIndex(index); },
  };
}
