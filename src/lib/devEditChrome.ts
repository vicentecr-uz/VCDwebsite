import type { ImageCaptionPositionId } from './imageCaptions';

/**
 * Corner tokens for Dev Mode chrome buttons (Edit grid, etc.).
 * Keep `data-dev-corner` on a trigger in sync with its CSS inset corner —
 * collision logic keys off the token, not hard-coded top-left checks.
 */
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

/**
 * True when a same-corner chrome control (e.g. Edit grid) sits over this image.
 * Ignores the caption trigger itself.
 */
export function captionCornerConflictsWithChrome(
  imageTarget: HTMLElement,
  captionPosition: ImageCaptionPositionId,
): boolean {
  const chromeCorner = captionPositionToChromeCorner(captionPosition);
  if (!chromeCorner) return false;

  // Prefer the visible crop/image frame — carousel slides are full track width.
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
