import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createElement as reactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Draw, PEN_BY_ID } from 'drawesome';
import { siteAnnotationSvg } from '../../src/lib/siteAnnotationSvg';
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
  + '\nreturn { state, annotationsFor, pushPending, startDrawing };');
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
    AbortController: window.AbortController, CustomEvent: window.CustomEvent,
    createElement: (_: unknown, props: unknown) => props,
    createRef: () => ({ current: {
      getSize: () => ({ w: 1000, h: 800 }),
      undo: () => { undoCount += 1; },
      redo: () => { redoCount += 1; },
    } }),
    createRoot: () => ({ render: (props: unknown) => { drawProps = props; }, unmount() {} }),
    Draw: {}, PEN_BY_ID, siteAnnotationSvg, positionSiteAnnotations() {},
    annotationRect: () => new window.DOMRect(20, 10, 200, 40),
    annotationVisibleRect: (element: HTMLElement) => element.getBoundingClientRect(),
    annotationBaseRect: (section: HTMLElement, annotation: SiteAnnotation) => annotation.anchor
      ? new window.DOMRect(120, 50, 200, 40) : section.getBoundingClientRect(),
  };
  const api = new Function('env', `with (env) { ${script} }`)(env);
  const target = { section, documentKey: 'page', sectionId: 'block' };
  return {
    ...api, window, document, section, pending, target, env,
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

test('Clear then Done queues deletion of the existing drawing', () => {
  const h = harness([fixture]);
  h.startDrawing(h.target, null, fixture);
  h.props().onChange([]);
  h.done();
  const change = [...h.pending.values()][0].prepare();
  expect(change.annotations).toEqual([]);
  expect(change.expected).toEqual([fixture]);
});

test('unchanged edits preserve original strokes and geometry', () => {
  const h = harness([fixture]);
  h.startDrawing(h.target, null, fixture);
  h.done();
  expect(h.pending.size).toBe(0);
  expect(h.annotationsFor(h.target).current).toEqual([fixture]);
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
