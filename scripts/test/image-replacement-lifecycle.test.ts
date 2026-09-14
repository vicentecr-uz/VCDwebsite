import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { imageVariantSettingSource, setImageVariantSetting } from '../../src/lib/imageVariantInheritance';
import { coverWidthFraction, normalizeImageVariants } from '../../src/lib/responsiveImage';

const source = readFileSync(new URL('../../src/components/project/ProjectImageCropTuner.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => {
  const index = source.indexOf(start);
  if (index < 0 || source.indexOf(end, index) < 0) throw new Error(`Missing test boundary: ${start}`);
  return source.slice(index, source.indexOf(end, index));
};
const compile = (body: string, env: object) => new Function('env', `with(env) { ${new Bun.Transpiler({ loader: 'ts' }).transformSync(body)} }`)(env);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup() {
  const win = new Window();
  const probes: Probe[] = [];
  class Probe extends EventTarget {
    src = '';
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    decode = () => Promise.resolve();
    constructor() { super(); probes.push(this); }
    load() {
      this.complete = true;
      this.naturalWidth = 4000;
      this.naturalHeight = 2650;
      this.dispatchEvent(new Event('load'));
    }
  }
  const target = win.document.createElement('figure');
  target.dataset.devImageSrcWidth = '1600';
  target.dataset.devImageSrcHeight = '1200';
  target.setAttribute('data-dev-image-target', '');
  const image = { src: '/images/placeholder.svg', getAttribute: () => image.src, decode: () => Promise.resolve() };
  const preview = { src: image.src, decode: () => Promise.resolve() };
  const uploads: ReturnType<typeof deferred<string>>[] = [];
  const handlers = new Map<string, (event: any) => void>();
  const panel = win.document.createElement('aside');
  const env: any = {
    Image: Probe, HTMLElement: win.HTMLElement, projectImage: (src: string) => `/images/${src}`,
    editTarget: target, activeSlot: 'cover', selectedViewport: 'desktop', replacementSession: 1,
    sourceRevision: 1, replacementAttempt: 0, replacementPending: false,
    saveButton: win.document.createElement('button'), status: win.document.createElement('p'),
    draftSrc: 'placeholder.svg', draftSrcWidth: 1600, draftSrcHeight: 1200,
    draftVariants: { desktop: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 } },
    draftHoverVariants: null, draft: {}, undoStack: [], redoStack: [],
    authored: { cover: { desktop: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 } }, hover: {}, constrained: {} },
    imageVariantSettingSource, setImageVariantSetting, coverWidthFraction, syncAuthorship: () => {},
    isListingCover: () => false, VIEWPORTS: ['desktop'], coverW: () => 1,
    pageStage: null, previewImage: preview, editedImage: image,
    targetWasCropped: false, liveApply: false, editingSession: true,
    renderDraft: () => {}, mountPageStage: () => {}, syncDraftDirty: () => {}, draftDirty: false,
    isAcceptedImageFile: (file: any) => file.type === 'image/png',
    uploadReplaceFile: () => { const job = deferred<string>(); uploads.push(job); return job.promise; },
    tuner: { closest: () => panel },
    window: {
      addEventListener: (name: string, handler: any) => handlers.set(name, handler),
      dispatchEvent: (event: any) => { if (event.type === 'vcd:dev-edit-open') env.editTarget = event.detail.trigger; },
    },
    replaceAssetsButton: { addEventListener: (_: string, handler: any) => handlers.set('library', handler) },
  };
  env.resolveAuthoredDraft = () => { env.draftVariants = normalizeImageVariants(env.authored.cover, 'original'); env.draft = env.draftVariants.desktop; };
  env.snapshotViewport = () => ({ src: env.draftSrc, srcWidth: env.draftSrcWidth, srcHeight: env.draftSrcHeight });
  env.pushUndo = () => { env.undoStack.push(env.snapshotViewport()); if (env.undoStack.length > 20) env.undoStack.shift(); env.redoStack = []; };
  env.applySrcLive = (_: unknown, src: string, dims: any) => {
    env.sourceRevision++;
    image.src = `/images/${src}`;
    target.dataset.devImageSrcWidth = String(dims.srcWidth);
    target.dataset.devImageSrcHeight = String(dims.srcHeight);
    return image;
  };
  env.applyUndoEntry = (entry: any) => {
    api.invalidateReplacement();
    env.draftSrc = entry.src; env.draftSrcWidth = entry.srcWidth; env.draftSrcHeight = entry.srcHeight;
    env.applySrcLive(target, entry.src, entry);
  };
  const api = compile([
    between('    const invalidateReplacement =', '    const applyUndoEntry ='),
    between('    type ReplacementContext =', '    const replaceControlFrom ='),
    'return { invalidateReplacement, replacementContext, startReplacement, replaceWithFile, setReplacementPending, setReplacementError, isCurrentReplacement };',
  ].join('\n'), env);
  Object.assign(env, api);
  compile(between("    window.addEventListener('vcd:dev-before-save'", "    window.addEventListener('vcd:dev-has-draft'"), env);
  compile(between("    window.addEventListener('vcd:dev-image-replace'", '    const teardownEditSession ='), env);
  compile(between("    replaceAssetsButton.addEventListener('click'", '    // Stop page-level image-drop'), env);
  return { env, api, image, preview, probes, uploads, handlers, target };
}
const file = { type: 'image/png' };

test('upload blocks Save until canonical image dimensions and page decode are ready', async () => {
  const h = setup();
  h.api.replaceWithFile(file);
  expect(h.env.saveButton.disabled).toBe(true);
  expect(h.env.saveButton.getAttribute('aria-busy')).toBe('true');
  expect(h.env.saveButton.textContent).toBe('Uploading…');
  const save = new Event('vcd:dev-before-save', { cancelable: true });
  h.handlers.get('vcd:dev-before-save')!(save);
  expect(save.defaultPrevented).toBe(true);
  h.uploads[0].resolve('replacement.png'); await tick();
  expect(h.probes[0].src).toBe('/images/replacement.png');
  expect(h.env.draftSrc).toBe('placeholder.svg');
  h.probes[0].load(); await tick();
  expect(h.env.draftSrc).toBe('replacement.png');
  expect(h.env.draftSrcWidth).toBe(4000);
  expect(h.env.draftSrcHeight).toBe(2650);
  expect(h.target.dataset.devImageSrcWidth).toBe('4000');
  expect(h.env.saveButton.disabled).toBe(false);
  expect(h.env.saveButton.hasAttribute('aria-busy')).toBe(false);
});

for (const action of ['cancel', 'switch', 'reopen', 'undo']) {
  test(`late upload cannot apply after ${action}`, async () => {
    const h = setup(); h.api.replaceWithFile(file);
    if (action === 'switch') h.env.editTarget = {};
    else if (action === 'reopen') h.env.replacementSession++;
    else h.api.invalidateReplacement();
    h.uploads[0].resolve('late.png'); await tick();
    expect(h.probes).toHaveLength(0);
    expect(h.env.draftSrc).toBe('placeholder.svg');
  });
}

test('latest upload wins when requests complete out of order', async () => {
  const h = setup(); h.api.replaceWithFile(file); h.api.replaceWithFile(file);
  h.uploads[1].resolve('newest.png'); await tick();
  h.probes[0].load(); await tick();
  h.uploads[0].resolve('old.png'); await tick();
  expect(h.env.draftSrc).toBe('newest.png');
  expect(h.probes).toHaveLength(1);
});

test('preload failure leaves source and undo intact and exposes the error', async () => {
  const h = setup(); h.env.undoStack = [{ existing: true }];
  h.api.replaceWithFile(file); h.uploads[0].resolve('broken.png'); await tick();
  h.probes[0].dispatchEvent(new Event('error')); await tick();
  expect(h.env.draftSrc).toBe('placeholder.svg');
  expect(h.env.undoStack).toEqual([{ existing: true }]);
  expect(h.env.status.dataset.replacementError).toBe('true');
  expect(h.env.saveButton.disabled).toBe(false);
});

test('secondary decode failure restores source and full undo/redo history at its cap', async () => {
  const h = setup();
  const previousUndo = Array.from({ length: 20 }, (_, i) => ({ i }));
  h.env.undoStack = structuredClone(previousUndo); h.env.redoStack = [{ redo: true }];
  h.preview.decode = () => Promise.reject(new Error('decode failed'));
  h.api.replaceWithFile(file); h.uploads[0].resolve('broken.png'); await tick();
  h.probes[0].load(); await tick();
  expect(h.env.draftSrc).toBe('placeholder.svg');
  expect(h.image.src).toBe('/images/placeholder.svg');
  expect(h.env.undoStack).toEqual(previousUndo);
  expect(h.env.redoStack).toEqual([{ redo: true }]);
  expect(h.env.status.dataset.replacementError).toBe('true');
});

test('late library cancellation cannot clear a newer upload pending state', async () => {
  const h = setup(); const pick = deferred<any>();
  h.env.pickReplaceFromAssetManager = () => pick.promise;
  h.handlers.get('library')!({ stopPropagation() {} });
  h.api.replaceWithFile(file);
  pick.resolve({ srcs: [] }); await tick();
  expect(h.env.replacementPending).toBe(true);
  expect(h.env.saveButton.disabled).toBe(true);
});

test('empty library selection releases Save', async () => {
  const h = setup(); h.env.pickReplaceFromAssetManager = async () => ({ srcs: [] });
  h.handlers.get('library')!({ stopPropagation() {} }); await tick();
  expect(h.env.replacementPending).toBe(false);
  expect(h.env.saveButton.disabled).toBe(false);
});

test('claimed replacement event cannot start another upload', () => {
  const h = setup();
  const event = new CustomEvent('vcd:dev-image-replace', { cancelable: true, detail: { target: h.target, file } });
  h.handlers.get('vcd:dev-image-replace')!(event);
  expect(event.defaultPrevented).toBe(true);
  expect(h.uploads).toHaveLength(1);
  h.handlers.get('vcd:dev-image-replace')!(event);
  expect(h.uploads).toHaveLength(1);
});
