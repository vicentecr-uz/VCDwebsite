// Floating layers (menus, listboxes, tooltips) open as native popovers so they
// render in the top layer. Each `.project-block` is a stacking context
// (`isolation: isolate` from site-annotations.css) and, through
// `container-type: inline-size`, the containing block for `position: fixed` —
// so neither z-index nor fixed positioning lets a layer inside one block paint
// over a later block. The popover's CSS sets `position: fixed` and resets the
// UA `inset`/`margin`; these place it in viewport coordinates.

const VIEWPORT_MARGIN = 8;

/** Moves a fixed, open popover to `left`/`top`, kept 8px inside the viewport. */
export function clampToViewport(layer: HTMLElement, left: number, top: number) {
  const maxTop = window.innerHeight - VIEWPORT_MARGIN - layer.offsetHeight;
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - layer.offsetWidth;
  layer.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
  layer.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))}px`;
}

/** Opens beside `anchor`: below it, or to its right with tops aligned. */
export function placeBeside(layer: HTMLElement, anchor: Element, side: 'bottom' | 'right' = 'bottom', gap = 6) {
  const rect = anchor.getBoundingClientRect();
  if (side === 'right') clampToViewport(layer, rect.right + gap, rect.top);
  else clampToViewport(layer, rect.left, rect.bottom + gap);
}
