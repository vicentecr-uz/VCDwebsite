import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { applyCropChange } from '../../astro.config.mjs';
import { normalizeImageVariants, resolveImageGridConstrained } from '../../src/lib/responsiveImage';
import { setImageVariantSetting, resetImageVariantSetting, imageVariantSettingSource, imageVariantsSavePayload } from '../../src/lib/imageVariantInheritance';

const source = readFileSync(new URL('../../src/components/project/ProjectImageCropTuner.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => {
  const index = source.indexOf(start);
  const last = source.indexOf(end, index);
  if (index < 0 || last < 0) throw new Error(`Missing editor test boundary: ${start}`);
  return source.slice(index, last);
};
const desktop = { aspect: '4:3', cx: 0.4, cy: 0.6, w: 1.2 };

function editor(variants: any = { desktop }, constrained: any = { desktop: 80 }) {
  const win = new Window();
  const target = win.document.createElement('figure');
  target.className = 'project-media project-cropped project-responsive-image';
  target.dataset.devDocument = 'test';
  target.dataset.devImagePath = '["sections",0]';
  target.dataset.devImageVariantsAuthored = JSON.stringify(variants);
  target.dataset.devImageConstrainedAuthored = JSON.stringify(constrained);
  const image = win.document.createElement('img');
  target.append(image);
  win.document.body.append(target);
  const resolved = normalizeImageVariants(variants, 'original', { width: 1600, height: 1200 });
  target.dataset.devImageVariants = JSON.stringify(resolved);
  const pending: any[] = [];
  const history: any[] = [];
  const env: any = {
    editTarget: target, editedImage: image, activeSlot: 'cover', selectedViewport: 'desktop',
    readAppliedVariants: () => structuredClone(resolved), readHoverAppliedVariants: () => structuredClone(resolved),
    readConstrainedFromTarget: () => resolveImageGridConstrained(constrained),
    normalizeImageVariants, resolveImageGridConstrained, setImageVariantSetting, resetImageVariantSetting,
    imageVariantSettingSource, imageVariantsSavePayload,
    VIEWPORTS: ['desktop', 'tablet', 'mobile'],
    isPlaceholderSrc: () => false, isListingCover: () => false, isGridTarget: () => false,
    isStandaloneMedia: () => true, isCarouselItem: () => false, pageImageFor: () => image,
    readTargetDims: () => ({ srcWidth: 1600, srcHeight: 1200 }),
    draftVariants: structuredClone(resolved), draftCoverVariants: structuredClone(resolved), draftHoverVariants: null,
    savedVariants: structuredClone(resolved), savedCoverVariants: structuredClone(resolved), savedHoverVariants: null,
    draft: { ...resolved.desktop }, saved: { ...resolved.desktop },
    draftSrc: 'image.jpg', savedSrc: 'image.jpg', draftSrcWidth: 1600, draftSrcHeight: 1200,
    savedSrcWidth: 1600, savedSrcHeight: 1200,
    draftConstrained: resolveImageGridConstrained(constrained), savedConstrained: resolveImageGridConstrained(constrained),
    constrainByViewport: { desktop: false, tablet: false, mobile: false },
    draftMaxVh: undefined, savedMaxVh: undefined, draftMobileInset: false, savedMobileInset: false,
    draftBackground: 'transparent', savedBackground: 'transparent',
    liveApply: false, editingSession: true, draftDirty: false, replacementPending: false,
    targetWasCropped: true, targetHadOwnVariants: false, targetVariantsAttr: null, savedSinceSelect: false,
    openingSnapshot: null, diskBaselines: new Map(), stagedSources: new Map(), pageBaselines: new Map(), appliedSnapshots: new Map(),
    pendingIdFor: () => 'image', imageHasWidthConstraint: (widths: any) => Object.values(widths).some((width) => width !== 100),
    canonicalSrcFromUrl: (url: string) => url, mobileBleedEligible: () => false,
    preview: win.document.createElement('div'), previewImage: image, maxVhSelect: win.document.createElement('select'),
    pageStage: null, status: { textContent: '' }, settingResetButtons: [], tuner: win.document.createElement('div'),
    constrainCalls: 0, constrainDraft: () => { env.constrainCalls++; },
    beginLiveEdits: () => { env.liveApply = true; },
    setCropVariables: () => {}, setTargetVariant: () => {}, setHoverTargetVariant: () => {},
    invalidateReplacement: () => {}, applyBackgroundLive: () => {}, writeConstraints: () => {},
    applySrcLive: () => {}, projectImage: (src: string) => src, applyMobileInsetLive: () => {},
    applyFrameFlagsLive: () => {}, renderConstraint: () => {}, syncWidthConstrainUi: () => {},
    syncUseGridDefaultButton: () => {}, closePanel: () => {}, clearAllStacks: () => {},
    removeCropClipIfOwned: () => {},
    window: { dispatchEvent: (event: any) => { if (event.type === 'vcd:dev-pending-upsert') pending.push(event.detail); } },
    CustomEvent: win.CustomEvent,
    recordPageCrop: (_target: unknown, before: any, after: any) => history.push({ before, after }),
  };
  const script = [
    between('    interface CropAuthorship {', '    interface CropUndoEntry {'),
    between('    const snapshotViewport =', '    const pushUndo ='),
    between('    const beginCropEdit =', '    /**\n     * Crop CSS only'),
    between('    const paintDraftCrop =', '    /** Panel readouts'),
    between('    const resetSetting =', '    settingResetButtons.forEach'),
    between('    const applyUndoEntry =', '    const snapshotForRedo ='),
    between('    const saveDraft =', '    const refreshCover ='),
    'return { beginCropEdit, paintDraftCrop, resetSetting, snapshotViewport, applyUndoEntry, saveDraft, syncAuthorship, getAuthored: () => structuredClone(authored) };',
  ].join('\n');
  const api = new Function('env', `with (env) { ${new Bun.Transpiler({ loader: 'ts' }).transformSync(script)} }`)(env);
  env.renderDraft = () => api.paintDraftCrop();
  env.pushUndo = () => history.push(api.snapshotViewport());
  env.applyVariantsToTarget = (_target: unknown, value: any, options: any) => {
    target.dataset.devImageVariants = JSON.stringify(value);
    if (options.authored) api.syncAuthorship(target, options.authored);
  };
  env.openingSnapshot = api.snapshotViewport();
  const switchViewport = (viewport: string) => { env.selectedViewport = viewport; env.draft = { ...env.draftVariants[viewport] }; api.paintDraftCrop(); };
  const editCrop = (crop: any) => { api.beginCropEdit(); Object.assign(env.draft, crop); api.paintDraftCrop(); };
  return { api, env, target, pending, history, switchViewport, editCrop };
}

test('opening and switching viewports never creates overrides or clamps inherited unlocked crops', () => {
  const h = editor();
  h.api.paintDraftCrop();
  h.switchViewport('tablet');
  h.switchViewport('mobile');
  expect(h.api.getAuthored().cover).toEqual({ desktop });
  expect(h.env.draft.w).toBe(1.2);
  expect(h.env.constrainCalls).toBe(0);
});

test('actual editor Save keeps inherited crops sparse after a desktop edit', () => {
  const h = editor();
  h.editCrop({ cx: 0.7 });
  expect(h.env.draftVariants.mobile.cx).toBe(0.7);
  expect(h.api.saveDraft()).toBe(true);
  const payload = h.pending[0].payload;
  expect(payload.variants).toEqual({ desktop: { ...desktop, cx: 0.7 }, tablet: {}, mobile: {} });
  const document = { sections: [{ src: 'image.jpg', variants: { desktop } }] };
  expect(applyCropChange(document, payload).ok).toBe(true);
  const reopened = editor(JSON.parse(JSON.stringify(document)).sections[0].variants);
  reopened.editCrop({ cy: 0.2 });
  expect(reopened.env.draftVariants.mobile).toEqual({ ...desktop, cx: 0.7, cy: 0.2 });
});

test('tablet crop override cascades to mobile and its reset preserves the tablet aspect', () => {
  const h = editor({ desktop, tablet: { aspect: '1:1' } });
  h.switchViewport('tablet');
  h.editCrop({ cx: 0.3, w: 0.8 });
  expect(h.env.draftVariants.mobile).toEqual({ ...desktop, aspect: '1:1', cx: 0.3, w: 0.8 });
  h.api.resetSetting('crop');
  expect(h.api.getAuthored().cover.tablet).toEqual({ aspect: '1:1' });
  expect(h.env.draftVariants.mobile).toEqual({ ...desktop, aspect: '1:1' });
  h.api.resetSetting('aspect');
  expect(h.env.draftVariants.mobile).toEqual(desktop);
});

test('width reset deletes its override without changing crop zoom', () => {
  const h = editor({ desktop }, { desktop: 80, tablet: 60, mobile: 30 });
  h.switchViewport('mobile');
  h.api.resetSetting('width');
  expect(h.env.draftConstrained.mobile).toBe(60);
  expect(h.env.draft.w).toBe(desktop.w);
  h.switchViewport('tablet');
  h.api.resetSetting('width');
  expect(h.env.draftConstrained).toEqual({ desktop: 80, tablet: 80, mobile: 80 });
  h.api.saveDraft();
  expect(h.pending[0].payload.constrained).toEqual({ desktop: 80 });
});

test('editor undo and redo restore override ownership independently of matching values', () => {
  const h = editor();
  h.switchViewport('tablet');
  h.editCrop(desktop);
  const explicit = h.api.snapshotViewport();
  h.api.resetSetting('crop');
  const inherited = h.api.snapshotViewport();
  expect(h.env.draftVariants.mobile).toEqual(desktop);
  h.api.applyUndoEntry(explicit);
  expect(h.api.getAuthored().cover.tablet).toEqual({ cx: desktop.cx, cy: desktop.cy, w: desktop.w });
  h.api.applyUndoEntry(inherited);
  expect(h.api.getAuthored().cover).toEqual({ desktop });
  h.switchViewport('desktop');
  h.editCrop({ cx: 0.9 });
  expect(h.env.draftVariants.mobile.cx).toBe(0.9);
});
