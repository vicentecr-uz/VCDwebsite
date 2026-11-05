// Edit mode only (imported in DEV): drag the grabber on a code block's base to cap it at a number
// of lines. The height follows the pointer smoothly while dragging, eases to the nearest whole line
// on release, and joins Save as a `layout-field` pending change that writes the section's
// `maxLines` (0 clears it and shows every line).
import { syncCodeBlock } from './codeBlockScroll';

const MIN_LINES = 3;
const SNAP = { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' };
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function lineMetrics(block: HTMLElement) {
  const scroller = block.querySelector<HTMLElement>('[data-option-panel]:not([hidden]) .astro-code');
  if (!scroller) return null;
  const style = getComputedStyle(scroller);
  const line = parseFloat(style.lineHeight);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const total = Math.max(1, Math.round((scroller.scrollHeight - padding) / line));
  return { scroller, line, padding, total };
}

function apply(block: HTMLElement, lines: number) {
  if (lines > 0) {
    block.dataset.maxLines = String(lines);
    block.style.setProperty('--code-block-max-lines', String(lines));
  } else {
    delete block.dataset.maxLines;
    block.style.removeProperty('--code-block-max-lines');
  }
  syncCodeBlock(block);
}

function queue(block: HTMLElement, handle: HTMLElement, lines: number) {
  const saved = Number(handle.dataset.savedLines || 0);
  const id = `code-block-lines:${handle.dataset.document}:${handle.dataset.path}`;
  if (lines === saved) {
    window.dispatchEvent(new CustomEvent('vcd:dev-pending-remove', { detail: { id } }));
    return;
  }
  window.dispatchEvent(new CustomEvent('vcd:dev-pending-upsert', { detail: {
    id,
    kind: 'layout-field',
    payload: { document: handle.dataset.document, path: JSON.parse(handle.dataset.path || '[]'), value: lines },
    revert: () => apply(block, saved),
  } }));
}

document.addEventListener('pointerdown', (event) => {
  const handle = (event.target as Element).closest<HTMLElement>('[data-code-block-resize]');
  if (!handle || !document.documentElement.classList.contains('is-dev-mode') || event.button !== 0) return;
  const block = handle.closest<HTMLElement>('[data-code-block]');
  const metrics = block && lineMetrics(block);
  if (!block || !metrics) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  handle.dataset.dragging = '';
  const { scroller, line, padding, total } = metrics;
  const startY = event.clientY;
  // Fractional, not clientHeight (rounded): the height tracks the pointer to the subpixel.
  const startHeight = scroller.getBoundingClientRect().height;
  const minHeight = MIN_LINES * line + padding;
  const fullHeight = total * line + padding;
  // During the drag an inline max-height follows the pointer; the cap attribute keeps overflow and
  // the fade active so the content behaves as it will once saved.
  block.dataset.maxLines = block.dataset.maxLines || String(total);
  scroller.getAnimations().forEach((animation) => animation.cancel());

  // Latest pointer position (coalesced samples included), applied once per frame, never rounded.
  let pointerY = startY;
  let frame = 0;
  const render = () => {
    frame = 0;
    const height = Math.min(fullHeight, Math.max(minHeight, startHeight + pointerY - startY));
    scroller.style.maxHeight = `${height}px`;
    syncCodeBlock(block);
  };
  const move = (moveEvent: PointerEvent) => {
    pointerY = (moveEvent.getCoalescedEvents?.().at(-1) ?? moveEvent).clientY;
    if (!frame) frame = requestAnimationFrame(render);
  };
  const end = () => {
    delete handle.dataset.dragging;
    handle.removeEventListener('pointermove', move);
    if (frame) cancelAnimationFrame(frame);
    render();
    const height = scroller.getBoundingClientRect().height;
    const nearest = Math.round((height - padding) / line);
    // Reaching the full length clears the cap rather than storing a number equal to it.
    const lines = nearest >= total ? 0 : Math.max(MIN_LINES, nearest);
    const target = (lines || total) * line + padding;
    const settle = () => {
      scroller.style.removeProperty('max-height');
      apply(block, lines);
      queue(block, handle, lines);
    };
    if (reducedMotion() || Math.abs(target - height) < 0.5) {
      settle();
      return;
    }
    // Ease from wherever the pointer let go to the nearest whole line, never more than half a line.
    scroller.style.maxHeight = `${target}px`;
    scroller.animate([{ maxHeight: `${height}px` }, { maxHeight: `${target}px` }], SNAP).finished.then(settle, settle);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end, { once: true });
  handle.addEventListener('pointercancel', end, { once: true });
});

// After Save the queued value is the new baseline, so dragging back to it is no longer a change.
window.addEventListener('vcd:dev-pending-committed', ((event: CustomEvent<{ ids?: string[] }>) => {
  const ids = new Set(event.detail?.ids ?? []);
  document.querySelectorAll<HTMLElement>('[data-code-block-resize]').forEach((handle) => {
    if (!ids.has(`code-block-lines:${handle.dataset.document}:${handle.dataset.path}`)) return;
    handle.dataset.savedLines = handle.closest<HTMLElement>('[data-code-block]')?.dataset.maxLines ?? '0';
  });
}) as EventListener);
