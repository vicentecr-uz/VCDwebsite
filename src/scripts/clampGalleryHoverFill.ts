/**
 * Gallery hover crops are often seeded with `w: 1` before the hover bitmap’s
 * aspect is known. That undercovers on frames narrower than the source
 * (letterbox → cover peeks through). Once the hover `<img>` has dimensions,
 * clamp each viewport’s `--project-hover-content-w-*` down to the cover bound.
 * Zoomed-in crops (`w` already below the bound) are left alone.
 */

const VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;

function coverBound(frameAspect: number, srcAspect: number): number {
  if (!(frameAspect > 0) || !(srcAspect > 0)) return 1;
  return Math.min(1, frameAspect / srcAspect);
}

function readNumber(cover: HTMLElement, prop: string): number | null {
  const raw = cover.style.getPropertyValue(prop).trim()
    || getComputedStyle(cover).getPropertyValue(prop).trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Clamp one cover’s hover content widths to fill the linked frame. */
export function clampHoverFillOnCover(cover: HTMLElement): void {
  if (!cover.classList.contains('project-grid__cover--hover-cropped')) return;
  const hover = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
  if (!hover || hover.hidden) return;
  const nw = hover.naturalWidth;
  const nh = hover.naturalHeight;
  if (!(nw > 0) || !(nh > 0)) return;
  const srcAspect = nw / nh;

  let hoverVariants: Record<string, { aspect?: string; cx?: number; cy?: number; w?: number }> | null = null;
  if (cover.dataset.devHoverVariants) {
    try {
      hoverVariants = JSON.parse(cover.dataset.devHoverVariants) as typeof hoverVariants;
    } catch {
      hoverVariants = null;
    }
  }

  let changed = false;
  for (const viewport of VIEWPORTS) {
    const frameAspect = readNumber(cover, `--project-image-ratio-num-${viewport}`);
    if (frameAspect === null) continue;
    const maxW = coverBound(frameAspect, srcAspect);
    const current = readNumber(cover, `--project-hover-content-w-${viewport}`);
    if (current === null || current <= maxW + 1e-6) continue;
    const next = Number(maxW.toFixed(6));
    cover.style.setProperty(`--project-hover-content-w-${viewport}`, String(next));
    if (hoverVariants?.[viewport]) {
      hoverVariants[viewport].w = next;
    }
    changed = true;
  }

  if (changed && hoverVariants) {
    cover.dataset.devHoverVariants = JSON.stringify(hoverVariants);
  }
}

/** Bind load listeners on gallery hover bitmaps; returns teardown. */
export function bindGalleryHoverFill(): () => void {
  const seen = new WeakSet<HTMLElement>();
  const cleanups: Array<() => void> = [];

  const bindCover = (cover: HTMLElement) => {
    if (seen.has(cover)) return;
    const hover = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
    if (!hover || hover.hidden) return;
    seen.add(cover);
    const run = () => clampHoverFillOnCover(cover);
    if (hover.naturalWidth > 0) {
      run();
      return;
    }
    hover.addEventListener('load', run, { once: true });
    cleanups.push(() => hover.removeEventListener('load', run));
  };

  const scan = () => {
    document.querySelectorAll<HTMLElement>('.project-grid__cover--hover-cropped').forEach(bindCover);
  };
  scan();

  const observer = new MutationObserver(scan);
  document.querySelectorAll('.project-grid').forEach((grid) => {
    observer.observe(grid, { childList: true, subtree: true });
  });
  cleanups.push(() => observer.disconnect());

  return () => cleanups.forEach((fn) => fn());
}
