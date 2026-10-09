import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createCropDemoAuthoring } from '../../src/lib/cropDemoAuthoring';
import type { DemoImageCropState } from '../../src/lib/demoImageCrop';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const response = (body: object = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function setup() {
  const win = new Window({ url: 'http://localhost/preview/image-framing' });
  const parent = new Window({ url: 'http://localhost/image-framing' });
  Object.defineProperty(win, 'parent', { value: parent });
  parent.document.body.innerHTML = '<div data-dev-asset-manager></div>';
  const root = win.document.createElement('div');
  root.innerHTML = `<button data-crop-replace-assets>Assets</button>
    <div data-crop-replace-drop><button data-crop-replace-choose>File system</button><input data-crop-replace-file type="file"></div>
    <p data-image-replacement-status hidden></p><button data-demo-author-reset>Reset</button>
    <button data-demo-author-revert>Revert</button><button data-demo-author-save>Save</button>`;
  win.document.body.append(root);
  let state: DemoImageCropState = {
    source: { src: '/images/original.preview.webp', width: 1200, height: 900, alt: 'Original' },
    crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true,
  };
  const crop = {
    getState: () => structuredClone(state),
    restore(next: DemoImageCropState) { state = structuredClone(next); return true; },
    setSource(source: DemoImageCropState['source']) {
      state = { source: { ...source }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true };
      return true;
    },
  };
  const images: Array<{ src: string; complete(): void; fail(): void }> = [];
  win.Image = class {
    naturalWidth = 1600;
    naturalHeight = 1200;
    onload?: () => void;
    onerror?: () => void;
    set src(src: string) { images.push({ src, complete: () => this.onload?.(), fail: () => this.onerror?.() }); }
  } as unknown as typeof win.Image;
  const reads: Array<() => void> = [];
  win.FileReader = class {
    result = 'data:image/png;base64,aW1hZ2U=';
    onload?: () => void;
    readAsDataURL() { reads.push(() => this.onload?.()); }
  } as unknown as typeof win.FileReader;
  const requests: Array<{ url: string; body: any; signal?: AbortSignal }> = [];
  let respond = async (_url: string) => response();
  win.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)), signal: init.signal as AbortSignal });
    return respond(url);
  }) as typeof win.fetch;
  const picks: Array<{ resolve(result: { srcs: string[] }): Promise<void>; reject(): void }> = [];
  let written = 0;
  parent.addEventListener('vcd:dev-asset-manager-open', (event) => picks.push((event as CustomEvent).detail));
  parent.addEventListener('vcd:dev-content-written', () => written++);
  const handle = createCropDemoAuthoring(root as unknown as HTMLElement, crop, {
    documentKey: 'image-framing', path: ['sections', 0, 'sample'], sectionId: 'demo-image-framing', src: 'original.jpg',
  });
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-${name}]`)!;
  const choose = async (filename: string) => {
    button('crop-replace-assets').click();
    const pending = picks.at(-1)!.resolve({ srcs: [filename] });
    images.at(-1)!.complete();
    await pending;
  };
  const pickFile = () => {
    const file = new win.File(['image'], 'chosen.png', { type: 'image/png' });
    const input = root.querySelector<HTMLInputElement>('[data-crop-replace-file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new win.Event('change'));
  };
  return { win, parent, root, crop, handle, images, reads, requests, picks, button, choose, pickFile,
    status: () => root.querySelector('[data-image-replacement-status]')!.textContent,
    respond: (fn: typeof respond) => { respond = fn; },
    get written() { return written; },
  };
}

test('asset choice maps its URL and Reset/Save retain the original filename and stable content target', async () => {
  const h = setup();
  await h.choose('folder/foo bar.jpg');
  expect(h.images[0].src).toBe('/images/folder/foo%20bar.jpg');
  expect(h.crop.getState().source.width).toBe(1600);
  h.button('demo-author-reset').click();
  h.button('demo-author-save').click();
  await tick();
  expect(h.requests[0].body).toMatchObject({ document: 'image-framing', path: ['sections', 0, 'sample'], target: { sectionId: 'demo-image-framing' }, src: 'folder/foo bar.jpg' });
  expect(h.requests[0].body.variants.desktop).toEqual(h.crop.getState().crop);
  expect(h.written).toBe(1);
  expect(h.status()).toBe('Saved');
  h.handle.destroy();
});

test('Reset before a replacement preserves the original filename behind a preview derivative', async () => {
  const h = setup();
  h.button('demo-author-reset').click();
  h.button('demo-author-save').click();
  await tick();
  expect(h.requests[0].body.src).toBe('original.jpg');
  h.handle.destroy();
});

test('Save captures its request snapshot even when the selected image changes before it completes', async () => {
  const h = setup();
  const pending = deferred<Response>();
  h.respond(() => pending.promise);
  await h.choose('saved.jpg');
  const saved = h.crop.getState();
  h.button('demo-author-save').click();
  expect(h.button('demo-author-save').disabled).toBe(true);
  await h.choose('later.jpg');
  pending.resolve(response());
  await tick();
  h.button('demo-author-revert').click();
  expect(h.crop.getState()).toEqual(saved);
  h.respond(async () => response());
  h.button('demo-author-save').click();
  await tick();
  expect(h.requests.at(-1)!.body.src).toBe('saved.jpg');
  h.handle.destroy();
});

test('a failed Save preserves the previous saved state and reports the failure', async () => {
  const h = setup();
  const saved = h.crop.getState();
  await h.choose('unsaved.jpg');
  h.respond(async () => response({ error: 'Could not write crop.' }, 400));
  h.button('demo-author-save').click();
  await tick();
  expect(h.status()).toBe('Could not write crop.');
  expect(h.button('demo-author-save').disabled).toBe(false);
  expect(h.written).toBe(0);
  h.button('demo-author-revert').click();
  expect(h.crop.getState()).toEqual(saved);
  h.handle.destroy();
});

for (const cancel of ['revert', 'destroy'] as const) {
  test(`late image load cannot change crop or status after ${cancel}`, async () => {
    const h = setup();
    const saved = h.crop.getState();
    h.button('crop-replace-assets').click();
    const pending = h.picks[0].resolve({ srcs: ['late.jpg'] });
    expect(h.images.length).toBe(1);
    if (cancel === 'revert') h.button('demo-author-revert').click();
    else h.handle.destroy();
    const status = h.status();
    h.images[0].complete();
    await pending;
    expect(h.crop.getState()).toEqual(saved);
    expect(h.status()).toBe(status);
    h.handle.destroy();
  });
}

test('missing parent asset manager reports an actionable error', () => {
  const h = setup();
  h.parent.document.body.innerHTML = '';
  h.button('crop-replace-assets').click();
  expect(h.status()).toContain('/image-framing');
  expect(h.picks.length).toBe(0);
  h.handle.destroy();
});

test('the shared file input uploads then saves the returned original filename', async () => {
  const h = setup();
  h.respond(async (url) => url === '/api/upload' ? response({ filenames: ['chosen-2.png'] }) : response());
  h.pickFile();
  h.reads[0]();
  await tick();
  expect(h.requests[0].body.files[0]).toEqual({ filename: 'chosen.png', data: 'aW1hZ2U=', mimeType: 'image/png' });
  expect(h.images[0].src).toBe('/images/chosen-2.png');
  h.images[0].complete();
  await tick();
  h.button('demo-author-save').click();
  await tick();
  expect(h.requests[1].body.src).toBe('chosen-2.png');
  h.handle.destroy();
});

test('Revert during a file read prevents upload; destroy during upload prevents a later image load', async () => {
  const h = setup();
  h.pickFile();
  h.button('demo-author-revert').click();
  h.reads[0]();
  await tick();
  expect(h.requests.length).toBe(0);
  const pending = deferred<Response>();
  h.respond(() => pending.promise);
  h.pickFile();
  h.reads[1]();
  await tick();
  h.handle.destroy();
  expect(h.requests[0].signal?.aborted).toBe(true);
  pending.resolve(response({ filenames: ['late.png'] }));
  await tick();
  expect(h.images.length).toBe(0);
});
