import { bindImageReplaceControls } from './imageReplaceControls';
import { isAcceptedImageFile } from './imageUpload.mjs';

export interface DemoImageReplacementCrop {
  setSource(source: { src: string; width: number; height: number; alt?: string }): boolean;
  reset(): void;
}

export interface DemoImageReplacementHandle {
  reset(): void;
  destroy(): void;
}

export function createDemoImageReplacement(
  root: HTMLElement,
  crop: DemoImageReplacementCrop,
): DemoImageReplacementHandle {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const status = root.querySelector<HTMLElement>('[data-image-replacement-status]');
  let generation = 0;
  let currentUrl: string | undefined;
  let pendingUrl: string | undefined;
  let destroyed = false;

  const revoke = (url: string | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
  };
  const message = (value: string) => {
    if (!status) return;
    status.textContent = value;
    status.hidden = !value;
  };
  const replace = (file: File | undefined) => {
    if (destroyed || !file) return;
    if (!isAcceptedImageFile(file)) {
      generation += 1;
      revoke(pendingUrl);
      pendingUrl = undefined;
      message('Choose an image file.');
      return;
    }
    const attempt = ++generation;
    revoke(pendingUrl);
    pendingUrl = URL.createObjectURL(file);
    const url = pendingUrl;
    const image = new Image();
    image.src = url;
    message('Loading image…');
    void (async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        else await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('decode'));
        });
        if (destroyed || attempt !== generation || pendingUrl !== url) return;
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) throw new Error('dimensions');
        if (!crop.setSource({ src: url, width, height, alt: file.name })) {
          throw new Error('replace');
        }
        const previous = currentUrl;
        currentUrl = url;
        pendingUrl = undefined;
        revoke(previous);
        message('');
      } catch {
        if (destroyed || attempt !== generation || pendingUrl !== url) return;
        pendingUrl = undefined;
        revoke(url);
        message('Could not load image.');
      }
    })();
  };
  bindImageReplaceControls(root, { onFile: replace, signal });

  const reset = () => {
    generation += 1;
    revoke(pendingUrl);
    revoke(currentUrl);
    pendingUrl = undefined;
    currentUrl = undefined;
    crop.reset();
    message('');
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    lifecycle.abort();
    revoke(pendingUrl);
    revoke(currentUrl);
    pendingUrl = undefined;
    currentUrl = undefined;
  };
  return { reset, destroy };
}
