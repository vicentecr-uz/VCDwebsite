import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoImageReplacement } from '../../src/lib/demoImageReplacement';

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const root = win.document.createElement('div');
  root.innerHTML = '<div data-crop-replace-drop><button data-crop-replace-choose>Choose</button><input data-crop-replace-file type="file"></div><p data-image-replacement-status hidden></p>';
  let serial = 0;
  const urls = new Set<string>();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => { const url = `blob:test-${++serial}`; urls.add(url); return url; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => urls.delete(url)) as typeof URL.revokeObjectURL;
  const sources: Array<Record<string, unknown>> = [];
  let resets = 0;
  const crop = { setSource: (source: Record<string, unknown>) => { sources.push(source); return true; }, reset: () => { resets += 1; } };
  return { win, root, urls, sources, crop, get resets() { return resets; }, restore: () => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; } };
}

function choose(h: ReturnType<typeof setup>, file: File) {
  const input = h.root.querySelector('[data-crop-replace-file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: { 0: file, length: 1, item: () => file } });
  input.dispatchEvent(new h.win.Event('change'));
}

test('accepts a decoded image with dimensions and keeps its blob alive', async () => {
  const h = setup(); const originalImage = globalThis.Image;
  try {
    globalThis.Image = class { naturalWidth = 640; naturalHeight = 480; decode = async () => {}; set src(_: string) {} } as unknown as typeof Image;
    const handle = createDemoImageReplacement(h.root, h.crop);
    choose(h, new h.win.File(['image'], 'new.png', { type: 'image/png' })); await Promise.resolve();
    expect(h.sources[0]).toMatchObject({ width: 640, height: 480, alt: 'new.png' }); expect(h.urls.size).toBe(1);
    handle.reset(); expect(h.urls.size).toBe(0); handle.destroy();
  } finally { globalThis.Image = originalImage; h.restore(); }
});

test('invalid files show an error and preserve the current image', async () => {
  const h = setup(); const originalImage = globalThis.Image;
  try {
    globalThis.Image = class { naturalWidth = 640; naturalHeight = 480; decode = async () => {}; set src(_: string) {} } as unknown as typeof Image;
    const handle = createDemoImageReplacement(h.root, h.crop);
    choose(h, new h.win.File(['image'], 'good.png', { type: 'image/png' })); await Promise.resolve();
    choose(h, new h.win.File(['text'], 'bad.txt', { type: 'text/plain' }));
    expect(h.sources).toHaveLength(1); expect(h.root.querySelector('[data-image-replacement-status]')?.textContent).toBe('Choose an image file.'); handle.destroy();
  } finally { globalThis.Image = originalImage; h.restore(); }
});

test('the newest overlapping decode wins and stale completion is revoked', async () => {
  const h = setup(); const originalImage = globalThis.Image; const pending: Array<{ resolve: () => void }> = [];
  try {
    globalThis.Image = class { naturalWidth = 800; naturalHeight = 600; decode = () => new Promise<void>((resolve) => pending.push({ resolve })); set src(_: string) {} } as unknown as typeof Image;
    const handle = createDemoImageReplacement(h.root, h.crop);
    choose(h, new h.win.File(['a'], 'a.png', { type: 'image/png' })); choose(h, new h.win.File(['b'], 'b.png', { type: 'image/png' }));
    pending[1].resolve(); await Promise.resolve(); pending[0].resolve(); await Promise.resolve();
    expect(h.sources).toHaveLength(1); expect(h.sources[0].alt).toBe('b.png'); expect(h.urls.size).toBe(1); handle.destroy();
  } finally { globalThis.Image = originalImage; h.restore(); }
});

test('reset and destroy prevent late completion and revoke pending URLs', async () => {
  const h = setup(); const originalImage = globalThis.Image; const pending: Array<() => void> = [];
  try {
    globalThis.Image = class { naturalWidth = 800; naturalHeight = 600; decode = () => new Promise<void>((resolve) => pending.push(resolve)); set src(_: string) {} } as unknown as typeof Image;
    const handle = createDemoImageReplacement(h.root, h.crop);
    choose(h, new h.win.File(['a'], 'a.png', { type: 'image/png' })); handle.reset(); pending[0](); await Promise.resolve();
    expect(h.sources).toHaveLength(0); expect(h.resets).toBe(1); expect(h.urls.size).toBe(0);
    choose(h, new h.win.File(['b'], 'b.png', { type: 'image/png' })); handle.destroy(); pending[1](); await Promise.resolve();
    expect(h.sources).toHaveLength(0); expect(h.urls.size).toBe(0);
    choose(h, new h.win.File(['c'], 'c.png', { type: 'image/png' })); expect(pending).toHaveLength(2);
  } finally { globalThis.Image = originalImage; h.restore(); }
});
