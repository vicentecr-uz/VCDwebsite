import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createElement as reactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Draw, PEN_BY_ID } from 'drawesome';
import { siteAnnotationSvg, siteAnnotationHasFreeInk } from '../../src/lib/siteAnnotationSvg';
import { validateSiteAnnotations, type SiteAnnotation } from '../../src/lib/siteAnnotations';

const fixture: SiteAnnotation = {
  id: 'drawing', sectionId: 'block', kind: 'highlight',
  anchor: { paragraphIndex: 0, exact: 'word', prefix: '', suffix: '' },
  board: { w: 100, h: 20 }, box: { x: 0, y: 0, w: 1, h: 1 },
  strokes: [{ id: 0, pen: 'pen', size: 4, opacity: 1, color: '#000000', points: [[10, 10, 0.5], [90, 10, 0.5]] }],
  mobile: 'show',
};
const editorSource = readFileSync(new URL('../../src/lib/siteAnnotationEditor.ts', import.meta.url), 'utf8');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(editorSource
  .replace(/^import .*;\n/gm, '')
  .replace(/^if \(import\.meta\.hot\).*$/gm, '')
  + '\nreturn { state, annotationsFor, pushPending, startDrawing, createLauncher, launcherPoint, nearestLauncherPosition, positionDrawingMenu, getLauncherPosition: () => launcherPosition };');
const textEditor = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');

const harness = (annotations: SiteAnnotation[] = [], storedPreferences?: unknown) => {
  const window = new Window();
  if (storedPreferences) window.localStorage.setItem('vcd:drawesome-preferences:v1', JSON.stringify(storedPreferences));
  const document = window.document;
  document.body.innerHTML = '<section data-site-annotation-section-id="block" data-site-annotation-document="page"><div class="project-body-text"><p>word</p></div><div class="site-annotations" data-site-annotations="[]"></div></section>';
  const section = document.querySelector('section')!;
  section.querySelector<HTMLElement>('[data-site-annotations]')!.dataset.siteAnnotations = JSON.stringify(annotations);
  section.getBoundingClientRect = () => new window.DOMRect(100, 40, 500, 100);
  const pending = new Map<string, any>();
  const clicks = new WeakMap<object, Function>();
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string) => {
    const element = createElement(tag);
    const add = element.addEventListener.bind(element);
    element.addEventListener = ((type: string, listener: any, options?: any) => {
      if (type === 'click') clicks.set(element, listener);
      add(type, listener, options);
    }) as typeof element.addEventListener;
    return element;
  }) as typeof document.createElement;
  let drawProps: any;
  let undoCount = 0;
  let redoCount = 0;
  window.addEventListener('vcd:dev-pending-upsert', (event: any) => pending.set(event.detail.id, event.detail));
  window.addEventListener('vcd:dev-pending-remove', (event: any) => pending.delete(event.detail.id));
  const env = {
    window, document, Element: window.Element, DOMRect: window.DOMRect,
    crypto: window.crypto,
    getComputedStyle: window.getComputedStyle.bind(window),
    AbortController: window.AbortController, CustomEvent: window.CustomEvent, Event: window.Event,
    createElement: (_: unknown, props: unknown) => props,
    createRef: () => ({ current: {
      getSize: () => ({ w: 1000, h: 800 }),
      undo: () => { undoCount += 1; },
      redo: () => { redoCount += 1; },
    } }),
    createRoot: () => ({ render: (props: unknown) => { drawProps = props; }, unmount() {} }),
    Draw: {}, PEN_BY_ID, siteAnnotationSvg, siteAnnotationHasFreeInk, positionSiteAnnotations() {},
    rangeForOffsets: (block: HTMLElement, start: number, end: number) => {
      const walker = document.createTreeWalker(block, 4);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      let offset = 0;
      let first: { node: Text; offset: number } | null = null;
      let last: { node: Text; offset: number } | null = null;
      for (const node of nodes) {
        const next = offset + node.length;
        if (!first && start < next) first = { node, offset: start - offset };
        if (first && end <= next) { last = { node, offset: end - offset }; break; }
        offset = next;
      }
      if (!first || !last) return null;
      const result = document.createRange();
      result.setStart(first.node, first.offset);
      result.setEnd(last.node, last.offset);
      return result;
    },
    captureTextParts: () => undefined,
    editableTextStrokes: (_: HTMLElement, annotation: SiteAnnotation) => annotation.strokes,
    textPartRect: () => new window.DOMRect(20, 10, 200, 40),
    annotationRect: () => new window.DOMRect(20, 10, 200, 40),
    annotationVisibleRect: (element: HTMLElement) => element.getBoundingClientRect(),
    annotationBaseRect: (section: HTMLElement, annotation: SiteAnnotation) => annotation.anchor
      ? new window.DOMRect(120, 50, 200, 40) : section.getBoundingClientRect(),
  };
  const api = new Function('env', `with (env) { ${script} }`)(env);
  const target = { section, documentKey: 'page', sectionId: 'block' };
  return {
    ...api, window, document, section, pending, target, env,
    invokeClick: (element: object) => clicks.get(element)?.(),
    props: () => drawProps,
    historyCalls: () => ({ undo: undoCount, redo: redoCount }),
    structure: () => window.dispatchEvent(new window.Event('vcd:dev-section-structure-changed')),
    done: () => clicks.get(document.querySelector('.site-draw-stage__controls')!.lastElementChild!)!(),
  };
};

test('delete and undo restore the unsaved drawing and its save payload', () => {
  const h = harness();
  h.annotationsFor(h.target).current = [structuredClone(fixture)];
  h.pushPending(h.target);
  h.section.remove();
  h.structure();
  expect(h.pending.size).toBe(0);
  h.document.body.append(h.section);
  h.structure();
  expect(h.pending.size).toBe(1);
  expect([...h.pending.values()][0].prepare().annotations).toEqual([fixture]);
});

test('conversion rebinds pending edits and revert to the replacement root', () => {
  const h = harness();
  h.annotationsFor(h.target).current = [structuredClone(fixture)];
  h.pushPending(h.target);
  const replacement = h.document.createElement('div');
  replacement.innerHTML = '<h2 class="project-section-title">word</h2>';
  const start = textEditor.indexOf('      if (previousRoot.dataset.devContentId) built.root.dataset.devContentId');
  const end = textEditor.indexOf('      const delIdx', start);
  const convert = new Bun.Transpiler({ loader: 'ts' }).transformSync(textEditor.slice(start, end));
  new Function('env', `with (env) { ${convert} }`)({
    built: { root: replacement }, previousRoot: h.section, block: { state: { document: 'page' } },
  });
  expect(replacement.dataset.siteAnnotationSectionId).toBe('block');
  h.structure();
  expect(replacement.querySelectorAll('[data-site-annotation]')).toHaveLength(1);
  [...h.pending.values()][0].revert();
  expect(replacement.querySelectorAll('[data-site-annotation]')).toHaveLength(0);
});

test('client-inserted text and heading blocks receive drawing metadata immediately', () => {
  const h = harness();
  const start = textEditor.indexOf('      built.root.dataset.devContentId = sectionId;');
  const end = textEditor.indexOf('      if (placement', start);
  const initialize = new Bun.Transpiler({ loader: 'ts' }).transformSync(textEditor.slice(start, end));
  for (const type of ['bodyText', 'sectionTitle']) {
    const root = h.document.createElement('section');
    new Function('env', `with (env) { ${initialize} }`)({
      built: { root }, type, documentKey: 'page', sectionId: `new-${type}`,
    });
    h.document.body.append(root);
    h.structure();
    expect(root.querySelector('[data-site-draw-manage]')).not.toBeNull();
    expect(root.dataset.siteAnnotationSectionId).toBe(`new-${type}`);
  }
});

test('insert ID remapping updates the captured Save object and annotation state', () => {
  const h = harness();
  h.annotationsFor(h.target).current = [structuredClone(fixture)];
  h.pushPending(h.target);
  const captured = [...h.pending.values()][0];
  const start = textEditor.indexOf('        if (payload.section?.id) {');
  const end = textEditor.indexOf('        const serverSectionId =', start);
  const remap = new Bun.Transpiler({ loader: 'ts' }).transformSync(textEditor.slice(start, end));
  new Function('env', `with (env) { ${remap} }`)({
    ...h.env, pendingMedia: h.pending,
    payload: { section: { id: 'server-block' } }, entry: { root: h.section, documentKey: 'page' },
  });
  expect(h.section.dataset.siteAnnotationSectionId).toBe('server-block');
  expect(h.pending.get('annotation:page:server-block')).toBe(captured);
  expect(captured.payload.sectionId).toBe('server-block');
  expect(captured.prepare().sectionId).toBe('server-block');
  expect(captured.prepare().annotations[0].sectionId).toBe('server-block');
  expect(h.state.has('page:block')).toBe(false);
});

test('existing drawings open in viewport coordinates and save edited geometry', () => {
  const h = harness([fixture]);
  h.startDrawing(h.target, null, fixture);
  expect(h.props().board).toBeUndefined();
  expect(h.props().initialStrokes[0].points).toEqual([[140, 70, 0.5], [300, 70, 0.5]]);
  expect(h.props().initialStrokes[0].size).toBe(8);
  h.props().onChange([...h.props().initialStrokes, {
    ...fixture.strokes[0], id: 1, points: [[150, 80, 0.5], [290, 80, 0.5]],
  }]);
  h.done();
  const saved = [...h.pending.values()][0].prepare().annotations[0];
  expect(saved.id).toBe('drawing');
  expect(validateSiteAnnotations([saved], new Set(['block']))).toBe(true);
  expect(120 + saved.box.x * 200 + saved.strokes[0].points[0][0]).toBe(140);
  expect(50 + saved.box.y * 40 + saved.strokes[0].points[0][1]).toBe(70);
});

test('editing a partly offscreen drawing preserves the complete old and new ink bounds', () => {
  const h = harness([fixture]);
  h.env.annotationRect = () => new h.window.DOMRect(-150, -100, 200, 40);
  h.startDrawing(h.target, null, fixture);
  h.props().onChange([...h.props().initialStrokes, {
    ...fixture.strokes[0], id: 1, points: [[160, 100, 0.5], [180, 110, 0.5]],
  }]);
  h.done();
  const saved = [...h.pending.values()][0].prepare().annotations[0];
  expect(saved.board.w).toBeGreaterThan(210);
  expect(saved.board.h).toBeGreaterThan(150);
  expect(saved.strokes).toHaveLength(2);
  expect(saved.strokes[0].points[0][0]).toBeLessThan(10);
  expect(saved.strokes[0].points[0][1]).toBeLessThan(10);
  expect(120 + saved.box.x * 200 + saved.strokes[0].points[0][0]).toBe(-30);
  expect(50 + saved.box.y * 40 + saved.strokes[0].points[0][1]).toBe(-40);
});

test('a changed layout keeps the drawing open until its original viewport is restored', () => {
  const h = harness();
  h.window.alert = () => {};
  h.startDrawing(h.target, null);
  h.props().onChange([fixture.strokes[0]]);
  const originalRect = h.section.getBoundingClientRect;
  h.section.getBoundingClientRect = () => new h.window.DOMRect(140, 40, 500, 100);
  h.done();
  expect(h.document.querySelector('.site-draw-stage')).not.toBeNull();
  expect(h.pending.size).toBe(0);
  h.section.getBoundingClientRect = originalRect;
  h.done();
  expect(h.document.querySelector('.site-draw-stage')).toBeNull();
  expect(h.pending.size).toBe(1);
});

test('internal media frame movement is treated as a layout change', () => {
  const h = harness();
  h.window.alert = () => {};
  const frame = h.document.createElement('div');
  frame.dataset.gridItemId = 'frame';
  let left = 120;
  frame.getBoundingClientRect = () => new h.window.DOMRect(left, 50, 200, 100);
  h.section.append(frame);
  h.startDrawing(h.target, null);
  h.props().onChange([fixture.strokes[0]]);
  left = 160;
  h.done();
  expect(h.document.querySelector('.site-draw-stage')).not.toBeNull();
  expect(h.pending.size).toBe(0);
  left = 120;
  h.done();
  expect(h.pending.size).toBe(1);
});

test('text line reflow is treated as a layout change even when the section size is fixed', () => {
  const h = harness();
  h.window.alert = () => {};
  let top = 50;
  Object.defineProperty(h.window.Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new h.window.DOMRect(120, top, 200, 20)],
  });
  h.startDrawing(h.target, null);
  h.props().onChange([fixture.strokes[0]]);
  top = 76;
  h.done();
  expect(h.document.querySelector('.site-draw-stage')).not.toBeNull();
  expect(h.pending.size).toBe(0);
  top = 50;
  h.done();
  expect(h.pending.size).toBe(1);
});

test('Clear then Done queues deletion of the existing drawing', () => {
  const h = harness([fixture]);
  h.startDrawing(h.target, null, fixture);
  h.props().onChange([]);
  h.done();
  const change = [...h.pending.values()][0].prepare();
  expect(change.annotations).toEqual([]);
  expect(change.expected).toEqual([fixture]);
});

test('unchanged text-part editing preserves the drawing group and erasers verbatim', () => {
  const grouped: SiteAnnotation = { ...fixture, kind: 'doodle',
    textParts: [{ strokeId: 0, anchor: fixture.anchor!, slices: [{ start: 0, end: 4,
      glyph: { x: 0, y: 0, w: 40, h: 20 }, clip: { x: 0, y: 0, w: 40, h: 20 } }] }],
    strokes: [{ ...fixture.strokes[0], pen: 'highlighter' }, { ...fixture.strokes[0], id: 1, erase: true }] };
  const h = harness([grouped]);
  h.startDrawing(h.target, null, grouped);
  h.done();
  expect(h.annotationsFor(h.target).current).toEqual([grouped]);
  expect(h.pending.size).toBe(0);
});

test('mapped text drawings do not offer the legacy anchor reattach action', () => {
  const mapped: SiteAnnotation = { ...fixture, textParts: [{ strokeId: 0, anchor: fixture.anchor!,
    slices: [{ start: 0, end: 4, glyph: { x: 0, y: 0, w: 40, h: 20 }, clip: { x: 0, y: 0, w: 40, h: 20 } }] }] };
  const h = harness([mapped]);
  const range = h.document.createRange();
  const paragraph = h.section.querySelector('p')!;
  range.selectNodeContents(paragraph);
  range.getClientRects = () => [new h.window.DOMRect(120, 50, 40, 20)] as unknown as DOMRectList;
  h.window.getSelection()!.addRange(range);
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  manage.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true }));
  h.invokeClick(manage);
  expect(h.document.querySelector('.site-draw-menu')?.textContent).not.toContain('Reattach');
});

test('legacy text drawings retain the anchor reattach action', () => {
  const h = harness([fixture]);
  const range = h.document.createRange();
  const paragraph = h.section.querySelector('p')!;
  range.selectNodeContents(paragraph);
  range.getClientRects = () => [new h.window.DOMRect(120, 50, 40, 20)] as unknown as DOMRectList;
  h.window.getSelection()!.addRange(range);
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  manage.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true }));
  h.invokeClick(manage);
  expect(h.document.querySelector('.site-draw-menu')?.textContent).toContain('Reattach');
});

test('multiple drawings open as a list and support detail Back and Escape dismissal', () => {
  const second = { ...fixture, id: 'second', kind: 'doodle' as const };
  const h = harness([fixture, second]);
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  h.invokeClick(manage);
  const menu = h.document.querySelector('.site-draw-menu')!;
  expect(menu.textContent).toContain('Highlight 1');
  expect(menu.textContent).toContain('Doodle 2');
  const first = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent === 'Highlight 1')!;
  h.invokeClick(first);
  expect(menu.querySelector('[role="group"]')?.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
  expect(menu.textContent).toContain('Edit');
  expect(menu.textContent).toContain('Delete');
  h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  expect(h.document.querySelector('.site-draw-menu')).not.toBeNull();
  expect(h.document.querySelector('.site-draw-menu')?.textContent).toContain('Highlight 1');
  expect(h.document.activeElement?.getAttribute('data-site-draw-menu-annotation')).toBe('drawing');
  h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  expect(h.document.querySelector('.site-draw-menu')).toBeNull();
  expect(h.document.documentElement.hasAttribute('data-site-draw-menu-open')).toBe(false);
});

test('single drawing detail closes on outside pointerdown and Tab is not trapped', () => {
  const h = harness([fixture]);
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  h.invokeClick(manage);
  const menu = h.document.querySelector('.site-draw-menu')!;
  expect(menu.classList.contains('is-open')).toBe(true);
  const outside = h.document.createElement('button');
  h.document.body.append(outside);
  outside.addEventListener('click', () => {});
  outside.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  expect(h.document.querySelector('.site-draw-menu')).toBeNull();
  h.invokeClick(manage);
  const tab = new h.window.KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
  h.window.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
  expect(h.document.querySelector('.site-draw-menu')).toBeNull();
  expect(h.document.documentElement.hasAttribute('data-site-draw-menu-open')).toBe(false);
});

test('outside dismissal consumes only its associated click across menu levels', () => {
  const second = { ...fixture, id: 'second', kind: 'doodle' as const };
  const h = harness([fixture, second]);
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  h.invokeClick(manage);
  const first = [...h.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent === 'Highlight 1')!;
  h.invokeClick(first);
  const outside = h.document.createElement('button');
  let clicks = 0;
  outside.addEventListener('click', () => { clicks += 1; });
  h.document.body.append(outside);
  outside.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  outside.dispatchEvent(new h.window.Event('click', { bubbles: true, cancelable: true }));
  expect(clicks).toBe(0);
  expect(h.document.querySelector('.site-draw-menu')).not.toBeNull();
  outside.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  outside.dispatchEvent(new h.window.Event('click', { bubbles: true, cancelable: true }));
  expect(clicks).toBe(0);
  expect(h.document.querySelector('.site-draw-menu')).toBeNull();
  outside.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  outside.dispatchEvent(new h.window.Event('click', { bubbles: true, cancelable: true }));
  expect(clicks).toBe(1);
});

test('visibility stays in the detail menu and deletion uses the current annotation ID', () => {
  const second = { ...fixture, id: 'second', kind: 'doodle' as const };
  const h = harness([fixture, second]);
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  h.invokeClick(manage);
  const menu = h.document.querySelector('.site-draw-menu')!;
  const secondRow = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent === 'Doodle 2')!;
  h.invokeClick(secondRow);
  const visibility = menu.querySelector<HTMLButtonElement>('[data-site-draw-mobile]')!;
  expect(visibility.getAttribute('role')).toBe('menuitemcheckbox');
  expect(h.document.activeElement?.textContent).toBe('Edit');
  h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
  expect(h.document.activeElement?.getAttribute('role')).toBe('menuitemcheckbox');
  visibility.focus();
  h.invokeClick(visibility);
  expect(menu.querySelector<HTMLButtonElement>('[data-site-draw-mobile]')?.textContent).toBe('Hidden on phone');
  expect(h.pending.get('annotation:page:block').prepare().annotations.find((item: SiteAnnotation) => item.id === 'second')?.mobile).toBe('hide');
  const remove = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent === 'Delete')!;
  h.invokeClick(remove);
  expect(h.annotationsFor(h.target).current.map((item: SiteAnnotation) => item.id)).toEqual(['drawing']);
});

test('hover preview restores saved image sources without changing pending state', () => {
  const h = harness([fixture, { ...fixture, id: 'second', kind: 'doodle' as const }]);
  h.document.documentElement.style.setProperty('--ref-palette-blue-500', '#2b7fff');
  h.pushPending(h.target);
  const image = h.section.querySelector<HTMLImageElement>('[data-site-annotation]')!;
  const original = image.src;
  const manage = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  h.invokeClick(manage);
  const menu = h.document.querySelector<HTMLElement>('.site-draw-menu')!;
  const menuPosition = [menu.style.left, menu.style.top];
  const row = [...h.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent === 'Highlight 1')!;
  row.dispatchEvent(new h.window.Event('pointerenter', { bubbles: true }));
  expect(image.src).not.toBe(original);
  expect([menu.style.left, menu.style.top]).toEqual(menuPosition);
  row.dispatchEvent(new h.window.Event('pointerleave', { bubbles: true }));
  expect(image.src).toBe(original);
  expect(h.pending.size).toBe(0);
});

test('drawing menu chooses the least-overlapping position around visible ink', () => {
  const h = harness([fixture]);
  const button = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  button.getBoundingClientRect = () => new h.window.DOMRect(400, 400, 100, 40);
  const menu = h.document.createElement('div');
  menu.getBoundingClientRect = () => new h.window.DOMRect(0, 0, 220, 100);
  const ink = h.document.createElement('img');
  ink.dataset.siteAnnotation = 'drawing';
  ink.getBoundingClientRect = () => new h.window.DOMRect(400, 480, 200, 80);
  h.document.body.append(ink, menu);
  h.positionDrawingMenu(menu, button);
  expect(Number.parseFloat(menu.style.top)).toBeLessThan(400);
});

test('drawing menu moves below when ink occupies the preferred above position', () => {
  const h = harness([fixture]);
  const button = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  button.getBoundingClientRect = () => new h.window.DOMRect(400, 400, 100, 40);
  const menu = h.document.createElement('div');
  menu.getBoundingClientRect = () => new h.window.DOMRect(0, 0, 220, 100);
  const ink = h.document.createElement('img');
  ink.dataset.siteAnnotation = 'drawing';
  ink.getBoundingClientRect = () => new h.window.DOMRect(380, 280, 240, 120);
  h.document.body.append(ink, menu);
  h.positionDrawingMenu(menu, button);
  expect(Number.parseFloat(menu.style.top)).toBeGreaterThan(400);
});

test('drawing menu uses a side candidate when both vertical positions overlap ink', () => {
  const h = harness([fixture]);
  const button = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  button.getBoundingClientRect = () => new h.window.DOMRect(400, 400, 100, 40);
  const menu = h.document.createElement('div');
  menu.getBoundingClientRect = () => new h.window.DOMRect(0, 0, 220, 100);
  for (const top of [280, 480]) {
    const ink = h.document.createElement('img');
    ink.dataset.siteAnnotation = `drawing-${top}`;
    ink.getBoundingClientRect = () => new h.window.DOMRect(400, top, 100, 80);
    h.document.body.append(ink);
  }
  h.document.body.append(menu);
  h.positionDrawingMenu(menu, button);
  expect(Number.parseFloat(menu.style.left)).toBe(508);
  expect(Number.parseFloat(menu.style.top)).toBe(400);
});

test('drawing menu remains inside a constrained viewport', () => {
  const h = harness([fixture]);
  Object.defineProperty(h.window, 'innerWidth', { configurable: true, value: 260 });
  Object.defineProperty(h.window, 'innerHeight', { configurable: true, value: 180 });
  const button = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  button.getBoundingClientRect = () => new h.window.DOMRect(200, 130, 40, 30);
  const menu = h.document.createElement('div');
  menu.getBoundingClientRect = () => new h.window.DOMRect(0, 0, 220, 100);
  const ink = h.document.createElement('img');
  ink.dataset.siteAnnotation = 'drawing';
  ink.getBoundingClientRect = () => new h.window.DOMRect(0, 0, 260, 180);
  h.document.body.append(ink, menu);
  h.positionDrawingMenu(menu, button);
  expect(menu.style.maxHeight).toBe('156px');
  expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(28);
  expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(68);
});

test('drawing placement scores clipped carousel ink by its visible clip', () => {
  const h = harness([fixture]);
  const button = h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!;
  button.getBoundingClientRect = () => new h.window.DOMRect(400, 400, 100, 40);
  const menu = h.document.createElement('div');
  menu.getBoundingClientRect = () => new h.window.DOMRect(0, 0, 220, 100);
  const clipped = h.document.createElement('img');
  clipped.dataset.siteAnnotation = 'drawing';
  clipped.style.clipPath = 'inset(180px 0px 0px)';
  clipped.getBoundingClientRect = () => new h.window.DOMRect(380, 280, 240, 200);
  const fullyClipped = h.document.createElement('img');
  fullyClipped.dataset.siteAnnotation = 'fully-clipped';
  fullyClipped.style.clipPath = 'inset(200px)';
  fullyClipped.getBoundingClientRect = () => new h.window.DOMRect(380, 280, 240, 200);
  h.document.body.append(clipped, fullyClipped, menu);
  h.positionDrawingMenu(menu, button);
  expect(Number.parseFloat(menu.style.top)).toBeLessThan(400);
});

test('unchanged edits preserve original strokes and geometry', () => {
  const h = harness([fixture]);
  h.startDrawing(h.target, null, fixture);
  h.done();
  expect(h.pending.size).toBe(0);
  expect(h.annotationsFor(h.target).current).toEqual([fixture]);
});

test('highlights can be hidden on phones through drawing controls or management without changing ink', () => {
  const h = harness([fixture]);
  h.startDrawing(h.target, null, fixture);
  const label = h.document.querySelector<HTMLLabelElement>('.site-draw-stage__mobile')!;
  expect(label.hidden).toBe(false);
  label.querySelector<HTMLInputElement>('input')!.checked = false;
  h.done();
  let saved = h.pending.get('annotation:page:block').prepare().annotations[0];
  expect(saved.mobile).toBe('hide');
  expect(saved.strokes).toEqual(fixture.strokes);
  h.invokeClick(h.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]')!);
  const mobile = h.document.querySelector<HTMLButtonElement>('[data-site-draw-mobile]')!;
  expect(mobile.getAttribute('aria-checked')).toBe('false');
  mobile.click();
  expect(h.pending.size).toBe(0);
  saved = h.annotationsFor(h.target).current[0];
  expect(saved).toEqual(fixture);
});

test('only highlight exports disable SVG aspect preservation', () => {
  expect(siteAnnotationSvg(fixture)).toContain('preserveAspectRatio="none"');
  expect(siteAnnotationSvg({ ...fixture, kind: 'doodle' })).not.toContain('preserveAspectRatio="none"');
  expect(siteAnnotationSvg({ ...fixture, kind: 'doodle', blockAnchor: { surface: 'media' } }))
    .toContain('preserveAspectRatio="none"');
});

test('a media block gets drawing controls and saves normalized frame geometry', () => {
  const h = harness();
  h.section.querySelector('.project-body-text')!.remove();
  h.section.classList.add('project-image');
  const image = h.document.createElement('img');
  h.section.append(image);
  h.startDrawing(h.target, null);
  h.props().onChange([{ ...fixture.strokes[0], points: [[140, 70, 0.5], [240, 90, 0.5]] }]);
  h.done();
  const saved = [...h.pending.values()][0].prepare().annotations[0];
  expect(saved.blockAnchor).toEqual({ surface: 'media' });
  expect(saved.anchor).toBeUndefined();
  expect(saved.box.w).toBeLessThan(1);
  expect(validateSiteAnnotations([saved], new Set(['block']))).toBe(true);
});

test('new doodles use a secure-context-safe ID fallback when randomUUID is unavailable', () => {
  const h = harness();
  h.env.crypto = {
    ...h.window.crypto,
    randomUUID: undefined,
    getRandomValues: h.window.crypto.getRandomValues.bind(h.window.crypto),
  };
  h.startDrawing(h.target, null);
  h.props().onChange([fixture.strokes[0]]);
  h.done();
  expect(h.document.querySelector('.site-draw-stage')).toBeNull();
  h.startDrawing(h.target, null);
  h.props().onChange([fixture.strokes[0]]);
  h.done();
  const saved = [...h.pending.values()][0].prepare().annotations;
  expect(saved).toHaveLength(2);
  expect(saved[0].id).toMatch(/^[\da-f]{32}$/);
  expect(saved[1].id).toMatch(/^[\da-f]{32}$/);
  expect(saved[0].id).not.toBe(saved[1].id);
  expect(validateSiteAnnotations(saved, new Set(['block']))).toBe(true);
});

test('Command Z and Command Shift Z control Drawesome history while its stage is open', () => {
  const h = harness();
  h.startDrawing(h.target, null);
  h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'z', metaKey: true }));
  h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }));
  expect(h.historyCalls()).toEqual({ undo: 1, redo: 1 });
});

test('Escape closes the drawing stage before the page editor can leave Edit mode', () => {
  const h = harness();
  h.document.documentElement.classList.add('is-dev-mode');
  h.startDrawing(h.target, null);
  let pageEscape = 0;
  h.document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') pageEscape += 1;
  }, { capture: true });
  h.document.body.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(h.document.querySelector('.site-draw-stage')).toBeNull();
  expect(h.document.documentElement.classList.contains('is-dev-mode')).toBe(true);
  expect(pageEscape).toBe(0);
});

test('Alt D without a selection opens a doodle stage for the nearest visible text block', () => {
  const h = harness();
  h.document.documentElement.classList.add('is-dev-mode');
  const event = new h.window.KeyboardEvent('keydown', {
    key: 'd', code: 'KeyD', altKey: true, cancelable: true,
  });
  h.window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(h.document.querySelector('.site-draw-stage')).not.toBeNull();
});

test('Alt D with one selected word opens an anchored highlight stage', () => {
  const h = harness();
  h.document.documentElement.classList.add('is-dev-mode');
  const paragraph = h.section.querySelector('p')!;
  const range = h.document.createRange();
  range.selectNodeContents(paragraph);
  range.getClientRects = () => [new h.window.DOMRect(120, 50, 40, 20)] as unknown as DOMRectList;
  h.window.getSelection()!.addRange(range);
  h.document.dispatchEvent(new h.window.Event('selectionchange'));
  h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', {
    key: 'd', code: 'KeyD', altKey: true, cancelable: true,
  }));
  expect(h.document.querySelector<HTMLButtonElement>('.site-draw-stage__controls button')!.textContent)
    .toBe('Highlight');
});

test('tapping Draw with a selected word uses the same highlight flow as Alt D', () => {
  const h = harness();
  h.document.documentElement.classList.add('is-dev-mode');
  const paragraph = h.section.querySelector('p')!;
  const range = h.document.createRange();
  range.selectNodeContents(paragraph);
  range.getClientRects = () => [new h.window.DOMRect(120, 50, 40, 20)] as unknown as DOMRectList;
  h.window.getSelection()!.addRange(range);
  h.createLauncher();
  const draw = h.document.querySelector<HTMLButtonElement>('.site-draw-launcher__draw')!;
  draw.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  draw.click();
  expect(h.document.querySelector<HTMLButtonElement>('.site-draw-stage__controls button')!.textContent)
    .toBe('Highlight');
});

const preferences = {
  tool: { active: 'marker', color: '#ff6633', size: 23, opacity: 0.4, eraserSize: 47 },
  inks: { marker: '#ff6633', highlighter: '#ffee00' },
  tuned: { marker: { size: 23, opacity: 0.4 }, highlighter: { size: 32, opacity: 0.6 } },
  ink: '#223344', chosen: true,
};

test('tool preferences survive Done and Cancel while each new doodle starts with no strokes', () => {
  const h = harness();
  h.startDrawing(h.target, null);
  h.props().onPreferencesChange(preferences);
  h.props().onChange([fixture.strokes[0]]);
  h.done();
  h.startDrawing(h.target, null);
  expect(h.props().initialPreferences).toEqual(preferences);
  expect(h.props().initialPreferences).not.toBe(preferences);
  expect(h.props().initialStrokes).toEqual([]);
  h.document.body.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  h.startDrawing(h.target, null);
  expect(h.props().initialPreferences).toEqual(preferences);
  expect(JSON.parse(h.window.localStorage.getItem('vcd:drawesome-preferences:v1')!)).toEqual(preferences);
});

test('a fresh editor restores browser preferences and ignores corrupt stored settings', () => {
  const h = harness([], preferences);
  h.startDrawing(h.target, null);
  expect(h.props().initialPreferences).toEqual(preferences);
  const invalid = harness([], { ...preferences, tool: { ...preferences.tool, active: 'unknown', size: -1 } });
  invalid.startDrawing(invalid.target, null);
  expect(invalid.props().initialPreferences).toBeUndefined();
});

test('the patched Drawesome toolbar initializes with the saved active pen, width and opacity', () => {
  const window = new Window();
  window.document.body.innerHTML = renderToStaticMarkup(reactElement(Draw, {
    initialPreferences: preferences, tooltips: false, motion: 'none',
  }));
  const toolbar = window.document.body;
  expect(toolbar.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe('Marker');
  expect(toolbar.textContent).toContain('23');
  expect(toolbar.textContent).toContain('40%');
});

test('the Draw launcher exposes exactly eight viewport snap points', () => {
  const h = harness();
  const points = Array.from({ length: 8 }, (_, index) => h.launcherPoint(index, 0, 0));
  expect(new Set(points.map(({ x, y }) => `${x}:${y}`)).size).toBe(8);
  points.forEach((point, index) => expect(h.nearestLauncherPosition(point.x, point.y)).toBe(index));
  const corner = h.launcherPoint(4, 120, 50);
  expect(corner.x + 120).toBe(h.window.innerWidth - 16);
  expect(corner.y + 50).toBe(h.window.innerHeight - 16);
  h.createLauncher();
  expect(h.getLauncherPosition()).toBe(4);
});

test('the Draw launcher restores its saved position and cancels a drag cleanly', () => {
  const h = harness();
  h.window.localStorage.setItem('vcd:draw-launcher-position:v1', '2');
  h.createLauncher();
  expect(h.getLauncherPosition()).toBe(2);
  const grip = h.document.querySelector<HTMLButtonElement>('.site-draw-launcher__grip')!;
  const event = (type: string, x: number, y: number) => {
    const result = new h.window.Event(type, { bubbles: true, cancelable: true }) as any;
    Object.assign(result, { pointerId: 1, button: 0, clientX: x, clientY: y });
    return result;
  };
  grip.dispatchEvent(event('pointerdown', 100, 100));
  grip.dispatchEvent(event('pointermove', 500, 500));
  grip.dispatchEvent(event('pointercancel', 500, 500));
  expect(h.getLauncherPosition()).toBe(2);
  expect(h.window.localStorage.getItem('vcd:draw-launcher-position:v1')).toBe('2');
  grip.dispatchEvent(event('pointerdown', 100, 100));
  grip.dispatchEvent(event('pointermove', 116, 116));
  grip.dispatchEvent(event('pointerup', 116, 116));
  expect(h.getLauncherPosition()).toBe(0);
  expect(h.window.localStorage.getItem('vcd:draw-launcher-position:v1')).toBe('0');
});

test('tapping Draw with a phrase selection anchors the first word to the text block', () => {
  const h = harness();
  h.document.documentElement.classList.add('is-dev-mode');
  const paragraph = h.section.querySelector('p')!;
  paragraph.innerHTML = '<span> tactile-first </span><strong>device </strong>for reflection';
  const start = paragraph.querySelector('span')!.firstChild!;
  const end = paragraph.querySelector('strong')!.firstChild!;
  const range = h.document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.textContent!.length);
  range.getClientRects = () => [
    new h.window.DOMRect(120, 50, 70, 20),
    new h.window.DOMRect(120, 74, 40, 20),
  ] as unknown as DOMRectList;
  Object.defineProperty(h.window.Range.prototype, 'getClientRects', {
    configurable: true, value: () => [new h.window.DOMRect(120, 50, 40, 20)],
  });
  h.window.getSelection()!.addRange(range);
  const imageSection = h.document.createElement('section');
  imageSection.dataset.siteAnnotationSectionId = 'image';
  imageSection.dataset.siteAnnotationDocument = 'page';
  imageSection.tabIndex = -1;
  h.document.body.append(imageSection);
  imageSection.focus();
  h.createLauncher();
  const draw = h.document.querySelector<HTMLButtonElement>('.site-draw-launcher__draw')!;
  draw.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  draw.click();
  expect(h.document.querySelector<HTMLButtonElement>('.site-draw-stage__controls button')!.textContent)
    .toBe('Highlight');
  h.props().onChange([fixture.strokes[0]]);
  h.done();
  const saved = [...h.pending.values()][0].prepare().annotations[0];
  expect(saved.sectionId).toBe('block');
  expect(saved.anchor?.exact).toBe('tactile-first');
  expect(saved.anchor?.prefix).toBe(' ');
  expect(saved.anchor?.suffix).toBe(' device for reflection');
  expect(saved.blockAnchor).toBeUndefined();
  expect(h.section.querySelector('[data-site-draw-manage]')?.textContent).toBe('Drawings 1');
  expect(imageSection.querySelector('[data-site-draw-manage]')).toBeNull();
});

test('an unsupported long selection stays a text-block doodle instead of falling through to an image block', () => {
  const h = harness();
  h.document.documentElement.classList.add('is-dev-mode');
  const imageSection = h.document.createElement('section');
  imageSection.dataset.siteAnnotationSectionId = 'image';
  imageSection.dataset.siteAnnotationDocument = 'page';
  imageSection.className = 'project-image';
  imageSection.tabIndex = -1;
  imageSection.innerHTML = '<img alt="" />';
  imageSection.getBoundingClientRect = () => new h.window.DOMRect(300, 100, 500, 100);
  h.document.body.append(imageSection);
  const paragraph = h.section.querySelector('p')!;
  paragraph.textContent = 'a'.repeat(101);
  const range = h.document.createRange();
  range.selectNodeContents(paragraph);
  range.getClientRects = () => [new h.window.DOMRect(120, 50, 300, 20)] as unknown as DOMRectList;
  h.window.getSelection()!.addRange(range);
  imageSection.focus();
  h.createLauncher();
  const draw = h.document.querySelector<HTMLButtonElement>('.site-draw-launcher__draw')!;
  draw.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  draw.click();
  h.props().onChange([fixture.strokes[0]]);
  h.done();
  const saved = [...h.pending.values()][0].prepare().annotations[0];
  expect(saved.sectionId).toBe('block');
  expect(saved.anchor).toBeUndefined();
  expect(saved.blockAnchor).toBeUndefined();
});
