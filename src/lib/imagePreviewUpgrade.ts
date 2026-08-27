/** Preload preview URLs and swap thumb → preview once ready. */

export function bindImagePreviewUpgrade(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>('img[data-image-preview]').forEach((img) => {
    if (img.dataset.imagePreviewBound === 'true') return;

    const preview = img.getAttribute('data-image-preview');
    if (!preview || preview === img.src) {
      img.removeAttribute('data-image-preview');
      return;
    }

    img.dataset.imagePreviewBound = 'true';

    const hi = new Image();
    hi.onload = () => {
      img.src = preview;
      img.removeAttribute('data-image-preview');
      img.dataset.imageUpgraded = 'true';
    };
    hi.src = preview;
  });
}
