import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createCropDemoAuthoring } from '../../src/lib/cropDemoAuthoring';
import type { DemoImageCropState } from '../../src/lib/demoImageCrop';
import type { DemoImageReplacementAsset } from '../../src/lib/demoImageReplacement';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const response = (body: object = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const original = (): DemoImageCropState => ({ source: { src: '/images/original.preview.webp', width: 1200, height: 900, alt: 'Original' }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true });

function setup() {
  const win = new Window({ url: 'http://localhost/preview/image-framing' }); const parent = new Window({ url: 'http://localhost/image-framing' }); Object.defineProperty(win, 'parent', { value: parent });
  const root = win.document.createElement('div'); root.innerHTML = '<button data-crop-replace-assets>Assets</button><div data-crop-replace-drop><button data-crop-replace-choose>File</button><input data-crop-replace-file type="file"></div><p data-image-replacement-status hidden></p><button data-demo-author-reset>Reset</button><button data-demo-author-revert>Revert</button><button data-demo-author-save>Save</button>'; win.document.body.append(root);
  let state = original(); const crop = { getState: () => structuredClone(state), restore: (next: DemoImageCropState) => { state = structuredClone(next); return true; }, setSource: (source: DemoImageCropState['source']) => { state = { source: { ...source }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true }; return true; } };
  const images: Array<{ src: string; complete(): void; fail(): void }> = []; win.Image = class { naturalWidth = 1600; naturalHeight = 1200; onload?: () => void; onerror?: () => void; set src(src: string) { images.push({ src, complete: () => this.onload?.(), fail: () => this.onerror?.() }); } } as unknown as typeof win.Image;
  const picks: Array<ReturnType<typeof deferred<DemoImageReplacementAsset | undefined>>> = []; const chooseAsset = () => { const pick = deferred<DemoImageReplacementAsset | undefined>(); picks.push(pick); return pick.promise; };
  const requests: Array<{ url: string; body: any; signal?: AbortSignal }> = []; let respond = async (_url: string) => response(); win.fetch = (async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(String(init.body)), signal: init.signal as AbortSignal }); return respond(url); }) as typeof win.fetch;
  let written = 0; parent.addEventListener('vcd:dev-content-written', () => written++);
  const handle = createCropDemoAuthoring(root, crop, { documentKey: 'image-framing', path: ['sections', 0, 'sample'], sectionId: 'demo-image-framing', src: 'original.jpg', chooseAsset });
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-${name}]`)!;
  const pickFile = () => { const file = new win.File(['image'], 'chosen.png', { type: 'image/png' }); const input = root.querySelector<HTMLInputElement>('[data-crop-replace-file]')!; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new win.Event('change')); };
  return { win, parent, root, crop, handle, images, picks, requests, button, pickFile, status: () => root.querySelector('[data-image-replacement-status]')!.textContent, respond: (fn: typeof respond) => { respond = fn; }, get written() { return written; } };
}
const asset = (src: string): DemoImageReplacementAsset => ({ src, filename: src.split('/').pop()!, url: `/images/${src}.preview.webp`, thumb: `/images/${src}.thumb.webp` });

test('asset choice displays preview but saves original filename; reset and save preserve targets', async () => {
  const h = setup(); h.button('crop-replace-assets').click(); h.picks[0].resolve(asset('folder/foo bar.jpg')); await tick(); h.images[0].complete(); await tick(); expect(h.images[0].src).toBe('/images/folder/foo bar.jpg.preview.webp');
  h.button('demo-author-reset').click(); h.button('demo-author-save').click(); await tick(); expect(h.requests[0].body).toMatchObject({ src: 'folder/foo bar.jpg', path: ['sections', 0, 'sample'], target: { sectionId: 'demo-image-framing' } }); expect(h.status()).toBe(''); expect(h.written).toBe(1); h.handle.destroy();
});

test('revert restores the last saved image and crop, while failed save preserves it', async () => {
  const h = setup(); h.button('crop-replace-assets').click(); h.picks[0].resolve(asset('saved.jpg')); await tick(); h.images[0].complete(); await tick(); h.button('demo-author-save').click(); await tick(); const saved = h.crop.getState();
  h.button('crop-replace-assets').click(); h.picks[1].resolve(asset('later.jpg')); await tick(); h.images[1].complete(); await tick(); h.button('demo-author-revert').click(); expect(h.crop.getState()).toEqual(saved);
  h.respond(async () => response({ error: 'Could not write crop.' }, 400)); h.button('demo-author-save').click(); await tick(); expect(h.status()).toBe('Could not write crop.'); h.button('demo-author-revert').click(); expect(h.crop.getState()).toEqual(saved); h.handle.destroy();
});

test('picker cancellation and late image loads cannot change state after reset or destroy', async () => {
  const h = setup(); const before = h.crop.getState(); h.button('crop-replace-assets').click(); h.button('demo-author-reset').click(); h.picks[0].resolve(asset('late.jpg')); await tick(); expect(h.crop.getState()).toEqual(before); expect(h.status()).toBe('');
  h.button('crop-replace-assets').click(); h.handle.destroy(); h.picks[1].resolve(asset('destroyed.jpg')); await tick(); expect(h.crop.getState()).toEqual(before);
});

test('shared file input keeps raw base64 upload and returned original filename', async () => {
  const h = setup(); const reads: Array<() => void> = []; h.win.FileReader = class { result = 'data:image/png;base64,aW1hZ2U='; onload?: () => void; onerror?: () => void; readAsDataURL() { reads.push(() => this.onload?.()); } } as unknown as typeof h.win.FileReader;
  h.respond(async (url) => url === '/api/upload' ? response({ filenames: ['chosen-2.png'] }) : response()); h.pickFile(); reads[0](); await tick(); expect(h.requests[0].body.files[0]).toEqual({ filename: 'chosen.png', data: 'aW1hZ2U=', mimeType: 'image/png' }); h.images[0].complete(); await tick(); h.button('demo-author-save').click(); await tick(); expect(h.requests[1].body.src).toBe('chosen-2.png'); h.handle.destroy();
});

test('revert during file read prevents upload and destroy aborts in-flight upload', async () => {
  const h = setup(); const reads: Array<() => void> = []; h.win.FileReader = class { result = 'data:image/png;base64,aQ=='; onload?: () => void; readAsDataURL() { reads.push(() => this.onload?.()); } } as unknown as typeof h.win.FileReader;
  h.pickFile(); h.button('demo-author-revert').click(); reads[0](); await tick(); expect(h.requests).toHaveLength(0);
  const pending = deferred<Response>(); h.respond(() => pending.promise); h.pickFile(); reads[1](); await tick(); h.handle.destroy(); expect(h.requests[0].signal?.aborted).toBe(true); pending.resolve(response({ filenames: ['late.png'] })); await tick(); expect(h.images).toHaveLength(0);
});

test('a successful save clears an earlier save error and stale responses cannot restore feedback after reset', async () => {
  const h = setup();
  h.respond(async () => response({ error: 'Could not write crop.' }, 400));
  h.button('demo-author-save').click();
  await tick();
  expect(h.status()).toBe('Could not write crop.');
  h.respond(async () => response());
  h.button('demo-author-save').click();
  expect(h.status()).toBe('');
  await tick();
  expect(h.status()).toBe('');
  const pending = deferred<Response>();
  h.respond(() => pending.promise);
  h.button('demo-author-save').click();
  h.button('demo-author-reset').click();
  pending.resolve(response());
  await tick();
  expect(h.status()).toBe('');
  expect(h.button('demo-author-save').dataset.saveState).toBe('idle');
  h.handle.destroy();
});

test('save commits the requested snapshot even if another image is selected during the write', async () => {
  const h = setup();
  const saved = h.crop.getState();
  const pending = deferred<Response>();
  h.respond(() => pending.promise);
  h.button('demo-author-save').click();
  h.button('crop-replace-assets').click();
  h.picks[0].resolve(asset('later.jpg'));
  await tick();
  h.images[0].complete();
  await tick();
  pending.resolve(response());
  await tick();
  expect(h.requests[0].body.src).toBe('original.jpg');
  h.button('demo-author-revert').click();
  expect(h.crop.getState()).toEqual(saved);
  expect(h.written).toBe(1);
  h.handle.destroy();
});
