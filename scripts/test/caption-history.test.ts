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
  between("    textArea.addEventListener('input'", "    viewportButtons.forEach((button) => {"),
  between("    document.addEventListener('input'", "    window.addEventListener('vcd:dev-edit-open'"),
].join('\n');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(functions);

function setup(surface: 'panel' | 'page', initial = 'before') {
  class CaptionNode {
    childNodes: Array<{ textContent: string }> = [];
    dataset: { captionBp: string };
    constructor(bp: string) { this.dataset = { captionBp: bp }; this.textContent = initial; }
    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value: string) { this.childNodes = value ? [{ textContent: value }] : []; }
    contains(node: unknown) { return node === this || this.childNodes.includes(node as any); }
    matches() { return true; }
    closest() { return host; }
    focus() { env.document.activeElement = this; }
  }
  const nodes = Object.fromEntries(['desktop', 'tablet', 'mobile'].map(bp => [bp, new CaptionNode(bp)]));
  const inputHandlers: Record<string, (event: any) => void> = {};
  const documentHandlers: Record<string, (event: any) => void> = {};
  const selection = {
    anchorNode: null as any, focusNode: null as any, anchorOffset: 0, focusOffset: 0,
    setBaseAndExtent(anchor: any, a: number, focus: any, f: number) {
      this.anchorNode = anchor; this.anchorOffset = a; this.focusNode = focus; this.focusOffset = f;
    },
  };
  let removed = false;
  const host = {
    dataset: {}, className: '', classList: { contains: () => false }, hasAttribute: () => false,
    querySelector: (selector: string) => nodes[selector.match(/"(.*?)"/)![1]],
    remove: () => { removed = true; },
  };
  const target = { dataset: {}, closest: () => null };
  let areaValue = initial;
  const textArea = {
    get value() { return areaValue; },
    set value(value: string) { areaValue = value; this.selectionStart = this.selectionEnd = value.length; },
    selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
    setSelectionRange(start: number, end: number, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
    focus() { env.document.activeElement = this; },
    addEventListener(event: string, handler: (event: any) => void) { inputHandlers[event] = handler; },
  };
  const positionHandlers: Record<string, () => void> = {};
  const history = createHistory();
  const env = {
    ...captions,
    draftCaptions: { desktop: initial, tablet: initial, mobile: initial },
    draftStyle: 'white', draftOverlayPosition: 'bottom-left', draftBelowAlign: 'left',
    draftReveals: { desktop: 'always', tablet: 'always', mobile: 'always' },
    selectedViewport: 'desktop', captionSession: true, lastDraft: null,
    pendingSelection: null, lastTextSelection: null,
    syncingUi: false, editTarget: target, localHistory: history,
    activePosition: (style: string) => style === 'below' ? env.draftBelowAlign : env.draftOverlayPosition,
    resolveDraftsFromRaw: (position: string) => ({ overlay: captions.resolveImageCaptionPosition(position, 'white'), below: captions.resolveImageCaptionPosition(position, 'below') }),
    HTMLElement: CaptionNode, NodeFilter: { SHOW_TEXT: 4 },
    window: { getSelection: () => selection },
    document: {
      activeElement: (surface === 'panel' ? textArea : nodes.desktop) as any,
      addEventListener: (event: string, handler: (event: any) => void) => { documentHandlers[event] = handler; },
      createRange: () => {
        let root: CaptionNode, endpoint: any, offset = 0;
        return {
          selectNodeContents(node: CaptionNode) { root = node; },
          setEnd(node: any, value: number) { endpoint = node; offset = value; },
          toString() {
            const prefix = endpoint === root ? root.childNodes.slice(0, offset) : root.childNodes.slice(0, root.childNodes.indexOf(endpoint));
            return prefix.map(node => node.textContent).join('') + (endpoint === root ? '' : endpoint.textContent.slice(0, offset));
          },
        };
      },
      createTreeWalker: (node: CaptionNode) => {
        let index = 0;
        return { nextNode: () => node.childNodes[index++] ?? null };
      },
    },
    resolveCaptionEditTarget: () => target,
    matchImageCaptionViewport: () => 'desktop',
    textArea, styleButtons: [], revealSelect: { value: 'always' },
    positionSelect: { value: 'bottom-left', addEventListener: (event: string, fn: () => void) => { positionHandlers[event] = fn; } },
    tuner: { querySelectorAll: () => [] }, status: { textContent: '' },
    rebuildPositionOptions: () => {}, renderViewportButtons: () => {},
    IMAGE_VIEWPORTS: ['desktop', 'tablet', 'mobile'],
    ensureCaptionHost: () => host, findCaptionHost: () => host,
    syncCaptionChromeButton: () => {}, refreshProjectCropCovers: () => {},
  };
  const api = new Function('env', `with (env) { ${script}; lastDraft = captureDraft(); return { setDraftText, renderFields, captureDraft, applyCaptionsToTarget, capturePanelSelection, capturePageSelection }; }`)(env);
  const type = (text: string) => {
    if (surface === 'panel') textArea.value = text;
    else nodes.desktop.textContent = text;
    api.setDraftText(text, 'desktop');
  };
  const select = (anchor: number, focus = anchor, editor = surface) => {
    if (editor === 'panel') {
      textArea.focus();
      textArea.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), anchor > focus ? 'backward' : anchor === focus ? 'none' : 'forward');
    } else {
      nodes.desktop.focus();
      const node = nodes.desktop.childNodes[0] ?? nodes.desktop;
      selection.setBaseAndExtent(node, anchor, node, focus);
    }
  };
  const edit = (text: string, after: number, editor = surface) => {
    const element = editor === 'panel' ? textArea : nodes.desktop;
    const handlers = editor === 'panel' ? inputHandlers : documentHandlers;
    handlers.beforeinput({ target: element, inputType: 'insertText' });
    if (editor === 'panel') textArea.value = text;
    else nodes.desktop.textContent = text;
    select(after, after, editor);
    handlers.input({ target: element });
  };
  const caret = (editor = surface) => editor === 'panel'
    ? api.capturePanelSelection('desktop') : api.capturePageSelection(nodes.desktop, 'desktop');
  return { env, api, history, nodes, type, positionHandlers, select, edit, caret, removed: () => removed };
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

test('closing the caption editor exits the session before restoring saved text', () => {
  const handler = source.slice(source.indexOf("window.addEventListener('vcd:dev-edit-close'"), source.indexOf("const saveDraft =", source.indexOf("window.addEventListener('vcd:dev-edit-close'")));
  expect(handler.indexOf('captionSession = false;')).toBeLessThan(handler.indexOf('revertToSaved();'));
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


for (const surface of ['panel', 'page'] as const) {
  test(`${surface} undo restores the pre-edit caret and redo restores the post-edit caret`, async () => {
    const { select, edit, caret, history } = setup(surface, 'abcdef');
    select(3);
    edit('abcXdef', 4);
    edit('abcXYdef', 5);
    await history.undo();
    expect(caret()).toMatchObject({ anchor: 3, focus: 3 });
    expect(history.canUndo).toBe(false);
    await history.redo();
    expect(caret()).toMatchObject({ anchor: 5, focus: 5 });
  });

  test(`${surface} undo restores a backwards replacement range`, async () => {
    const { select, edit, caret, history } = setup(surface, 'abcdef');
    select(5, 2);
    edit('abXf', 3);
    await history.undo();
    expect(caret()).toMatchObject(surface === 'panel'
      ? { anchor: 2, focus: 5, direction: 'backward' } : { anchor: 5, focus: 2 });
    await history.redo();
    expect(caret()).toMatchObject({ anchor: 3, focus: 3 });
  });

  test(`${surface} moving the caret starts a separate undo step`, async () => {
    const { select, edit, caret, history, nodes } = setup(surface, 'abcdef');
    select(3); edit('abcXdef', 4);
    select(1); edit('aYbcXdef', 2);
    await history.undo();
    expect(nodes.desktop.textContent).toBe('abcXdef');
    expect(caret()).toMatchObject({ anchor: 1, focus: 1 });
    await history.undo();
    expect(nodes.desktop.textContent).toBe('abcdef');
    expect(caret()).toMatchObject({ anchor: 3, focus: 3 });
  });
}

test('switching between caption surfaces separates undo steps and restores focus', async () => {
  const { select, edit, caret, history, env, nodes } = setup('panel', 'abcdef');
  select(3); edit('abcXdef', 4);
  select(4, 4, 'page'); edit('abcXYdef', 5, 'page');
  await history.undo();
  expect(env.document.activeElement).toBe(nodes.desktop);
  expect(caret('page')).toMatchObject({ anchor: 4, focus: 4 });
  await history.undo();
  expect(env.document.activeElement).toBe(env.textArea);
  expect(caret('panel')).toMatchObject({ anchor: 3, focus: 3 });
});

test('undoing the first character restores the empty caption caret', async () => {
  const { select, edit, caret, history, removed } = setup('page', '');
  select(0); edit('X', 1);
  await history.undo();
  expect(caret()).toMatchObject({ anchor: 0, focus: 0 });
  expect(removed()).toBe(false);
});
