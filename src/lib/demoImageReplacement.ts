import { bindImageReplaceControls } from './imageReplaceControls';
import { isAcceptedImageFile } from './imageUpload.mjs';
import type { DemoImageCropState } from './demoImageCrop';

export interface DemoImageReplacementAsset { src: string; filename: string; url: string; thumb: string; }
export interface DemoImageReplacementCrop {
  getState(): DemoImageCropState;
  restore(state: DemoImageCropState): boolean;
  setSource(source: DemoImageCropState['source']): boolean;
}
export interface DemoImageReplacementHandle { reset(): void; destroy(): void; }
type Options = { chooseAsset: () => Promise<DemoImageReplacementAsset | undefined> };

export function createDemoImageReplacement(root: HTMLElement, crop: DemoImageReplacementCrop, { chooseAsset }: Options): DemoImageReplacementHandle {
  const win = root.ownerDocument.defaultView!;
  const lifecycle = new win.AbortController();
  const { signal } = lifecycle;
  const status = root.querySelector<HTMLElement>('[data-image-replacement-status]');
  const urlApi = win.URL;
  let generation = 0;
  let currentUrl: string | undefined;
  let savedUrl: string | undefined;
  let pendingUrl: string | undefined;
  let savedState = crop.getState();
  let destroyed = false;
  const release = (url: string | undefined) => { if (url) urlApi.revokeObjectURL(url); };
  const message = (value: string) => { if (status) { status.textContent = value; status.hidden = !value; } };
  const current = (token: number) => !destroyed && !signal.aborted && token === generation;
  const decode = (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new win.Image();
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve({ width: image.naturalWidth, height: image.naturalHeight }) : reject(new Error('dimensions'));
    image.onerror = () => reject(new Error('load'));
    image.src = src;
  });
  const apply = async (asset: DemoImageReplacementAsset, token: number, ownedUrl?: string) => {
    const src = ownedUrl || asset.url;
    const dimensions = await decode(src);
    if (!current(token)) return;
    if (!crop.setSource({ src, ...dimensions, alt: asset.filename })) throw new Error('replace');
    const previous = currentUrl;
    currentUrl = ownedUrl;
    pendingUrl = undefined;
    if (previous && previous !== savedUrl) release(previous);
    message('');
  };
  const replaceFile = (file: File | undefined) => {
    if (!file || destroyed) return;
    const token = ++generation;
    if (!isAcceptedImageFile(file)) { release(pendingUrl); pendingUrl = undefined; message('Choose an image file.'); return; }
    release(pendingUrl);
    const url = urlApi.createObjectURL(file);
    pendingUrl = url;
    message('Loading image…');
    void apply({ src: url, filename: file.name, url, thumb: url }, token, url).catch(() => {
      if (!current(token) || pendingUrl !== url) return;
      pendingUrl = undefined; release(url); message('Could not load image.');
    });
  };
  const replaceAsset = async () => {
    if (destroyed) return;
    const token = ++generation;
    release(pendingUrl); pendingUrl = undefined;
    try {
      const asset = await chooseAsset();
      if (!current(token) || !asset) { if (current(token)) message(''); return; }
      message('Loading image…'); await apply(asset, token);
    } catch { if (current(token)) message('Could not load image.'); }
  };
  bindImageReplaceControls(root, { onFile: replaceFile, signal });
  const reset = () => {
    generation += 1;
    release(pendingUrl);
    pendingUrl = undefined;
    const state = crop.getState();
    crop.setSource(state.source);
    message('');
  };
  const revert = () => {
    generation += 1;
    release(pendingUrl);
    pendingUrl = undefined;
    const previous = currentUrl;
    if (crop.restore(savedState)) {
      currentUrl = savedUrl;
      if (previous && previous !== savedUrl) release(previous);
    }
    message('');
  };
  root.querySelector('[data-crop-replace-assets]')?.addEventListener('click', (event) => { event.stopPropagation(); void replaceAsset(); }, { signal });
  root.querySelector('[data-demo-author-reset]')?.addEventListener('click', reset, { signal });
  root.querySelector('[data-demo-author-revert]')?.addEventListener('click', revert, { signal });
  root.querySelector('[data-demo-author-save]')?.addEventListener('click', () => {
    if (destroyed) return;
    savedState = crop.getState();
    const previous = savedUrl; savedUrl = currentUrl;
    if (previous && previous !== savedUrl) release(previous);
    message('Saved for this demo');
  }, { signal });
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    lifecycle.abort();
    const urls = new Set([pendingUrl, currentUrl, savedUrl]);
    urls.forEach((url) => release(url));
    pendingUrl = currentUrl = savedUrl = undefined;
  };
  return { reset, destroy };
}
