/** Size cropped project images to cover their frame (shared by SSR and dev inserts). */

import { bindImagePreviewUpgrade } from './imagePreviewUpgrade';

let refreshQueued = false;
let refreshing = false;

/** Include `root` itself when it matches — querySelectorAll only finds descendants. */
function queryAllIncludingRoot(
  root: ParentNode,
  selector: string,
): HTMLElement[] {
  const matches: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(selector)) {
    matches.push(root);
  }
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => matches.push(el));
  return matches;
}

function readAspectNum(frame: HTMLElement, image: HTMLImageElement | null): number {
  const fromCss = Number.parseFloat(
    getComputedStyle(frame).getPropertyValue('--project-image-ratio-num'),
  );
  if (Number.isFinite(fromCss) && fromCss > 0) return fromCss;
  if (image?.naturalWidth && image.naturalHeight) {
    return image.naturalWidth / image.naturalHeight;
  }
  return 1;
}

function gridItemFrame(item: HTMLElement): HTMLElement {
  const carousel = item.querySelector<HTMLElement>(':scope > [data-project-image-carousel]');
  if (carousel) {
    const slides = [...carousel.querySelectorAll<HTMLElement>('[data-carousel-slide]:not([data-carousel-parked="true"])')];
    const slide = slides[Number(carousel.dataset.activeIndex) || 0];
    return slide?.querySelector<HTMLElement>('.project-image-carousel__surface') ?? slide ?? item;
  }
  return item.querySelector<HTMLElement>(':scope > .project-image-grid__frame') ?? item;
}

function clearBelowSlotMinHeights(grid: HTMLElement): void {
  grid.querySelectorAll<HTMLElement>('.project-image-grid__below-slot').forEach((slot) => {
    slot.style.removeProperty('min-height');
  });
}

function clearMatchHeightItemSizing(grid: HTMLElement): void {
  grid.querySelectorAll<HTMLElement>(':scope > .project-image-grid__item').forEach((item) => {
    item.style.removeProperty('width');
    item.style.removeProperty('flex');
  });
  clearBelowSlotMinHeights(grid);
}

function measureBelowCaptionHeight(item: HTMLElement): number {
  const caption = item.querySelector<HTMLElement>('.project-caption--below');
  if (!caption || getComputedStyle(caption).display === 'none') return 0;
  const styles = getComputedStyle(caption);
  const marginTop = Number.parseFloat(styles.marginTop) || 0;
  const marginBottom = Number.parseFloat(styles.marginBottom) || 0;
  return caption.offsetHeight + marginTop + marginBottom;
}

/**
 * Scale each row so cells share one height while keeping their aspect ratios
 * (widths become proportional). Requires `data-match-height="true"`.
 * Also equalizes `.project-image-grid__below-slot` min-heights so overlay
 * siblings leave matching empty space under their frames.
 */
export function layoutMatchHeightGrids(root: ParentNode = document): void {
  queryAllIncludingRoot(root, '.project-image-grid').forEach((grid) => {
    if (grid.dataset.matchHeight !== 'true') {
      // Always clear — leftover flex/width from a prior match-height pass
      // breaks equal-column CSS grid (tuner refresh often roots on the grid itself).
      clearMatchHeightItemSizing(grid);
      delete grid.dataset.matchHeightLaidOut;
      return;
    }

    const cols = Math.max(
      1,
      Math.round(Number.parseFloat(
        getComputedStyle(grid).getPropertyValue('--project-image-grid-columns'),
      ) || 2),
    );
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap)
      || Number.parseFloat(getComputedStyle(grid).gap)
      || 0;
    const totalWidth = grid.clientWidth;
    if (!totalWidth) return;

    const items = [...grid.querySelectorAll<HTMLElement>(':scope > .project-image-grid__item')]
      .filter((item) => getComputedStyle(item).display !== 'none')
      .sort((a, b) => {
        const orderA = Number.parseFloat(getComputedStyle(a).order) || 0;
        const orderB = Number.parseFloat(getComputedStyle(b).order) || 0;
        return orderA - orderB;
      });

    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const aspects = row.map((item) => {
        const frame = gridItemFrame(item);
        const image = item.querySelector<HTMLImageElement>('.project-image-grid__image');
        return readAspectNum(frame, image);
      });
      const sum = aspects.reduce((acc, value) => acc + value, 0) || 1;
      const available = totalWidth - gap * Math.max(0, row.length - 1);

      row.forEach((item, index) => {
        const width = Math.max(0, available * (aspects[index] / sum));
        item.style.flex = '0 0 auto';
        item.style.width = `${width}px`;
      });

      // Clear then measure natural below-caption heights so siblings can match.
      row.forEach((item) => {
        const slot = item.querySelector<HTMLElement>(':scope > .project-image-grid__below-slot');
        slot?.style.removeProperty('min-height');
      });
      const maxCaptionHeight = Math.max(0, ...row.map((item) => measureBelowCaptionHeight(item)));
      row.forEach((item) => {
        const slot = item.querySelector<HTMLElement>(':scope > .project-image-grid__below-slot');
        if (!slot) return;
        if (maxCaptionHeight > 0) {
          slot.style.minHeight = `${maxCaptionHeight}px`;
        } else {
          slot.style.removeProperty('min-height');
        }
      });
    }

    grid.dataset.matchHeightLaidOut = 'true';
  });
}

function applyOriginalRatio(frame: HTMLElement, image: HTMLImageElement): void {
  if (image.dataset.imagePreviewRevealing === 'true') return;
  if (image.hasAttribute('data-preview-reveal')) return;
  // Thumb (640) and preview (2560) round fit:inside differently. Rewriting the
  // frame ratio on the preview load is a page-height jump on aspect:original.
  if (frame.dataset.originalRatioLocked === 'true') return;
  if (!image.naturalWidth || !image.naturalHeight) return;
  frame.style.setProperty(
    '--project-image-original-ratio',
    `${image.naturalWidth} / ${image.naturalHeight}`,
  );
  frame.style.setProperty(
    '--project-image-original-ratio-num',
    String(image.naturalWidth / image.naturalHeight),
  );
  frame.dataset.originalRatioLocked = 'true';
}

/**
 * Content placement is pure CSS now (see `.project-cropped > … > img` in
 * project.css) — nothing here sizes bitmaps. All that remains is publishing the
 * natural ratio for frames whose aspect is `"original"` but whose node has no
 * `srcWidth`/`srcHeight` yet, plus the match-height row solver, which genuinely
 * needs measurement.
 */
export function refreshProjectCropCovers(root: ParentNode = document): void {
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  try {
    queryAllIncludingRoot(root, '.project-cropped').forEach((outer) => {
      const image = outer.querySelector<HTMLImageElement>(
        ':scope > img, :scope > .project-crop-clip > img',
      );
      if (image) applyOriginalRatio(outer, image);
    });

    // Ratios first so match-height can read --project-image-original-ratio-num.
    queryAllIncludingRoot(root, '.project-image-grid__item').forEach((item) => {
      const frame = gridItemFrame(item);
      const image = item.querySelector<HTMLImageElement>('.project-image-grid__image');
      if (!image) return;
      applyOriginalRatio(item, image);
      applyOriginalRatio(frame, image);
    });

    layoutMatchHeightGrids(root);
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      refreshProjectCropCovers(root);
    }
  }
}

let resizeBound = false;
let cropCoverObserver: ResizeObserver | null = null;

function observeCropFrames(root: ParentNode): void {
  if (typeof ResizeObserver === 'undefined') return;

  if (!cropCoverObserver) {
    cropCoverObserver = new ResizeObserver(() => refreshProjectCropCovers());
  }

  queryAllIncludingRoot(
    root,
    '.project-cropped, .project-image-grid, .project-image-grid__item, .project-image-grid__frame',
  ).forEach((frame) => {
    if (frame.dataset.cropCoverObserved === 'true') return;
    frame.dataset.cropCoverObserved = 'true';
    cropCoverObserver!.observe(frame);
  });
}

export function bindProjectCropCovers(root: ParentNode = document): void {
  bindImagePreviewUpgrade(root);
  refreshProjectCropCovers(root);
  root.querySelectorAll<HTMLImageElement>(
    '.project-cropped > img, .project-cropped > .project-crop-clip > img, .project-image-grid__image',
  ).forEach((image) => {
    if (image.dataset.cropCoverBound === 'true') return;
    image.dataset.cropCoverBound = 'true';
    image.addEventListener('load', () => {
      if (image.dataset.imagePreviewRevealing === 'true') return;
      if (image.hasAttribute('data-preview-reveal')) return;
      refreshProjectCropCovers(root);
    });
  });
  observeCropFrames(root);
  if (!resizeBound && root === document) {
    resizeBound = true;
    window.addEventListener('resize', () => refreshProjectCropCovers());
    document.addEventListener('astro:before-swap', () => { cropCoverObserver?.disconnect(); cropCoverObserver = null; });
  }
}
