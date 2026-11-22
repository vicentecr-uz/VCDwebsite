import type { ImageCaptionPositionId } from './imageCaptions';

export type DevEditCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export function isDevEditCorner(value: unknown): value is DevEditCorner {
  return (
    value === 'top-left' ||
    value === 'top-right' ||
    value === 'bottom-left' ||
    value === 'bottom-right'
  );
}

function captionPositionToChromeCorner(
  captionPosition: ImageCaptionPositionId,
): DevEditCorner | null {
  if (isDevEditCorner(captionPosition)) return captionPosition;
  return null;
}

export function captionCornerConflictsWithChrome(
  imageTarget: HTMLElement,
  captionPosition: ImageCaptionPositionId,
): boolean {
  const chromeCorner = captionPositionToChromeCorner(captionPosition);
  if (!chromeCorner) return false;

  const frame = imageTarget.querySelector<HTMLElement>(
    '.project-image-grid__frame, .project-crop-clip',
  );
  const imageRect = (frame ?? imageTarget).getBoundingClientRect();
  if (imageRect.width <= 0 || imageRect.height <= 0) return false;

  for (const chrome of document.querySelectorAll<HTMLElement>(
    '[data-dev-edit-trigger][data-dev-corner]',
  )) {
    if (chrome.dataset.devEditTrigger === 'caption') continue;
    if (chrome.dataset.devCorner !== chromeCorner) continue;

    const rect = chrome.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (
      cx >= imageRect.left &&
      cx <= imageRect.right &&
      cy >= imageRect.top &&
      cy <= imageRect.bottom
    ) {
      return true;
    }
  }

  return false;
}

export function syncNestedCarouselChrome(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.dev-carousel-edit-target').forEach((carousel) => {
    const nestedTrigger = carousel.querySelector<HTMLElement>(':scope > [data-dev-edit-trigger="carousel"]');
    if (!nestedTrigger) return;
    const grid = carousel.closest<HTMLElement>('.dev-grid-edit-target');
    const gridTrigger = grid?.querySelector<HTMLElement>(':scope > [data-dev-edit-trigger="grid"]');
    const cell = carousel.closest<HTMLElement>('.project-image-grid__item');
    let top = '';
    if (gridTrigger && !gridTrigger.hidden && cell) {
      const gridRect = gridTrigger.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const centerX = gridRect.left + gridRect.width / 2;
      const centerY = gridRect.top + gridRect.height / 2;
      if (gridRect.width > 0 && gridRect.height > 0 && centerX >= cellRect.left && centerX <= cellRect.right
        && centerY >= cellRect.top && centerY <= cellRect.bottom) {
        top = `${Math.max(0, gridRect.bottom - carousel.getBoundingClientRect().top + 6)}px`;
      }
    }
    if (nestedTrigger.style.getPropertyValue('--dev-carousel-trigger-top') !== top) {
      nestedTrigger.style.setProperty('--dev-carousel-trigger-top', top);
    }
  });
}
