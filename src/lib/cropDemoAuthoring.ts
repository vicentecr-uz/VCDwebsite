import { bindImageReplaceControls } from './imageReplaceControls';
import { isAcceptedImageFile, isVideoSrc } from './imageUpload.mjs';
import { projectImage } from './images';
import type { DemoImageCropState } from './demoImageCrop';

type CropAdapter = {
  getState(): DemoImageCropState;
  restore(state: DemoImageCropState): boolean;
  setSource(source: DemoImageCropState['source']): boolean;
};
type Options = { documentKey: string; path: Array<string | number>; sectionId: string; src: string };

export function createCropDemoAuthoring(root: HTMLElement, crop: CropAdapter, options: Options) {
  const win = root.ownerDocument.defaultView!;
  const lifecycle = new win.AbortController();
  const { signal } = lifecycle;
  const status = root.querySelector<HTMLElement>('[data-image-replacement-status]');
  const saveButton = root.querySelector<HTMLButtonElement>('[data-demo-author-save]');
  let generation = 0;
  let sourceName = options.src;
  let savedState = crop.getState();
  let savedName = sourceName;
  const current = (token: number) => !signal.aborted && token === generation;
  const message = (value: string, token = generation) => {
    if (!current(token) || !status) return;
    status.textContent = value;
    status.hidden = !value;
  };
  const readFile = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
  const loadImage = (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new win.Image();
    image.onload = () => image.naturalWidth && image.naturalHeight
      ? resolve({ width: image.naturalWidth, height: image.naturalHeight })
      : reject(new Error('Could not read image dimensions.'));
    image.onerror = () => reject(new Error('Could not load the image.'));
    image.src = src;
  });
  const replace = async (filename: string, token: number) => {
    if (!current(token)) return;
    if (isVideoSrc(filename)) throw new Error('Choose an image file.');
    const src = projectImage(filename);
    const dimensions = await loadImage(src);
    if (!current(token)) return;
    if (!crop.setSource({ src, ...dimensions, alt: filename.split('/').pop()! })) {
      throw new Error('Could not replace the image.');
    }
    sourceName = filename;
    message('', token);
  };
  const onFile = async (file?: File) => {
    if (!file || signal.aborted) return;
    const token = ++generation;
    if (!isAcceptedImageFile(file)) { message('Choose an image file.', token); return; }
    message('Loading image…', token);
    try {
      const data = await readFile(file);
      if (!current(token)) return;
      const response = await win.fetch('/api/upload', {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: options.documentKey, files: [{ filename: file.name, data, mimeType: file.type }] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not upload the image.');
      const filename = String(result.filenames?.[0] || '');
      if (!filename) throw new Error('Could not upload the image.');
      await replace(filename, token);
    } catch (error) {
      message(error instanceof Error ? error.message : 'Could not replace the image.', token);
    }
  };
  bindImageReplaceControls(root, { onFile, signal });
  root.querySelector('[data-crop-replace-assets]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    let parent: Window & typeof globalThis;
    try {
      parent = win.parent as Window & typeof globalThis;
      if (!parent.document.querySelector('[data-dev-asset-manager]')) throw new Error('missing');
    } catch { message('Open /image-framing to choose an asset.'); return; }
    const token = ++generation;
    let settled = false;
    parent.dispatchEvent(new parent.CustomEvent('vcd:dev-asset-manager-open', {
      detail: {
        documentKey: options.documentKey, project: options.documentKey, mode: 'pick', max: 1, type: 'image',
        opener: win.frameElement,
        resolve: async (result: { srcs?: string[] }) => {
          if (settled || !current(token)) return;
          settled = true;
          const filename = result.srcs?.[0];
          if (!filename) { message('', token); return; }
          message('Loading image…', token);
          try { await replace(filename, token); }
          catch (error) { message(error instanceof Error ? error.message : 'Could not replace the image.', token); }
        },
        reject: () => { settled = true; message('', token); },
      },
    }));
  }, { signal });
  const reset = () => {
    generation += 1;
    crop.setSource(crop.getState().source);
    message('');
  };
  root.querySelector('[data-demo-author-reset]')?.addEventListener('click', reset, { signal });
  root.querySelector('[data-demo-author-revert]')?.addEventListener('click', () => {
    generation += 1;
    crop.restore(savedState);
    sourceName = savedName;
    message('');
  }, { signal });
  saveButton?.addEventListener('click', async () => {
    if (saveButton.disabled || signal.aborted) return;
    const token = generation;
    const state = crop.getState();
    const name = sourceName;
    saveButton.disabled = true;
    message('Saving…', token);
    try {
      const response = await win.fetch('/api/image-crop', {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: options.documentKey, path: options.path, target: { sectionId: options.sectionId }, src: name,
          variants: { desktop: state.crop, tablet: state.crop, mobile: state.crop } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the image.');
      if (signal.aborted) return;
      savedState = state;
      savedName = name;
      message('Saved', token);
      const parent = win.parent as Window & typeof globalThis;
      parent.dispatchEvent(new parent.CustomEvent('vcd:dev-content-written'));
    } catch (error) {
      message(error instanceof Error ? error.message : 'Could not save the image.', token);
    } finally {
      if (!signal.aborted) saveButton.disabled = false;
    }
  }, { signal });
  return { reset, destroy: () => lifecycle.abort() };
}
