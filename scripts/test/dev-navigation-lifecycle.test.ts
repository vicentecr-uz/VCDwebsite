import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const componentSource = (name: string) => readFileSync(new URL(`../../src/components/${name}.astro`, import.meta.url), 'utf8');
const transpile = (source: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function browserGlobals(window: Window, extra: Record<string, unknown> = {}) {
  const values = {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    CustomEvent: window.CustomEvent, Event: window.Event,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ...extra,
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }));
  return () => previous.forEach((descriptor, key) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
}

test('real Edit controller survives repeated page swaps with one heartbeat and no old handlers', async () => {
  const window = new Window({ url: 'http://localhost:4322/' });
  const posts: boolean[] = [];
  const heartbeats = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  let timerId = 0;
  let chipMounts = 0;
  let chipUnmounts = 0;
  window.setTimeout = ((callback: () => void) => { const id = ++timerId; timeouts.set(id, callback); return id; }) as typeof window.setTimeout;
  window.clearTimeout = (id: number) => { timeouts.delete(id); };
  const restoreGlobals = browserGlobals(window, {
    fetch: async (_url: string, options: { body: string }) => { posts.push(JSON.parse(options.body).active); return { ok: true }; },
    setInterval: (callback: () => void) => { const id = ++timerId; heartbeats.set(id, callback); return id; },
    clearInterval: (id: number) => { heartbeats.delete(id); },
  });
  const renderPage = () => {
    window.document.body.innerHTML = '<main id="main-content"><button data-dev-edit-trigger="image">Edit image</button><div data-dev-panel-key="image" hidden></div></main>';
    return window.document.querySelector<HTMLButtonElement>('button')!;
  };
  const requestMode = (active: boolean) => window.dispatchEvent(new window.CustomEvent('vcd:dev-mode-request', { detail: { active } }));
  const flushTimeouts = () => {
    const callbacks = [...timeouts.values()];
    timeouts.clear();
    callbacks.forEach(callback => callback());
  };
  let dispose: (() => void) | undefined;
  try {
    const oldButtons = [renderPage()];
    const source = componentSource('DevModeController');
    const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
      .replace(/^\s*import .*;$/gm, '')
      .replace('import.meta.hot?.dispose(disposePage);', 'return disposePage;');
    dispose = new Function('createPageScope', 'onPageLoad', 'bindEditorChipMediaInk', transpile(script))(
      createPageScope, onPageLoad, () => { chipMounts++; return () => { chipUnmounts++; }; },
    );
    requestMode(true);
    expect(heartbeats.size).toBe(1);
    for (let i = 0; i < 3; i++) {
      window.document.dispatchEvent(new window.Event('astro:before-swap'));
      expect(heartbeats.size).toBe(0);
      expect(timeouts.size).toBe(0);
      const newButton = renderPage();
      window.document.documentElement.classList.remove('is-dev-mode');
      const previousPosts = posts.length;
      window.document.dispatchEvent(new window.Event('astro:page-load'));
      window.document.dispatchEvent(new window.Event('astro:page-load'));
      expect(posts.length - previousPosts).toBe(1);
      expect(window.document.documentElement.classList.contains('is-dev-mode')).toBe(true);
      expect(newButton.disabled).toBe(false);
      expect(heartbeats.size).toBe(1);
      oldButtons.push(newButton);
    }
    expect(chipMounts).toBe(4);
    expect(chipUnmounts).toBe(3);
    const beforeHeartbeat = posts.length;
    [...heartbeats.values()].forEach(callback => callback());
    expect(posts.length - beforeHeartbeat).toBe(1);
    const beforeExit = posts.length;
    requestMode(false);
    flushTimeouts();
    expect(posts.length - beforeExit).toBe(1);
    expect(posts.at(-1)).toBe(false);
    expect(heartbeats.size).toBe(0);
    expect(oldButtons.at(-1)!.disabled).toBe(true);
    oldButtons.slice(0, -1).forEach(button => expect(button.disabled).toBe(false));
    requestMode(true);
    expect(heartbeats.size).toBe(1);
    dispose();
    dispose = undefined;
    expect(heartbeats.size).toBe(0);
    expect(timeouts.size).toBe(0);
    expect(chipUnmounts).toBe(4);
    const beforeDisposedRequest = posts.length;
    requestMode(false);
    window.document.dispatchEvent(new window.Event('astro:page-load'));
    flushTimeouts();
    expect(posts.length).toBe(beforeDisposedRequest);
    expect(chipMounts).toBe(4);
  } finally {
    dispose?.();
    restoreGlobals();
    await window.happyDOM.close();
  }
});

test('real text preparation guard preserves clean navigation and routes dirty or busy work through beforeunload', async () => {
  const window = new Window({ url: 'http://localhost:4322/' });
  const restoreGlobals = browserGlobals(window);
  const pageScope = createPageScope();
  const editor = new AbortController();
  const source = componentSource('DevTextEditor');
  const start = source.indexOf("    pageScope.listen(document, 'astro:before-preparation'");
  const end = source.indexOf('    setEditingEnabled(isDevContentEditing());', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const state = { actionsBusy: false, pageHistory: { busy: false }, persistedMediaInserts: [] as unknown[], count: 0, draftDirty: false };
  window.addEventListener('vcd:dev-has-draft', (event) => {
    (event as unknown as CustomEvent<{ dirty: boolean }>).detail.dirty = state.draftDirty;
  });
  window.confirm = () => { throw new Error('The preparation guard must defer to the native beforeunload prompt'); };
  try {
    new Function('env', `with (env) { ${transpile(source.slice(start, end))} }`)({
      window, document: window.document, pageScope, editorSignal: editor.signal,
      CustomEvent: window.CustomEvent, pageHistory: state.pageHistory,
      get actionsBusy() { return state.actionsBusy; },
      get persistedMediaInserts() { return state.persistedMediaInserts; },
      unsavedChangeCount: () => state.count,
    });
    const guarded = (type: string) => {
      const event = new window.Event(type, { cancelable: true });
      (type === 'beforeunload' ? window : window.document).dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(guarded('astro:before-preparation')).toBe(false);
    expect(guarded('beforeunload')).toBe(false);
    state.persistedMediaInserts = [{}];
    state.count = 1;
    expect(guarded('astro:before-preparation')).toBe(false);
    expect(guarded('beforeunload')).toBe(false);
    state.count = 2;
    expect(guarded('astro:before-preparation')).toBe(true);
    expect(guarded('beforeunload')).toBe(true);
    state.count = 1;
    for (const key of ['actionsBusy', 'draftDirty'] as const) {
      state[key] = true;
      expect(guarded('astro:before-preparation')).toBe(true);
      expect(guarded('beforeunload')).toBe(true);
      state[key] = false;
    }
    state.pageHistory.busy = true;
    expect(guarded('astro:before-preparation')).toBe(true);
    expect(guarded('beforeunload')).toBe(true);
    pageScope.destroy();
    editor.abort();
    expect(guarded('astro:before-preparation')).toBe(false);
    expect(guarded('beforeunload')).toBe(false);
  } finally {
    pageScope.destroy();
    editor.abort();
    restoreGlobals();
    await window.happyDOM.close();
  }
});
