import {
  isImageCaptionPositionId,
  type ImageCaptionPositionId,
} from './imageCaptions';

/**
 * Shared corner tokens for Dev Mode chrome buttons and caption placement.
 * Keep `data-dev-corner` on a trigger in sync with its CSS inset corner —
 * collision logic keys off the token, not hard-coded top-left checks.
 */
export type DevEditCorner = ImageCaptionPositionId;

export function isDevEditCorner(value: unknown): value is DevEditCorner {
  return isImageCaptionPositionId(value);
}

/**
 * True when a same-corner chrome control (e.g. Edit grid) sits over this image.
 * Ignores the caption trigger itself.
 */
export function captionCornerConflictsWithChrome(
  imageTarget: HTMLElement,
  captionPosition: ImageCaptionPositionId,
): boolean {
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
    if (chrome.dataset.devCorner !== captionPosition) continue;

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
