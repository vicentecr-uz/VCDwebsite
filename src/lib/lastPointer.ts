/**
 * Last-known pointer position, tracked once at module scope so any dev
 * panel can open centered under the cursor (e.g. the Alt+I log-issue
 * shortcut) without each caller wiring its own listener.
 */

let lastX = 0;
let lastY = 0;
let bound = false;

function bind(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  const record = (event: PointerEvent) => {
    lastX = event.clientX;
    lastY = event.clientY;
  };
  document.addEventListener('pointermove', record);
  document.addEventListener('pointerdown', record);
}

bind();

export function getLastPointerPosition(): { x: number; y: number } {
  return { x: lastX, y: lastY };
}
