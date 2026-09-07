import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/DevImageDrop.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const script = [
  between('  const clearDragState =', '  const closeMultiDropChoice ='),
  between('  const prevent =', '  pickButtons.forEach('),
].join('\n');

function setup() {
  class Element {
    dataset: Record<string, string> = {};
    constructor(public cover = false) {}
    closest(selector: string) { return this.cover && selector === '[data-dev-cover-drop]' ? this : null; }
  }
  const pageDropVeil = new Element();
  const calls: unknown[][] = [];
  const dataset: Record<string, string> = {};
  const env = {
    Element, HTMLElement: Element, Node: Element, pageDropVeil,
    ASSET_DRAG_TYPE: 'application/x-vcd-asset-src', dragDepth: 0, pendingInsertIndex: 0,
    document: { documentElement: {
      dataset, classList: { contains: () => true },
      removeAttribute: () => { delete dataset.devImageDrag; },
    } },
    root: { contains: () => true },
    clearCarouselDropTarget: () => {}, clearPlaceholderTarget: () => {},
    closeMultiDropChoice: () => {}, carouselAtPoint: () => null,
    carouselTargetFromElement: () => null, setCarouselDropTarget: () => {},
    standalonePlaceholderAtPoint: () => null, setPlaceholderTarget: () => {},
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
      asset ? ['insert', 'image', [], ['existing/photo.png']] : ['files', event.dataTransfer.files, 200, 100],
    ]);
    if (asset) expect(h.env.pendingInsertIndex).toBe(3);
  });
}
