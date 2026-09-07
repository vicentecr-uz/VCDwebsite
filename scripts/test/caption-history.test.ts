import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHistory } from '../../src/lib/devHistory';
import * as captions from '../../src/lib/imageCaptions';

const source = readFileSync(new URL('../../src/components/project/ProjectImageCaptionTuner.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const functions = [
  between('    const captureDraft =', '    registerHistoryScope('),
  between('    const applyCaptionsToTarget =', '    /** Drop an empty caption'),
  between('    const renderFields =', '    const notifyCarouselCaptions ='),
  between("    positionSelect.addEventListener('change'", "    revealSelect.addEventListener('change'"),
].join('\n');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(functions);

function setup(surface: 'panel' | 'page', initial = 'before') {
  const nodes = Object.fromEntries(['desktop', 'tablet', 'mobile'].map(bp => [bp, { textContent: initial }]));
  let removed = false;
  const host = {
    dataset: {}, className: '', classList: { contains: () => false }, hasAttribute: () => false,
    querySelector: (selector: string) => nodes[selector.match(/"(.*?)"/)![1]],
    remove: () => { removed = true; },
  };
  const target = { dataset: {}, closest: () => null };
  const textArea = { value: initial };
  const positionHandlers: Record<string, () => void> = {};
  const history = createHistory();
  const env = {
    ...captions,
    draftCaptions: { desktop: initial, tablet: initial, mobile: initial },
    draftStyle: 'white', draftOverlayPosition: 'bottom-left', draftBelowAlign: 'left',
    draftReveals: { desktop: 'always', tablet: 'always', mobile: 'always' },
    selectedViewport: 'desktop', captionSession: true, lastDraft: null,
    syncingUi: false, editTarget: target, localHistory: history,
    activePosition: (style: string) => style === 'below' ? env.draftBelowAlign : env.draftOverlayPosition,
    resolveDraftsFromRaw: (position: string) => ({ overlay: captions.resolveImageCaptionPosition(position, 'white'), below: captions.resolveImageCaptionPosition(position, 'below') }),
    document: { activeElement: surface === 'panel' ? textArea : nodes.desktop },
    textArea, styleButtons: [], revealSelect: { value: 'always' },
    positionSelect: { value: 'bottom-left', addEventListener: (event: string, fn: () => void) => { positionHandlers[event] = fn; } },
    tuner: { querySelectorAll: () => [] }, status: { textContent: '' },
    rebuildPositionOptions: () => {}, renderViewportButtons: () => {},
    IMAGE_VIEWPORTS: ['desktop', 'tablet', 'mobile'],
    ensureCaptionHost: () => host, findCaptionHost: () => host,
    syncCaptionChromeButton: () => {}, refreshProjectCropCovers: () => {},
  };
  const api = new Function('env', `with (env) { ${script}; lastDraft = captureDraft(); return { setDraftText, renderFields, captureDraft, applyCaptionsToTarget }; }`)(env);
  const type = (text: string) => {
    if (surface === 'panel') textArea.value = text;
    else nodes.desktop.textContent = text;
    api.setDraftText(text, 'desktop');
  };
  return { env, api, history, nodes, type, positionHandlers, removed: () => removed };
}

for (const surface of ['panel', 'page'] as const) {
  test(`${surface} caption typing records, coalesces and restores both views`, async () => {
    const { history, nodes, env, type } = setup(surface);
    type('one'); type('two');
    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(nodes.desktop.textContent).toBe('before');
    expect(env.textArea.value).toBe('before');
    expect(history.canUndo).toBe(false);
    await history.undo();
    expect(nodes.desktop.textContent).toBe('before');
    await history.redo();
    expect(nodes.desktop.textContent).toBe('two');
    expect(env.textArea.value).toBe('two');
  });
}

test('undo to an empty on-page caption retains its editable host', async () => {
  const { history, nodes, type, removed } = setup('page', '');
  type('new caption');
  await history.undo();
  expect(nodes.desktop.textContent).toBe('');
  expect(removed()).toBe(false);
});

test('ordinary live caption painting preserves the active typing node', () => {
  const { api, env, nodes } = setup('page');
  nodes.desktop.textContent = 'caret text';
  const state = api.captureDraft();
  api.applyCaptionsToTarget(env.editTarget, state.captions, state.captionStyle, state.captionPosition, state.captionReveals);
  expect(nodes.desktop.textContent).toBe('caret text');
});

test('position control records separately from text, while rendering adds no history', async () => {
  const { env, api, history, type, positionHandlers } = setup('panel');
  env.positionSelect.value = 'top-right';
  positionHandlers.change();
  type('updated');
  await history.undo();
  expect(env.draftCaptions.desktop).toBe('before');
  expect(env.draftOverlayPosition).toBe('top-right');
  await history.undo();
  expect(env.draftOverlayPosition).toBe('bottom-left');
  env.draftCaptions.desktop = 'render only';
  api.renderFields();
  await Promise.resolve();
  expect(history.canUndo).toBe(false);
});
