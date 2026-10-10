import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoCropBitmap } from '../../src/lib/demoCropBitmap';

const setup = () => {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = '<div><img id="main" alt="Source"><img id="ghost" alt=""><img id="preview" alt=""></div>';
  const image = document.querySelector('#main') as HTMLImageElement;
  const ghost = document.querySelector('#ghost') as HTMLImageElement;
  const preview = document.querySelector('#preview') as HTMLImageElement;
  for (const item of [image, ghost, preview]) {
    Object.defineProperty(item, 'naturalWidth', { configurable: true, value: 100 });
    Object.defineProperty(item, 'naturalHeight', { configurable: true, value: 80 });
  }
  let draws = 0;
  win.HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => { draws += 1; } })) as typeof win.HTMLCanvasElement.prototype.getContext;
  return { win, image, ghost, preview, draws: () => draws };
};

test('draws one main bitmap and derives ghost and preview without changing the accessible image', async () => {
  const h = setup();
  h.image.decode = async () => {};
  const bitmap = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost, previewImage: h.preview });
  expect(await bitmap.prepare('/source.jpg')).toBe(true);
  expect(h.draws()).toBe(3);
  expect(h.image.style.opacity).toBe('0');
  expect(h.image.alt).toBe('Source');
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(3);
  expect(await bitmap.prepare('/source.jpg')).toBe(true);
  expect(h.draws()).toBe(3);
  bitmap.destroy();
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(0);
  expect(h.image.style.opacity).toBe('');
});

test('a replacement race only installs the newest decoded source', async () => {
  const h = setup();
  const pending: Array<() => void> = [];
  h.image.decode = () => new Promise<void>((resolve) => pending.push(resolve));
  const bitmap = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost });
  const old = bitmap.prepare('/old.jpg');
  const next = bitmap.prepare('/new.jpg');
  pending[1]();
  expect(await next).toBe(true);
  pending[0]();
  expect(await old).toBe(false);
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(2);
  bitmap.destroy();
});

test('destroy cancels a pending decode and restores the original image', async () => {
  const h = setup();
  let resolveDecode!: () => void;
  h.image.decode = () => new Promise<void>((resolve) => { resolveDecode = resolve; });
  const bitmap = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost });
  const ready = bitmap.prepare('/source.jpg');
  bitmap.destroy();
  resolveDecode();
  expect(await ready).toBe(false);
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(0);
  expect(h.image.style.opacity).toBe('');
});

test('falls back when canvas is unavailable or the source exceeds the pixel ceiling', async () => {
  const h = setup();
  h.image.decode = async () => {};
  h.win.HTMLCanvasElement.prototype.getContext = (() => null) as typeof h.win.HTMLCanvasElement.prototype.getContext;
  const unavailable = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost });
  expect(await unavailable.prepare('/source.jpg')).toBe(false);
  expect(h.image.style.opacity).toBe('');
  Object.defineProperty(h.image, 'naturalWidth', { configurable: true, value: 3000 });
  Object.defineProperty(h.image, 'naturalHeight', { configurable: true, value: 3000 });
  h.win.HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as typeof h.win.HTMLCanvasElement.prototype.getContext;
  const oversized = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost });
  expect(await oversized.prepare('/large.jpg')).toBe(false);
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(0);
});

test('cleans every detached canvas when a later surface cannot be painted', async () => {
  const h = setup();
  h.image.decode = async () => {};
  let draws = 0;
  h.win.HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => { draws += 1; if (draws === 3) throw new Error('preview failed'); } })) as typeof h.win.HTMLCanvasElement.prototype.getContext;
  h.image.style.opacity = '0.4'; h.ghost.style.opacity = '0.6'; h.preview.style.opacity = '0.7';
  const bitmap = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost, previewImage: h.preview });
  expect(await bitmap.prepare('/source.jpg')).toBe(false);
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(0);
  expect(h.image.style.opacity).toBe('0.4');
  expect(h.ghost.style.opacity).toBe('0.6');
  expect(h.preview.style.opacity).toBe('0.7');
});

test('decode rejection leaves the original images and their opacity untouched', async () => {
  const h = setup();
  h.image.style.opacity = '0.4'; h.ghost.style.opacity = '0.6';
  h.image.decode = async () => { throw new Error('decode failed'); };
  const bitmap = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost });
  expect(await bitmap.prepare('/source.jpg')).toBe(false);
  expect(h.win.document.querySelectorAll('.demo-crop-bitmap')).toHaveLength(0);
  expect(h.image.style.opacity).toBe('0.4');
  expect(h.ghost.style.opacity).toBe('0.6');
});

test('restores preset opacity when replacing an installed bitmap', async () => {
  const h = setup();
  h.image.style.opacity = '0.4'; h.ghost.style.opacity = '0.6';
  h.image.decode = async () => {};
  const bitmap = createDemoCropBitmap({ image: h.image, ghostImage: h.ghost });
  expect(await bitmap.prepare('/source.jpg')).toBe(true);
  expect(h.image.style.opacity).toBe('0');
  h.image.decode = async () => { throw new Error('replacement failed'); };
  expect(await bitmap.prepare('/replacement.jpg')).toBe(false);
  expect(h.image.style.opacity).toBe('0.4');
  expect(h.ghost.style.opacity).toBe('0.6');
});
