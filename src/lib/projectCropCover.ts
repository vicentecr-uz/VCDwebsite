/** Size cropped project images to cover their frame (shared by SSR and dev inserts). */
export function refreshProjectCropCovers(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.project-cropped').forEach((frame) => {
    const image = frame.querySelector<HTMLImageElement>(
      ':scope > img, :scope > .project-crop-clip > img',
    );
    if (!image?.naturalWidth || !image.naturalHeight) return;

    frame.style.setProperty(
      '--project-image-original-ratio',
      `${image.naturalWidth} / ${image.naturalHeight}`,
    );
    frame.style.setProperty(
      '--project-image-original-ratio-num',
      String(image.naturalWidth / image.naturalHeight),
    );
    const frameWidth = frame.clientWidth;
    const frameHeight = frame.clientHeight;
    if (!frameWidth || !frameHeight) return;

    const coverScale = Math.max(
      (frameWidth + 2) / image.naturalWidth,
      (frameHeight + 2) / image.naturalHeight,
    );
    image.style.width = `${Math.ceil(image.naturalWidth * coverScale)}px`;
    image.style.height = `${Math.ceil(image.naturalHeight * coverScale)}px`;
  });

  root.querySelectorAll<HTMLElement>('.project-image-grid__item').forEach((frame) => {
    const image = frame.querySelector<HTMLImageElement>('.project-image-grid__image');
    if (!image?.naturalWidth || !image.naturalHeight) return;

    frame.style.setProperty(
      '--project-image-original-ratio',
      `${image.naturalWidth} / ${image.naturalHeight}`,
    );
    frame.style.setProperty(
      '--project-image-original-ratio-num',
      String(image.naturalWidth / image.naturalHeight),
    );
    const frameWidth = frame.clientWidth;
    const frameHeight = frame.clientHeight;
    if (!frameWidth || !frameHeight) return;

    const scale = Math.max(
      (frameWidth + 2) / image.naturalWidth,
      (frameHeight + 2) / image.naturalHeight,
    );
    image.style.width = `${Math.ceil(image.naturalWidth * scale)}px`;
    image.style.height = `${Math.ceil(image.naturalHeight * scale)}px`;
  });
}

let resizeBound = false;
let cropCoverObserver: ResizeObserver | null = null;

function observeCropFrames(root: ParentNode): void {
  if (typeof ResizeObserver === 'undefined') return;

  if (!cropCoverObserver) {
    cropCoverObserver = new ResizeObserver(() => refreshProjectCropCovers());
  }

  root.querySelectorAll<HTMLElement>('.project-cropped, .project-image-grid__item').forEach((frame) => {
    if (frame.dataset.cropCoverObserved === 'true') return;
    frame.dataset.cropCoverObserved = 'true';
    cropCoverObserver!.observe(frame);
  });
}

export function bindProjectCropCovers(root: ParentNode = document): void {
  refreshProjectCropCovers(root);
  root.querySelectorAll<HTMLImageElement>(
    '.project-cropped > img, .project-cropped > .project-crop-clip > img, .project-image-grid__image',
  ).forEach((image) => {
    if (image.dataset.cropCoverBound === 'true') return;
    image.dataset.cropCoverBound = 'true';
    image.addEventListener('load', () => refreshProjectCropCovers(root));
  });
  observeCropFrames(root);
  if (!resizeBound && root === document) {
    resizeBound = true;
    window.addEventListener('resize', () => refreshProjectCropCovers());
  }
}
