export function placeholderLabelText(alt: string): string {
  const trimmed = alt.trim();
  return trimmed || 'Placeholder';
}

const MIN_FONT_PX = 10;
const MAX_FONT_PX = 20;
const MAX_WIDTH_RATIO = 0.4;
const MAX_HEIGHT_RATIO = 0.6;
/** Subpixel slack so a fitting size is not rejected. */
const FIT_SLACK_PX = 1;

const boundCleanups = new WeakMap<HTMLElement, () => void>();

/**
 * Measure with a non-contenteditable probe. Focusing a contenteditable node
 * inflates scrollWidth (caret / internal layout), which made the page label
 * (and its edit dash) jump smaller while the panel preview stayed stable.
 */
function fitFontSize(el: HTMLElement, box: HTMLElement): void {
  const boxW = box.clientWidth;
  const boxH = box.clientHeight;
  // Degenerate while crop chrome mounts — keep the current size, refit next frame.
  if (boxW < 8 || boxH < 8) return;

  const maxW = boxW * MAX_WIDTH_RATIO;
  const maxH = boxH * MAX_HEIGHT_RATIO;

  const probe = el.cloneNode(true) as HTMLElement;
  probe.removeAttribute('contenteditable');
  probe.removeAttribute('data-dev-text-document');
  probe.removeAttribute('data-dev-text-path');
  probe.removeAttribute('data-dev-text-kind');
  probe.style.cssText = '';
  probe.className = el.className;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.left = '0';
  probe.style.top = '0';
  probe.style.width = `${maxW}px`;
  probe.style.maxWidth = `${maxW}px`;
  probe.style.maxHeight = 'none';
  probe.style.height = 'auto';
  probe.style.overflow = 'visible';
  probe.style.outline = 'none';
  probe.style.outlineOffset = '0';
  box.append(probe);

  let lo = MIN_FONT_PX;
  let hi = MAX_FONT_PX;
  let best = MIN_FONT_PX;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    probe.style.fontSize = `${mid}px`;
    const fits =
      probe.scrollWidth <= maxW + FIT_SLACK_PX
      && probe.scrollHeight <= maxH + FIT_SLACK_PX;
    if (fits) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  probe.remove();
  el.style.fontSize = `${best}px`;
}

export function bindFitPlaceholderLabel(el: HTMLElement): () => void {
  boundCleanups.get(el)?.();

  const box = el.parentElement;
  if (!box) return () => {};

  let raf = 0;
  const fit = () => fitFontSize(el, box);
  const scheduleFit = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      // Second frame: crop-stage layout often settles one paint later.
      requestAnimationFrame(fit);
    });
  };

  const ro = new ResizeObserver(scheduleFit);
  ro.observe(box);
  el.addEventListener('input', fit);
  el.addEventListener('keyup', fit);
  fit();

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
    el.removeEventListener('input', fit);
    el.removeEventListener('keyup', fit);
    boundCleanups.delete(el);
  };
  boundCleanups.set(el, cleanup);
  return cleanup;
}

export function appendPlaceholderLabel(
  host: HTMLElement,
  options: { alt: string; documentKey?: string; path?: (string | number)[] },
): HTMLElement {
  const label = document.createElement('span');
  label.className = 'project-media__placeholder-label';
  label.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'project-media__placeholder-label-text';
  text.textContent = placeholderLabelText(options.alt);

  if (options.documentKey && options.path) {
    text.setAttribute('data-dev-text-document', options.documentKey);
    text.setAttribute('data-dev-text-path', JSON.stringify([...options.path, 'alt']));
    text.setAttribute('data-dev-text-kind', 'text');
  }

  label.append(text);
  host.append(label);
  return label;
}

export function bindAllPlaceholderLabels(root: ParentNode = document): () => void {
  root.querySelectorAll<HTMLElement>('.project-media__placeholder-label-text').forEach((el) => {
    if (boundCleanups.has(el)) return;
    bindFitPlaceholderLabel(el);
  });
  return () => {};
}
