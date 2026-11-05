// Edit mode only (imported in DEV): drag the grabber on a code block's base to cap it at a number
// of lines. The value snaps to whole lines, previews live, and joins Save as a `layout-field`
// pending change that writes the section's `maxLines` (0 clears it and shows every line).
import { syncCodeBlock } from './codeBlockScroll';

const MIN_LINES = 3;

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
  const startY = event.clientY;
  const startHeight = metrics.scroller.clientHeight;
  let lines = Number(block.dataset.maxLines || 0);

  const move = (moveEvent: PointerEvent) => {
    const height = startHeight + moveEvent.clientY - startY;
    const next = Math.round((height - metrics.padding) / metrics.line);
    // Reaching the full length clears the cap rather than storing a number equal to it.
    lines = next >= metrics.total ? 0 : Math.max(MIN_LINES, next);
    apply(block, lines);
  };
  const end = () => {
    delete handle.dataset.dragging;
    handle.removeEventListener('pointermove', move);
    queue(block, handle, lines);
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
