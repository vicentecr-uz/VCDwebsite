import { describe, expect, test } from 'bun:test';
import { createHistory, installHistoryShortcuts, pageHistory, registerHistoryScope } from '../../src/lib/devHistory';

class FakeTarget {
  listeners = new Map<string, Set<(event: any) => void>>();
  isConnected = true;
  parent: FakeTarget | null = null;
  addEventListener(type: string, listener: (event: any) => void, options?: { signal?: AbortSignal }) {
    const entries = this.listeners.get(type) || new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
    options?.signal?.addEventListener('abort', () => entries.delete(listener), { once: true });
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event: any) {
    if (!event.target) {
      try { event.target = this; } catch { /* Native Event targets are readonly. */ }
    }
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

class FakeElement extends FakeTarget {
  constructor(public name: string, public field = '') { super(); }
  contains(target: any) { return target === this || target?.parent === this; }
  closest(selector: string) {
    if (selector === '[data-dev-overlay]') return this.field === 'overlay' ? this : (this.parent as FakeElement | null)?.closest(selector) ?? null;
    if (selector.includes('input') && this.field === 'input') return this;
    if (selector.includes('[hidden') && this.field === 'hidden') return this;
    return null;
  }
  hasAttribute(attribute: string) { return this.field === attribute; }
}

const makeEvent = (type: string, target: FakeTarget, detail: Record<string, any> = {}) => ({
  type, target, ...detail, defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; },
  stopImmediatePropagation() { this.stopped = true; },
});

const withShortcuts = (callback: (doc: FakeTarget, win: FakeTarget, panel: FakeElement, signal: AbortSignal) => Promise<void> | void) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousElement = globalThis.Element;
  const doc = new FakeTarget() as any;
  const win = new FakeTarget() as any;
  const root = new FakeElement('root');
  const body = new FakeElement('body');
  root.classList = { contains: () => true };
  doc.documentElement = root;
  doc.body = body;
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.Element = FakeElement as any;
  pageHistory.clear();
  const abort = new AbortController();
  installHistoryShortcuts(abort.signal);
  const panel = new FakeElement('panel');
  panel.parent = body;
  return Promise.resolve(callback(doc, win, panel, abort.signal)).finally(() => {
    abort.abort();
    pageHistory.clear();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.Element = previousElement;
  });
};

describe('editor history', () => {
  test('undo and redo span action types and survive a save boundary', async () => {
    const history = createHistory();
    let text = '', crop = 1;
    text = 'Hello';
    history.push({ label: 'Text', undo: () => { text = ''; }, redo: () => { text = 'Hello'; } });
    crop = 2;
    history.push({ label: 'Crop', undo: () => { crop = 1; }, redo: () => { crop = 2; } });
    history.breakGroup();
    await history.undo();
    expect([text, crop]).toEqual(['Hello', 1]);
    await history.undo();
    expect(text).toBe('');
    await history.redo();
    await history.redo();
    expect([text, crop]).toEqual(['Hello', 2]);
  });
  test('typing coalesces, a different action breaks grouping, and edits invalidate redo', async () => {
    const history = createHistory();
    let value = 2;
    history.push({ label: 'Text', mergeKey: 'title', undo: () => { value = 0; }, redo: () => { value = 1; } });
    history.push({ label: 'Text', mergeKey: 'title', undo: () => { value = 1; }, redo: () => { value = 2; } });
    await history.undo();
    expect(value).toBe(0);
    await history.redo();
    expect(value).toBe(2);
    await history.undo();
    history.push({ label: 'Replacement', undo() {}, redo() {} });
    expect(history.canRedo).toBe(false);
  });
  test('an exhausted panel cannot consume an earlier page action', async () => {
    const history = createHistory();
    let value = 1;
    history.push({ label: 'Page', undo: () => { value = 0; }, redo: () => { value = 1; } });
    const scope = history.scope();
    await scope.undo();
    expect(value).toBe(1);
    value = 2;
    scope.push({ label: 'Panel', undo: () => { value = 1; }, redo: () => { value = 2; } });
    await scope.undo();
    await scope.undo();
    expect(value).toBe(1);
    await scope.redo();
    expect(value).toBe(2);
  });
  test('failed asynchronous undo preserves the command and blocks concurrent replay', async () => {
    const history = createHistory();
    let fail = true, calls = 0;
    history.push({ label: 'Persisted edit', async undo() {
      calls += 1;
      await Promise.resolve();
      if (fail) throw new Error('Offline');
    }, redo() {} });
    const first = history.undo();
    await history.undo();
    await expect(first).rejects.toThrow('Offline');
    expect(calls).toBe(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    fail = false;
    await history.undo();
    expect(history.canRedo).toBe(true);
  });
  test('replaying cannot recursively record another action', async () => {
    const history = createHistory();
    history.push({ label: 'Edit', undo() { history.push({ label: 'Recursive', undo() {}, redo() {} }); }, redo() {} });
    await history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });
  test('panel undo leaves later unrelated page text alone', async () => {
    const history = createHistory();
    const panel = history.scope();
    let visible = false, text = 'New title';
    panel.push({ label: 'Hide project', undo: () => { visible = true; }, redo: () => { visible = false; } });
    history.push({ label: 'Page text', undo: () => { text = 'Old title'; }, redo: () => { text = 'New title'; } });
    await panel.undo();
    expect(visible).toBe(true);
    expect(text).toBe('New title');
    await panel.undo();
    expect(text).toBe('New title');
    await history.undo();
    expect(text).toBe('Old title');
  });

  test('a visible panel consumes Cmd-Z without spilling to page history', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const panelHistory = createHistory();
    let panelValue = 1, pageValue = 1;
    panelHistory.push({ label: 'Panel', undo: () => { panelValue = 0; }, redo: () => { panelValue = 1; } });
    pageHistory.push({ label: 'Page', undo: () => { pageValue = 0; }, redo: () => { pageValue = 1; } });
    registerHistoryScope(panel as any, panelHistory, { signal });
    const event = makeEvent('keydown', panel, { metaKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(event);
    await Promise.resolve();
    expect(panelValue).toBe(0);
    expect(pageValue).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  }));

  test('authored text uses page history while an ordinary input keeps native undo', async () => withShortcuts(async (doc) => {
    let value = 1;
    pageHistory.push({ label: 'Text', undo: () => { value = 0; }, redo: () => { value = 1; } });
    const authored = new FakeElement('textarea', 'data-dev-text-document');
    const authoredEvent = makeEvent('keydown', authored, { metaKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(authoredEvent);
    await Promise.resolve();
    expect(value).toBe(0);
    expect(authoredEvent.defaultPrevented).toBe(true);
    const ordinary = new FakeElement('input', 'input');
    const ordinaryEvent = makeEvent('keydown', ordinary, { metaKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(ordinaryEvent);
    expect(ordinaryEvent.defaultPrevented).toBe(false);
  }));

  test('saving blocks keyboard undo and beforeinput routes history undo', async () => withShortcuts(async (doc, win) => {
    let value = 1;
    pageHistory.push({ label: 'Edit', undo: () => { value = 0; }, redo: () => { value = 1; } });
    win.dispatchEvent({ type: 'vcd:dev-save-state', detail: { saving: true } });
    const blocked = makeEvent('keydown', doc.body, { metaKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(blocked);
    await Promise.resolve();
    expect(value).toBe(1);
    win.dispatchEvent({ type: 'vcd:dev-save-state', detail: { saving: false } });
    const input = makeEvent('beforeinput', doc.body, { inputType: 'historyUndo' });
    doc.dispatchEvent(input);
    await Promise.resolve();
    expect(value).toBe(0);
    expect(input.defaultPrevented).toBe(true);
  }));

  test('a crop-stage pointer target owns the next shortcut despite a stale text target', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const cropStage = new FakeElement('crop-stage');
    const panelHistory = createHistory();
    let crop = 1, text = 1;
    panelHistory.push({ label: 'Crop', undo: () => { crop = 0; }, redo: () => { crop = 1; } });
    pageHistory.push({ label: 'Text', undo: () => { text = 0; }, redo: () => { text = 1; } });
    registerHistoryScope(panel as any, panelHistory, { owns: (target) => target === cropStage, signal });
    doc.dispatchEvent(makeEvent('pointerdown', cropStage));
    const event = makeEvent('keydown', new FakeElement('stale-text', 'data-dev-text-document'), {
      metaKey: true, key: 'z', isComposing: false,
    });
    doc.dispatchEvent(event);
    await Promise.resolve();
    expect(crop).toBe(0);
    expect(text).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  }));

  test('an exhausted panel scope does not spill into page history and redo stays scoped', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const panelHistory = createHistory();
    let panelValue = 1, pageValue = 1;
    panelHistory.push({ label: 'Panel', undo: () => { panelValue = 0; }, redo: () => { panelValue = 1; } });
    pageHistory.push({ label: 'Page', undo: () => { pageValue = 0; }, redo: () => { pageValue = 1; } });
    registerHistoryScope(panel as any, panelHistory, { signal });
    doc.dispatchEvent(makeEvent('pointerdown', panel));
    const undo = makeEvent('keydown', panel, { metaKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(undo);
    await Promise.resolve();
    const exhausted = makeEvent('keydown', panel, { metaKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(exhausted);
    await Promise.resolve();
    expect(panelValue).toBe(0);
    expect(pageValue).toBe(1);
    const redo = makeEvent('keydown', panel, { metaKey: true, shiftKey: true, key: 'z', isComposing: false });
    doc.dispatchEvent(redo);
    await Promise.resolve();
    expect(panelValue).toBe(1);
    expect(pageValue).toBe(1);
  }));

  test('focusin returns ownership to authored page text while a panel remains open', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const text = new FakeElement('text', 'data-dev-text-document');
    const panelHistory = createHistory();
    let panelValue = 1, pageValue = 1;
    panelHistory.push({ label: 'Panel', undo: () => { panelValue = 0; }, redo: () => { panelValue = 1; } });
    pageHistory.push({ label: 'Text', undo: () => { pageValue = 0; }, redo: () => { pageValue = 1; } });
    registerHistoryScope(panel as any, panelHistory, { signal });
    doc.dispatchEvent(makeEvent('focusin', text));
    doc.dispatchEvent(makeEvent('keydown', panel, { metaKey: true, key: 'z', isComposing: false }));
    await Promise.resolve();
    expect(pageValue).toBe(0);
    expect(panelValue).toBe(1);
  }));

  test('scrolling the page leaves the last clicked panel history selected', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const panelHistory = createHistory();
    let panelValue = 1, pageValue = 1;
    panelHistory.push({ label: 'Panel', undo: () => { panelValue = 0; }, redo: () => { panelValue = 1; } });
    pageHistory.push({ label: 'Page', undo: () => { pageValue = 0; }, redo: () => { pageValue = 1; } });
    registerHistoryScope(panel as any, panelHistory, { signal });
    doc.dispatchEvent(makeEvent('pointerdown', panel));
    doc.dispatchEvent(makeEvent('wheel', doc.body));
    doc.dispatchEvent(makeEvent('keydown', new FakeElement('stale-text', 'data-dev-text-document'), {
      metaKey: true, key: 'z', isComposing: false,
    }));
    await Promise.resolve();
    expect(panelValue).toBe(0);
    expect(pageValue).toBe(1);
  }));

  test('scrolling over a panel leaves the last clicked page history selected', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const local = createHistory();
    let crop = 1, text = 1;
    local.push({ label: 'Crop', undo: () => { crop = 0; }, redo: () => { crop = 1; } });
    pageHistory.push({ label: 'Text', undo: () => { text = 0; }, redo: () => { text = 1; } });
    registerHistoryScope(panel as any, local, { signal });
    doc.dispatchEvent(makeEvent('pointerdown', doc.body));
    doc.dispatchEvent(makeEvent('wheel', panel));
    doc.dispatchEvent(makeEvent('keydown', panel, { metaKey: true, key: 'z' }));
    await Promise.resolve();
    expect(text).toBe(0);
    expect(crop).toBe(1);
  }));

  for (const surface of ['header', 'padding', 'frame']) {
    test(`panel ${surface} selects its inner history despite stale text focus`, async () => withShortcuts(async (doc, _win, panel, signal) => {
      const overlay = new FakeElement('overlay', 'overlay');
      panel.parent = overlay;
      const clicked = surface === 'frame' ? overlay : new FakeElement(surface);
      if (clicked !== overlay) clicked.parent = overlay;
      const text = new FakeElement('text', 'data-dev-text-document');
      const panelHistory = createHistory();
      let crop = 1, page = 1;
      panelHistory.push({ label: 'Crop', undo: () => { crop = 0; }, redo: () => { crop = 1; } });
      pageHistory.push({ label: 'Text', undo: () => { page = 0; }, redo: () => { page = 1; } });
      registerHistoryScope(panel as any, panelHistory, { signal });
      doc.dispatchEvent(makeEvent('focusin', text));
      doc.dispatchEvent(makeEvent('pointerdown', clicked));
      const shortcut = async (redo = false) => {
        doc.dispatchEvent(makeEvent('keydown', text, { metaKey: true, shiftKey: redo, key: 'z' }));
        await Promise.resolve();
      };
      await shortcut();
      expect(crop).toBe(0);
      expect(page).toBe(1);
      await shortcut();
      expect(page).toBe(1);
      await shortcut(true);
      expect(crop).toBe(1);
      expect(page).toBe(1);
      doc.dispatchEvent(makeEvent('pointerdown', doc.body));
      await shortcut();
      expect(page).toBe(0);
      expect(crop).toBe(1);
    }));
  }


  test('dragged thumbnail replacement retains panel undo ownership without another click', async () => withShortcuts(async (doc, _win, panel, signal) => {
    const thumbnail = new FakeElement('thumbnail');
    thumbnail.parent = panel;
    const local = createHistory();
    let parked = true, text = 'edited';
    local.push({ label: 'Park image', undo: () => { parked = false; }, redo: () => { parked = true; } });
    pageHistory.push({ label: 'Text', undo: () => { text = 'original'; }, redo: () => { text = 'edited'; } });
    registerHistoryScope(panel as any, local, { signal });
    doc.dispatchEvent(makeEvent('pointerdown', thumbnail));
    // renderBoard replaces the thumbnail after a native drop.
    thumbnail.parent = null;
    thumbnail.isConnected = false;
    const shortcut = async (redo = false) => {
      doc.dispatchEvent(makeEvent('keydown', doc.body, { metaKey: true, shiftKey: redo, key: 'z' }));
      await Promise.resolve();
    };
    await shortcut();
    expect(parked).toBe(false);
    expect(text).toBe('edited');
    await shortcut();
    expect(text).toBe('edited');
    await shortcut(true);
    expect(parked).toBe(true);
    doc.dispatchEvent(makeEvent('pointerdown', doc.body));
    await shortcut();
    expect(text).toBe('original');
    expect(parked).toBe(true);
  }));

  for (const closing of ['hidden', 'disposed'] as const) {
    test(`a ${closing} panel releases history ownership after its thumbnail was replaced`, async () => withShortcuts(async (doc, _win, panel, signal) => {
      const thumbnail = new FakeElement('thumbnail');
      thumbnail.parent = panel;
      const local = createHistory();
      let panelValue = 1, pageValue = 1;
      local.push({ label: 'Panel', undo: () => { panelValue = 0; }, redo: () => {} });
      pageHistory.push({ label: 'Page', undo: () => { pageValue = 0; }, redo: () => {} });
      const dispose = registerHistoryScope(panel as any, local, { signal });
      doc.dispatchEvent(makeEvent('pointerdown', thumbnail));
      thumbnail.parent = null;
      thumbnail.isConnected = false;
      if (closing === 'hidden') panel.field = 'hidden';
      else dispose();
      doc.dispatchEvent(makeEvent('keydown', doc.body, { metaKey: true, key: 'z' }));
      await Promise.resolve();
      expect(pageValue).toBe(0);
      expect(panelValue).toBe(1);
    }));
  }

});
