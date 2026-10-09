export function createDevPanelDrag(panel: HTMLElement): () => void {
  const dragHandle = panel.querySelector<HTMLElement>('[data-drag-handle]');
  const win = panel.ownerDocument.defaultView;
  if (!dragHandle || !win) return () => {};

  const abort = new win.AbortController();
  const { signal } = abort;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let frame: number | null = null;
  let pendingLeft = 0;
  let pendingTop = 0;
  let userPositioned = false;

  panel.dataset.devPanelDragInitialized = 'true';

  const clampPosition = (left: number, top: number) => ({
    left: clamp(left, 0, Math.max(0, win.innerWidth - panel.offsetWidth)),
    top: clamp(top, 0, Math.max(0, win.innerHeight - panel.offsetHeight)),
  });

  const applyPendingPosition = () => {
    frame = null;
    const next = clampPosition(pendingLeft, pendingTop);
    panel.style.translate = `${next.left - originLeft}px ${next.top - originTop}px`;
  };

  const schedulePosition = (left: number, top: number) => {
    pendingLeft = left;
    pendingTop = top;
    if (frame === null) frame = win.requestAnimationFrame(applyPendingPosition);
  };

  const commitPosition = (left: number, top: number) => {
    const next = clampPosition(left, top);
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    panel.style.translate = 'none';
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    userPositioned = true;
  };

  const reclampPosition = () => {
    if (!panel.isConnected || panel.getClientRects().length === 0) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const next = clampPosition(rect.left, rect.top);
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.translate = 'none';
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
  };

  const anchorToLeftTop = () => {
    const rect = panel.getBoundingClientRect();
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.translate = 'none';
    return rect;
  };

  const endDrag = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    commitPosition(originLeft + event.clientX - startX, originTop + event.clientY - startY);
    pointerId = null;
    panel.classList.remove('is-dragging');
    if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
  };

  const cancelDrag = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    commitPosition(pendingLeft, pendingTop);
    pointerId = null;
    panel.classList.remove('is-dragging');
    if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
  };

  dragHandle.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    if (pointerId !== null || event.button !== 0 || event.isPrimary === false || target?.closest?.('[data-drag-ignore]')) return;
    event.preventDefault();
    const rect = anchorToLeftTop();
    const next = clampPosition(rect.left, rect.top);
    originLeft = next.left;
    originTop = next.top;
    pendingLeft = originLeft;
    pendingTop = originTop;
    panel.style.left = `${originLeft}px`;
    panel.style.top = `${originTop}px`;
    startX = event.clientX;
    startY = event.clientY;
    pointerId = event.pointerId;
    panel.classList.add('is-dragging');
    dragHandle.setPointerCapture(event.pointerId);
  }, { signal });
  dragHandle.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    schedulePosition(originLeft + event.clientX - startX, originTop + event.clientY - startY);
  }, { signal });
  dragHandle.addEventListener('pointerup', endDrag, { signal });
  dragHandle.addEventListener('pointercancel', cancelDrag, { signal });
  dragHandle.addEventListener('lostpointercapture', (event) => {
    if (pointerId !== event.pointerId) return;
    commitPosition(pendingLeft, pendingTop);
    pointerId = null;
    panel.classList.remove('is-dragging');
  }, { signal });
  win.addEventListener('resize', () => {
    if (!userPositioned || pointerId !== null) return;
    reclampPosition();
  }, { signal });

  const resizeObserver = new win.ResizeObserver(() => {
    if (!userPositioned || pointerId !== null) return;
    reclampPosition();
  });
  resizeObserver.observe(panel);

  return () => {
    abort.abort();
    if (pointerId !== null) {
      commitPosition(pendingLeft, pendingTop);
      if (dragHandle.hasPointerCapture(pointerId)) dragHandle.releasePointerCapture(pointerId);
      pointerId = null;
    }
    resizeObserver.disconnect();
    if (frame !== null) win.cancelAnimationFrame(frame);
    panel.classList.remove('is-dragging');
    delete panel.dataset.devPanelDragInitialized;
  };
}
