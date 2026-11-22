
const VIEWPORT_MARGIN = 8;

export function clampToViewport(layer: HTMLElement, left: number, top: number) {
  const win = layer.ownerDocument.defaultView ?? window;
  const maxTop = win.innerHeight - VIEWPORT_MARGIN - layer.offsetHeight;
  const maxLeft = win.innerWidth - VIEWPORT_MARGIN - layer.offsetWidth;
  layer.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
  layer.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))}px`;
}

export function placeBeside(layer: HTMLElement, anchor: Element, side: 'bottom' | 'right' = 'bottom', gap = 6) {
  const rect = anchor.getBoundingClientRect();
  if (side === 'right') clampToViewport(layer, rect.right + gap, rect.top);
  else clampToViewport(layer, rect.left, rect.bottom + gap);
}
