import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/DevImageDrop.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const script = [
  between('  const clearDragState =', '  const closeMultiDropChoice ='),
  between('  const prevent =', '  pickButtons.forEach('),
].join('\n');
const geometryScript = source.slice(source.indexOf('  const spacingBlocks ='), source.indexOf('  const hasPreferredType ='));

function setup(options: { placeholder?: boolean; preventReplacement?: boolean; carousel?: boolean } = {}) {
  class Element {
    dataset: Record<string, string> = {};
    constructor(public cover = false) {}
    closest(selector: string) { return this.cover && selector === '[data-dev-cover-drop]' ? this : null; }
  }
  const pageDropVeil = new Element();
  const calls: unknown[][] = [];
  const dataset: Record<string, string> = {};
  const placeholder = new Element();
  const env = {
    Element, HTMLElement: Element, Node: Element, pageDropVeil,
    ASSET_DRAG_TYPE: 'application/x-vcd-asset-src', dragDepth: 0, pendingInsertIndex: 0,
    document: { documentElement: {
      dataset, classList: { contains: () => true },
      removeAttribute: () => { delete dataset.devImageDrag; },
    } },
    root: { contains: () => true },
    window: {
      dispatchEvent: (event: CustomEvent) => {
        calls.push(['replace', event.type, event.detail]);
        if (options.preventReplacement) event.preventDefault();
        return !event.defaultPrevented;
      },
      alert: (message: string) => calls.push(['alert', message]),
    },
    getDropZone: () => new Element(),
    isAcceptedImageFile: (file: { type?: string }) => file.type?.startsWith('image/'),
    zoneForElement: (element: InstanceType<typeof Element>) => element.cover ? null : element,
    beginTransaction: (_documentKey: string, element?: InstanceType<typeof Element>) => ({
      documentKey: 'home',
      dropZone: element && !element.cover ? element : new Element(),
    }),
    clearCarouselDropTarget: () => {}, clearPlaceholderTarget: () => {},
    closeMultiDropChoice: () => {}, carouselAtPoint: () => options.carousel ? new Element() : null,
    carouselTargetFromElement: (target: InstanceType<typeof Element>) => options.carousel
      ? { documentKey: 'home', path: ['sections', 0], target }
      : null,
    placeholderAtPoint: () => options.placeholder ? placeholder : null,
    setCarouselDropTarget: () => {}, setPlaceholderTarget: () => {},
    insertIndexForY: () => 3,
    handleFiles: (...args: unknown[]) => calls.push(['files', ...args]),
    insertSection: async (...args: unknown[]) => { calls.push(['insert', ...args]); },
  };
  const handlers = new Function('env', `with (env) { ${script}; return { onDragEnter, onDragOver, onDrop }; }`)(env);
  const event = (cover: boolean, asset = false) => ({
    target: new Element(cover), clientX: 100, clientY: 200, relatedTarget: null,
    dataTransfer: {
      types: [asset ? env.ASSET_DRAG_TYPE : 'Files'],
      items: [{ kind: 'file', type: 'image/png' }],
      files: [{ name: 'photo.png', type: 'image/png' }],
      getData: () => asset ? 'existing/photo.png' : '',
    },
    preventDefault: () => calls.push(['prevent']),
  });
  return { ...handlers, env, calls, dataset, pageDropVeil, event };
}

test('a placeholder drop is offered to the replacement flow before page routing', () => {
  const h = setup({ placeholder: true, preventReplacement: true });
  const event = h.event(false);
  h.onDrop(event);
  expect(h.calls[1]).toEqual(['replace', 'vcd:dev-image-replace', {
    target: expect.any(Object),
    file: event.dataTransfer.files[0],
  }]);
  expect(h.calls).toHaveLength(2);
});

test('a placeholder drop wins over carousel append routing', () => {
  const h = setup({ placeholder: true, carousel: true, preventReplacement: true });
  h.onDrop(h.event(false));
  expect(h.calls.some(([kind]) => kind === 'replace')).toBe(true);
  expect(h.calls.some(([kind]) => kind === 'insert')).toBe(false);
});

test('an asset drop sends its source when no file is available', () => {
  const h = setup({ placeholder: true, preventReplacement: true });
  const event = h.event(false, true);
  event.dataTransfer.files = [];
  h.onDrop(event);
  expect(h.calls[1]).toEqual(['replace', 'vcd:dev-image-replace', {
    target: expect.any(Object),
    src: 'existing/photo.png',
  }]);
});

test('placeholder replacement prefers the first accepted file', () => {
  const h = setup({ placeholder: true, preventReplacement: true });
  const event = h.event(false);
  const image = { name: 'first.png', type: 'image/png' };
  event.dataTransfer.files = [{ name: 'notes.txt', type: 'text/plain' }, image, { name: 'second.jpg', type: 'image/jpeg' }];
  h.onDrop(event);
  expect(h.calls[1]?.[2]).toMatchObject({ file: image });
});

test('an unhandled placeholder replacement stops without page routing', () => {
  const h = setup({ placeholder: true });
  const event = h.event(false);
  h.onDrop(event);
  expect(h.calls[1]?.[0]).toBe('replace');
  expect(h.calls.at(-1)).toEqual(['alert', 'Could not replace that image. Reload the editor and try again.']);
});

test('entering a gallery cover leaves its drag feedback to the gallery editor', () => {
  const h = setup();
  h.onDragEnter(h.event(true));
  expect(h.dataset.devImageDrag).toBeUndefined();
  expect(h.calls).toEqual([]);
  h.onDragEnter(h.event(false));
  expect(h.dataset.devImageDrag).toBe('true');
});

test('moving from a page gap onto a cover clears page drop feedback', () => {
  const h = setup();
  h.onDragEnter(h.event(false));
  h.onDragOver(h.event(false));
  expect(h.pageDropVeil.dataset.active).toBe('true');
  h.onDragOver(h.event(true));
  expect(h.dataset.devImageDrag).toBeUndefined();
  expect(h.pageDropVeil.dataset.active).toBeUndefined();
  expect(h.env.dragDepth).toBe(0);
});

test('below a single real section appends before the trailing spacing sentinel', () => {
  const real = {
    dataset: { devSpacingPath: '["sections",0,"spacing"]' },
    getBoundingClientRect: () => ({ top: 100, height: 100 }),
  };
  const sentinel = {
    dataset: {
      devSpacingPath: '["sections",1,"spacing"]',
      devSpacingWritePath: '["trailingSpacing"]',
    },
    getBoundingClientRect: () => ({ top: 220, height: 40 }),
  };
  const env = {
    document: { querySelectorAll: () => [real, sentinel] },
    currentTransaction: () => ({ dropZone: null }),
  };
  const { spacingBlocks, insertIndexForY } = new Function('env', `with (env) { ${geometryScript}; return { spacingBlocks, insertIndexForY }; }`)(env);
  expect(spacingBlocks()).toHaveLength(2);
  expect(insertIndexForY(500)).toBe(1);
});

for (const asset of [false, true]) {
  test(`${asset ? 'asset' : 'file'} drops on a gallery cover do not insert page blocks`, () => {
    const h = setup();
    h.onDrop(h.event(true, asset));
    expect(h.calls).toEqual([]);
  });

  test(`${asset ? 'asset' : 'file'} drops outside covers still insert page blocks`, () => {
    const h = setup();
    const event = h.event(false, asset);
    h.onDrop(event);
    expect(h.calls).toEqual([
      ['prevent'],
      asset
        ? ['insert', 'image', [], ['existing/photo.png'], expect.any(Object)]
        : ['files', event.dataTransfer.files, 200, 100, expect.any(Object)],
    ]);
    if (asset) expect(h.env.pendingInsertIndex).toBe(3);
  });
}

function transactionSetup() {
  class Element {
    dataset: Record<string, string> = {};
    hidden = false;
    parent: Element | null = null;
    constructor(documentKey?: string, hidden = false) {
      this.hidden = hidden;
      if (documentKey) this.dataset.pageDocument = documentKey;
    }
    closest(selector: string) {
      if (selector === '[hidden], [inert]') return this.hidden ? this : null;
      if (selector === '[data-dev-project-drop-zone]') return this;
      return null;
    }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  const home = new Element('home', true);
  const veil = new Element('home-intro');
  const zones = [home, veil];
  const env = {
    Element, HTMLElement: Element, fallbackDocumentKey: 'home', activeTransaction: null,
    document: { querySelectorAll: () => zones },
    getDropZone: (documentKey?: string) => documentKey
      ? zones.find((zone) => zone.dataset.pageDocument === documentKey) ?? null
      : zones.find((zone) => !zone.hidden) ?? null,
  };
  const ownership = new Function('env', `with (env) {
    ${between('  const isUsableZone =', '  const dropLabel =')}
    return { beginTransaction };
  }`)(env);
  return { env, home, veil, beginTransaction: ownership.beginTransaction };
}

test('transactions stay on the exposed zone and reject inactive or unknown documents', () => {
  const h = transactionSetup();
  expect(h.beginTransaction('home')).toBeNull();
  expect(h.beginTransaction('missing')).toBeNull();
  expect(h.beginTransaction()).toEqual({ documentKey: 'home-intro', dropZone: h.veil });
});

test('insertSection keeps the captured document and index across async state changes', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let pendingInsertIndex = 1;
  let activeTransaction = { documentKey: 'home', dropZone: null };
  const window = {
    dispatchEvent(event: CustomEvent) {
      if (event.type === 'vcd:dev-flush-pending-edits') {
        pendingInsertIndex = 9;
        activeTransaction = { documentKey: 'home', dropZone: null };
        event.detail.resolve();
      }
    },
  };
  const fetch = async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => ({ section: { type: 'image' } }) };
  };
  const env = {
    pendingInsertIndex,
    activeTransaction,
    window,
    fetch,
    flushPendingEdits: (documentKey: string) => new Promise<void>((resolve) => {
      window.dispatchEvent(new CustomEvent('vcd:dev-flush-pending-edits', {
        detail: { documentKey, resolve, reject: () => {} },
      }));
    }),
    closePicker: () => {},
  };
  const insertSection = new Function('env', `with (env) {
    ${between('  const insertSection =', '  const appendToCarousel =')}
    return insertSection;
  }`)(env);
  const target = { documentKey: 'home-intro', dropZone: null, insertIndex: 1 };
  await insertSection('image', ['intro.png'], [], target);
  expect(calls).toEqual([{ document: 'home-intro', index: 1, type: 'image', filenames: ['intro.png'] }]);
});
