import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoImageReplacement, type DemoImageReplacementAsset } from '../../src/lib/demoImageReplacement';
import type { DemoImageCropState } from '../../src/lib/demoImageCrop';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const state = (src = '/original.webp'): DemoImageCropState => ({ source: { src, width: 1200, height: 900, alt: 'Original' }, crop: { aspect: '3:2', cx: 0.31, cy: 0.68, w: 0.57 }, locked: false, variants: {
  desktop: { aspect: '3:2', cx: 0.31, cy: 0.68, w: 0.57 },
  tablet: { aspect: '4:3', cx: 0.62, cy: 0.27, w: 0.49 },
  mobile: { aspect: '1:1', cx: 0.74, cy: 0.41, w: 0.38 },
} });

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const root = win.document.createElement('div');
  root.innerHTML = '<button data-crop-replace-assets>Assets</button><div data-crop-replace-drop><button data-crop-replace-choose>Choose</button><input data-crop-replace-file type="file"></div><p data-image-replacement-status hidden></p><button data-demo-author-reset>Reset</button><button data-demo-author-revert>Revert</button><button data-demo-author-save>Save</button>';
  let serial = 0; const live = new Set<string>(); const revoked: string[] = [];
  win.URL.createObjectURL = (() => { const url = `blob:test-${++serial}`; live.add(url); return url; }) as typeof win.URL.createObjectURL;
  win.URL.revokeObjectURL = ((url: string) => { live.delete(url); revoked.push(url); }) as typeof win.URL.revokeObjectURL;
  const sources: DemoImageCropState['source'][] = []; let current = state();
  const crop = {
    getState: () => structuredClone(current),
    restore: (next: DemoImageCropState) => { current = structuredClone(next); return true; },
    setSource: (source: DemoImageCropState['source']) => { current = { source: { ...source }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true }; sources.push({ ...source }); return true; },
  };
  const images: Array<{ src: string; complete(): void; fail(): void }> = [];
  win.Image = class { naturalWidth = 1600; naturalHeight = 1200; onload?: () => void; onerror?: () => void; set src(src: string) { images.push({ src, complete: () => this.onload?.(), fail: () => this.onerror?.() }); queueMicrotask(() => this.onload?.()); } } as unknown as typeof win.Image;
  const picks: Array<ReturnType<typeof deferred<DemoImageReplacementAsset | undefined>>> = [];
  const chooseAsset = () => { const pick = deferred<DemoImageReplacementAsset | undefined>(); picks.push(pick); return pick.promise; };
  const handle = createDemoImageReplacement(root, crop, { chooseAsset });
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-${name}]`)!;
  const pickFile = (name: string, type = 'image/png') => { const file = new win.File(['image'], name, { type }); const input = root.querySelector<HTMLInputElement>('[data-crop-replace-file]')!; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new win.Event('change')); };
  return { win, root, crop, sources, images, live, revoked, picks, handle, button, pickFile, status: () => root.querySelector('[data-image-replacement-status]')!.textContent };
}
const asset = (name: string): DemoImageReplacementAsset => ({ src: name, filename: name.split('/').pop()!, url: `/preview/${name}`, thumb: `/thumb/${name}` });

test('file replacement uses owner-window image and keeps the current blob alive', async () => {
  const h = setup(); h.pickFile('new.png'); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.sources[0]).toMatchObject({ width: 1600, height: 1200, alt: 'new.png' }); expect(h.live.size).toBe(1); h.handle.destroy(); expect(h.live.size).toBe(0);
});

test('invalid files and failed images preserve the displayed state', async () => {
  const h = setup(); h.pickFile('bad.txt', 'text/plain'); expect(h.sources).toHaveLength(0); expect(h.status()).toBe('Choose an image file.');
  h.win.Image = class { naturalWidth = 1600; naturalHeight = 1200; onload?: () => void; onerror?: () => void; set src(src: string) { h.images.push({ src, complete: () => this.onload?.(), fail: () => this.onerror?.() }); } } as unknown as typeof h.win.Image;
  h.pickFile('broken.png'); h.images[0].fail(); await new Promise((resolve) => setTimeout(resolve, 0)); expect(h.sources).toHaveLength(0); expect(h.status()).toBe('Could not load image.'); h.handle.destroy();
});

test('catalog selection uses preview URL and filename, and cancellation preserves state', async () => {
  const h = setup(); const initial = h.crop.getState(); h.button('crop-replace-assets').click(); h.picks[0].resolve(asset('folder/photo.jpg')); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.sources[0]).toMatchObject({ src: '/preview/folder/photo.jpg', alt: 'photo.jpg', width: 1600, height: 1200 });
  h.button('crop-replace-assets').click(); h.button('demo-author-revert').click(); h.picks[1].resolve(undefined); await Promise.resolve(); expect(h.crop.getState()).toEqual(initial); h.handle.destroy();
});

test('save, change, and revert restore the saved image and crop in memory', async () => {
  const h = setup(); h.pickFile('saved.png'); await new Promise((resolve) => setTimeout(resolve, 0)); h.button('demo-author-save').click(); const saved = h.crop.getState();
  h.pickFile('later.png'); await new Promise((resolve) => setTimeout(resolve, 0)); expect(h.live.size).toBe(2); h.button('demo-author-revert').click(); expect(h.crop.getState()).toEqual(saved); expect(h.status()).toBe(''); h.handle.destroy();
});

test('revert reclaims unsaved blobs and keeps the saved blob for later revert', async () => {
  const h = setup();
  h.pickFile('a.png'); await new Promise((resolve) => setTimeout(resolve, 0));
  h.button('demo-author-save').click();
  h.pickFile('b.png'); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.live.size).toBe(2);
  h.button('demo-author-revert').click();
  expect(h.live.size).toBe(1);
  h.button('demo-author-save').click();
  h.pickFile('c.png'); await new Promise((resolve) => setTimeout(resolve, 0));
  h.button('demo-author-revert').click();
  expect(h.crop.getState().source.alt).toBe('a.png');
  expect(h.live.size).toBe(1);
  h.handle.destroy();
});

test('newest overlapping decode wins and stale pending URLs are revoked', async () => {
  const h = setup(); h.pickFile('a.png'); h.pickFile('b.png'); await new Promise((resolve) => setTimeout(resolve, 0)); expect(h.sources).toHaveLength(1); expect(h.sources[0].alt).toBe('b.png'); expect(h.live.size).toBe(1); h.handle.destroy();
});

test('reset cancels pending work and restores first-load state; destroy revokes unique blobs', async () => {
  const h = setup(); const initial = h.crop.getState(); h.pickFile('a.png'); h.handle.reset(); await new Promise((resolve) => setTimeout(resolve, 0)); expect(h.crop.getState()).toEqual(initial); expect(h.sources).toHaveLength(0); expect(h.live.size).toBe(0);
  h.pickFile('b.png'); await new Promise((resolve) => setTimeout(resolve, 0)); h.button('demo-author-save').click(); h.handle.destroy(); expect(h.live.size).toBe(0); expect(new Set(h.revoked).size).toBe(h.revoked.length);
});

test('reset clears an unsaved current blob while revert still restores the saved blob', async () => {
  const h = setup(); const initial = h.crop.getState();
  h.pickFile('saved.png'); await new Promise((resolve) => setTimeout(resolve, 0)); h.button('demo-author-save').click(); const saved = h.crop.getState();
  h.pickFile('unsaved.png'); await new Promise((resolve) => setTimeout(resolve, 0)); h.handle.reset(); expect(h.crop.getState()).toEqual(initial); expect(h.live.size).toBe(1);
  h.button('demo-author-revert').click(); expect(h.crop.getState()).toEqual(saved); expect(h.live.size).toBe(1);
  h.handle.reset(); expect(h.crop.getState()).toEqual(initial); h.handle.reset(); expect(h.crop.getState()).toEqual(initial);
  h.button('demo-author-revert').click(); expect(h.crop.getState()).toEqual(saved); expect(h.live.size).toBe(1);
  h.handle.destroy(); expect(h.live.size).toBe(0); expect(new Set(h.revoked).size).toBe(h.revoked.length);
});
