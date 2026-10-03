import { createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Draw, PEN_BY_ID, type DrawHandle, type Stroke } from 'drawesome';
import 'drawesome/styles.css';
import type { SiteAnnotation } from './siteAnnotations';
import { siteAnnotationSvg } from './siteAnnotationSvg';
import { annotationRect, findTextAnchor, positionSiteAnnotations } from '../scripts/siteAnnotationPosition';
import '../styles/site-annotation-editor.css';

type TextAnchor = NonNullable<SiteAnnotation['anchor']>;
type Target = { section: HTMLElement; documentKey: string; sectionId: string };
type DrawingPreferences = {
  tool: { active: Stroke['pen'] | 'eraser'; color: string; size: number; opacity: number; eraserSize: number };
  inks: Partial<Record<Stroke['pen'], string>>;
  tuned: Partial<Record<Stroke['pen'], { size: number; opacity: number }>>;
  ink: string;
  chosen: boolean;
};

const preferenceKey = 'vcd:drawesome-preferences:v1';
const readPreferences = (): DrawingPreferences | undefined => {
  try {
    const value = JSON.parse(window.localStorage.getItem(preferenceKey) || 'null');
    const record = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item);
    const pen = (id: string) => Object.hasOwn(PEN_BY_ID, id);
    const number = (n: unknown, min: number, max: number) => typeof n === 'number'
      && Number.isFinite(n) && n >= min && n <= max;
    const color = (c: unknown) => typeof c === 'string' && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(c);
    if (!record(value) || !record(value.tool) || !record(value.inks) || !record(value.tuned)
      || !(pen(value.tool.active) || value.tool.active === 'eraser')
      || !color(value.tool.color) || !color(value.ink) || typeof value.chosen !== 'boolean'
      || !number(value.tool.size, 1, 80) || !number(value.tool.opacity, 0, 1)
      || !number(value.tool.eraserSize, 1, 120)
      || Object.entries(value.inks).some(([id, c]) => !pen(id) || !color(c))
      || Object.entries(value.tuned).some(([id, tuning]) => !pen(id) || !tuning
        || !number((tuning as { size?: unknown }).size, 1, 80)
        || !number((tuning as { opacity?: unknown }).opacity, 0, 1))) return;
    return value;
  } catch { return; }
};

const state = new Map<string, { target: Target; original: SiteAnnotation[]; current: SiteAnnotation[] }>();
let drawingPreferences = readPreferences();
const targetKey = ({ documentKey, sectionId }: Target) => `${documentKey}:${sectionId}`;
let stage: HTMLElement | null = null;
let reactRoot: Root | null = null;
let activeDrawRef: { current: DrawHandle | null } | null = null;
let editingImage: HTMLImageElement | null = null;
let savedSelection: { anchor: TextAnchor; rect: DOMRect } | null = null;
const lifecycle = new AbortController();
const selectionButton = document.createElement('button');
selectionButton.type = 'button';
selectionButton.className = 'site-draw-selection dev-btn dev-btn--page dev-surface';
selectionButton.textContent = 'Highlight';
selectionButton.setAttribute('aria-label', 'Highlight selected word');
selectionButton.hidden = true;
document.body.append(selectionButton);
let selectionTarget: Target | null = null;
let selectionAnchor: { anchor: TextAnchor; rect: DOMRect } | null = null;

const annotationsFor = (target: Target) => {
  const key = targetKey(target);
  let entry = state.get(key);
  if (entry) return entry;
  const layer = target.section.querySelector<HTMLElement>('[data-site-annotations]');
  let original: SiteAnnotation[] = [];
  try { original = JSON.parse(layer?.dataset.siteAnnotations || '[]'); }
  catch { original = []; }
  entry = { target, original, current: structuredClone(original) };
  state.set(key, entry);
  return entry;
};

const renderCurrent = (target: Target) => {
  const entry = annotationsFor(target);
  let layer = target.section.querySelector<HTMLElement>('[data-site-annotations]');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'site-annotations';
    layer.setAttribute('data-site-annotations', '[]');
    layer.setAttribute('aria-hidden', 'true');
    target.section.append(layer);
  }
  layer.dataset.siteAnnotations = JSON.stringify(entry.current);
  layer.replaceChildren(...entry.current.map((annotation) => {
    const image = document.createElement('img');
    image.dataset.siteAnnotation = annotation.id;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(siteAnnotationSvg(annotation))}`;
    image.alt = '';
    image.draggable = false;
    return image;
  }));
  updateCount(target);
  positionSiteAnnotations();
};

const updateCount = (target: Target) => {
  const count = annotationsFor(target).current.length;
  const manage = target.section.querySelector<HTMLButtonElement>('[data-site-draw-manage]');
  if (manage) {
    manage.hidden = count === 0;
    manage.textContent = `Drawings ${count}`;
    manage.setAttribute('aria-label', `Manage ${count} ${count === 1 ? 'drawing' : 'drawings'}`);
  }
};

const pushPending = (target: Target) => {
  const entry = annotationsFor(target);
  target = entry.target;
  const id = `annotation:${targetKey(target)}`;
  if (JSON.stringify(entry.current) === JSON.stringify(entry.original)) {
    window.dispatchEvent(new CustomEvent('vcd:dev-pending-remove', { detail: { id } }));
  } else {
    window.dispatchEvent(new CustomEvent('vcd:dev-pending-upsert', {
      detail: {
        id,
        kind: 'annotation',
        payload: { document: target.documentKey, sectionId: target.sectionId },
        prepare: () => ({
          document: target.documentKey,
          sectionId: target.sectionId,
          annotations: entry.current,
          expected: entry.original,
        }),
        revert: () => {
          entry.current = structuredClone(entry.original);
          renderCurrent(target);
        },
      },
    }));
  }
  renderCurrent(target);
};

const textBlocks = (section: HTMLElement) => {
  const body = section.querySelector('.project-body-text');
  if (body) return [...body.querySelectorAll<HTMLElement>(':scope > p, :scope > div')];
  const heading = section.querySelector<HTMLElement>('.project-section-title');
  return heading ? [heading] : [];
};

const selectedAnchor = (section: HTMLElement, range: Range | null): { anchor: TextAnchor; rect: DOMRect } | null => {
  if (!range || range.collapsed) return null;
  const blocks = textBlocks(section);
  const block = blocks.find((item) => item.contains(range.startContainer) && item.contains(range.endContainer));
  if (!block) return null;
  const exact = range.toString();
  if (!exact || exact.length > 100 || /\s/.test(exact)) return null;
  const rects = [...range.getClientRects()].filter((item) => item.width > 0 && item.height > 0);
  if (!rects.length || rects.some((item) => Math.abs(item.top - rects[0].top) > 3)) return null;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(block);
  after.setStart(range.endContainer, range.endOffset);
  const left = Math.min(...rects.map((item) => item.left));
  const right = Math.max(...rects.map((item) => item.right));
  const top = Math.min(...rects.map((item) => item.top));
  const bottom = Math.max(...rects.map((item) => item.bottom));
  return {
    anchor: {
      paragraphIndex: blocks.indexOf(block),
      exact,
      prefix: before.toString().slice(-24),
      suffix: after.toString().slice(0, 24),
    },
    rect: new DOMRect(left, top, right - left, bottom - top),
  };
};

const closeStage = () => {
  editingImage?.style.removeProperty('display');
  editingImage = null;
  activeDrawRef = null;
  reactRoot?.unmount();
  reactRoot = null;
  stage?.remove();
  stage = null;
  selectionButton.hidden = true;
};

const syncSelectionButton = () => {
  selectionButton.hidden = true;
  selectionTarget = null;
  selectionAnchor = null;
  if (!document.documentElement.classList.contains('is-dev-mode') || stage) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const element = range.startContainer instanceof Element
    ? range.startContainer : range.startContainer.parentElement;
  const section = element?.closest<HTMLElement>('[data-site-annotation-section-id][data-site-annotation-document]');
  if (!section) return;
  const selected = selectedAnchor(section, range);
  if (!selected || selected.rect.bottom < 0 || selected.rect.top > window.innerHeight) return;
  selectionTarget = {
    section,
    documentKey: section.dataset.siteAnnotationDocument || '',
    sectionId: section.dataset.siteAnnotationSectionId || '',
  };
  selectionAnchor = selected;
  selectionButton.style.left = `${Math.min(window.innerWidth - 80, Math.max(8, selected.rect.right + 8))}px`;
  selectionButton.style.top = `${Math.min(window.innerHeight - 44, Math.max(8, selected.rect.top))}px`;
  selectionButton.hidden = false;
};

selectionButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (selectionTarget && selectionAnchor) startDrawing(selectionTarget, selectionAnchor);
}, { signal: lifecycle.signal });
selectionButton.addEventListener('click', () => {
  if (!stage && selectionTarget && selectionAnchor) startDrawing(selectionTarget, selectionAnchor);
}, { signal: lifecycle.signal });
document.addEventListener('selectionchange', syncSelectionButton, { signal: lifecycle.signal });
window.addEventListener('scroll', syncSelectionButton, { passive: true, signal: lifecycle.signal });
window.addEventListener('resize', syncSelectionButton, { signal: lifecycle.signal });

const cropStrokes = (strokes: Stroke[], board: { w: number; h: number }) => {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (!points.length || strokes.every((stroke) => stroke.erase)) return null;
  const pad = Math.max(4, ...strokes.map((stroke) => stroke.size / 2 + 2));
  const left = Math.max(0, Math.min(...points.map((point) => point[0])) - pad);
  const top = Math.max(0, Math.min(...points.map((point) => point[1])) - pad);
  const right = Math.min(board.w, Math.max(...points.map((point) => point[0])) + pad);
  const bottom = Math.min(board.h, Math.max(...points.map((point) => point[1])) + pad);
  if (right <= left || bottom <= top) return null;
  return {
    rect: new DOMRect(left, top, right - left, bottom - top),
    strokes: strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map(([x, y, pressure]) => [x - left, y - top, pressure] as [number, number, number]),
    })),
  };
};

const startDrawing = (target: Target, selected: { anchor: TextAnchor; rect: DOMRect } | null, existing?: SiteAnnotation) => {
  closeStage();
  target = annotationsFor(target).target;
  const anchor = existing?.anchor ?? selected?.anchor;
  const existingRect = existing ? annotationRect(target.section, existing) : null;
  if (existing && !existingRect) {
    window.alert('Reattach this drawing to a word before editing it.');
    return;
  }
  if (existing) {
    editingImage = [...target.section.querySelectorAll<HTMLImageElement>('[data-site-annotation]')]
      .find((image) => image.dataset.siteAnnotation === existing.id) ?? null;
    if (editingImage) editingImage.style.display = 'none';
  }
  const overlay = document.createElement('div');
  overlay.className = 'site-draw-stage';
  const canvas = document.createElement('div');
  canvas.className = 'site-draw-stage__canvas';
  const controls = document.createElement('div');
  controls.className = 'site-draw-stage__controls dev-surface';
  const kind = document.createElement('button');
  kind.type = 'button';
  kind.className = 'dev-btn dev-btn--page';
  let currentKind: SiteAnnotation['kind'] = existing?.kind ?? (selected ? 'highlight' : 'doodle');
  kind.textContent = currentKind === 'highlight' ? 'Highlight' : 'Doodle';
  kind.hidden = !selected || Boolean(existing);
  kind.addEventListener('click', () => {
    currentKind = currentKind === 'highlight' ? 'doodle' : 'highlight';
    kind.textContent = currentKind === 'highlight' ? 'Highlight' : 'Doodle';
    mobile.hidden = currentKind === 'highlight';
    if (currentKind === 'highlight') mobileInput.checked = true;
  });
  const mobile = document.createElement('label');
  mobile.className = 'site-draw-stage__mobile';
  const mobileInput = document.createElement('input');
  mobileInput.type = 'checkbox';
  mobileInput.checked = existing ? existing.mobile === 'show' : currentKind === 'highlight';
  mobile.append(mobileInput, document.createTextNode('Show on phone'));
  mobile.hidden = currentKind === 'highlight';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'dev-btn dev-btn--page';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeStage);
  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = 'Done';
  done.className = 'dev-btn dev-btn--filled';
  controls.append(kind, mobile, cancel, done);
  overlay.append(canvas, controls);
  document.body.append(overlay);
  stage = overlay;
  selectionButton.hidden = true;
  overlay.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });

  const drawRef = createRef<DrawHandle>();
  activeDrawRef = drawRef;
  const sectionRect = target.section.getBoundingClientRect();
  const scaleX = existing && existingRect ? existingRect.width / existing.board.w : 1;
  const scaleY = existing && existingRect ? existingRect.height / existing.board.h : 1;
  // Strokes have one pen width; exact anisotropic nib scaling would require transformed SVG paths.
  let latest: Stroke[] = existing && existingRect ? existing.strokes.map((stroke) => ({
    ...stroke,
    size: stroke.size * Math.sqrt(scaleX * scaleY),
    points: stroke.points.map(([x, y, pressure]) => [
      sectionRect.left + existingRect.left + x * scaleX,
      sectionRect.top + existingRect.top + y * scaleY,
      pressure,
    ] as [number, number, number]),
  })) : [];
  const initialStrokes = JSON.stringify(latest);
  reactRoot = createRoot(canvas);
  const narrow = window.innerWidth < 680;
  reactRoot.render(createElement(Draw, {
    ref: drawRef,
    background: 'transparent',
    initialStrokes: latest,
    initialPreferences: drawingPreferences ? structuredClone(drawingPreferences) : undefined,
    onPreferencesChange: (preferences: DrawingPreferences) => {
      drawingPreferences = preferences;
      try { window.localStorage.setItem(preferenceKey, JSON.stringify(preferences)); }
      catch { /* Keep preferences in memory when browser storage is unavailable. */ }
    },
    onChange: (strokes: Stroke[]) => { latest = strokes; },
    placement: narrow ? 'left' : 'bottom',
    shortcuts: false,
    tools: narrow ? ['pencil', 'pen', 'marker', 'highlighter'] : ['pencil', 'pen', 'marker', 'highlighter', 'brush', 'fineliner'],
    controls: narrow ? { opacity: false, custom: false } : undefined,
    theme: 'light',
  }));

  done.addEventListener('click', () => {
    if (!latest.length) {
      if (existing) {
        const entry = annotationsFor(target);
        entry.current = entry.current.filter((item) => item.id !== existing.id);
        pushPending(target);
      }
      closeStage();
      return;
    }
    const mobileVisibility = currentKind === 'highlight' || mobileInput.checked ? 'show' : 'hide';
    let annotation: SiteAnnotation;
    if (existing && JSON.stringify(latest) === initialStrokes) {
      annotation = { ...existing, mobile: mobileVisibility };
    } else {
      const board = drawRef.current?.getSize() ?? { w: canvas.clientWidth, h: canvas.clientHeight };
      const cropped = cropStrokes(latest, board);
      if (!cropped) { closeStage(); return; }
      const base = anchor ? findTextAnchor(target.section, anchor) : target.section.getBoundingClientRect();
      if (!base) {
        window.alert('The selected word moved or changed. Cancel and select it again.');
        return;
      }
      const x = cropped.rect.left - base.left;
      const y = cropped.rect.top - base.top;
      annotation = {
        id: existing?.id ?? crypto.randomUUID(),
        sectionId: target.sectionId,
        kind: currentKind,
        ...(anchor ? { anchor } : {}),
        board: { w: cropped.rect.width, h: cropped.rect.height },
        box: currentKind === 'highlight'
          ? { x: x / base.width, y: y / base.height, w: cropped.rect.width / base.width, h: cropped.rect.height / base.height }
          : { x, y, w: cropped.rect.width, h: cropped.rect.height },
        strokes: cropped.strokes,
        mobile: mobileVisibility,
      };
    }
    const entry = annotationsFor(target);
    const index = entry.current.findIndex((item) => item.id === annotation.id);
    if (index >= 0) entry.current[index] = annotation;
    else entry.current.push(annotation);
    pushPending(target);
    closeStage();
  });
};

const showManage = (target: Target, button: HTMLButtonElement) => {
  document.querySelectorAll('.site-draw-menu').forEach((menu) => menu.remove());
  const menu = document.createElement('div');
  menu.className = 'site-draw-menu dev-surface';
  const entry = annotationsFor(target);
  const selected = savedSelection;
  entry.current.forEach((annotation, index) => {
    const label = `${annotation.kind === 'highlight' ? 'Highlight' : 'Doodle'} ${index + 1}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'dev-btn dev-btn--page';
    edit.textContent = `Edit ${label}`;
    edit.addEventListener('click', () => { menu.remove(); startDrawing(target, null, annotation); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dev-btn dev-btn--page';
    remove.textContent = `Delete ${label}`;
    remove.addEventListener('click', () => {
      entry.current = entry.current.filter((item) => item.id !== annotation.id);
      pushPending(target);
      menu.remove();
    });
    menu.append(edit, remove);
    if (selected && annotation.anchor) {
      const reattach = document.createElement('button');
      reattach.type = 'button';
      reattach.className = 'dev-btn dev-btn--page';
      reattach.textContent = `Reattach ${label}`;
      reattach.addEventListener('click', () => {
        entry.current[index] = { ...annotation, anchor: selected.anchor };
        pushPending(target);
        menu.remove();
      });
      menu.append(reattach);
    }
  });
  button.after(menu);
};

const bindButtons = () => {
  for (const section of document.querySelectorAll<HTMLElement>('[data-site-annotation-section-id][data-site-annotation-document]')) {
    const sectionId = section.dataset.siteAnnotationSectionId || '';
    const documentKey = section.dataset.siteAnnotationDocument || '';
    if (!sectionId || !documentKey) continue;
    const entry = annotationsFor({ section, sectionId, documentKey });
    const target = entry.target;
    target.section = section;
    if (section.querySelector('[data-site-draw-open]')) continue;
    const controls = document.createElement('div');
    controls.className = 'site-draw-controls dev-surface';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'dev-btn dev-btn--page';
    open.dataset.siteDrawOpen = '';
    open.textContent = 'Doodle';
    open.setAttribute('aria-label', 'Draw a doodle near this text block');
    open.addEventListener('click', () => {
      window.getSelection()?.removeAllRanges();
      startDrawing(target, null);
    });
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'dev-btn dev-btn--page';
    manage.dataset.siteDrawManage = '';
    manage.addEventListener('pointerdown', () => {
      const selection = window.getSelection();
      savedSelection = selection && !selection.isCollapsed && selection.rangeCount
        ? selectedAnchor(section, selection.getRangeAt(0)) : null;
    });
    manage.addEventListener('click', () => showManage(target, manage));
    controls.append(open, manage);
    section.append(controls);
    updateCount(target);
  }
};

const shortcutTarget = (): Target | null => {
  const sections = [...document.querySelectorAll<HTMLElement>(
    '[data-site-annotation-section-id][data-site-annotation-document]',
  )];
  const active = document.activeElement instanceof Element
    ? document.activeElement.closest<HTMLElement>('[data-site-annotation-section-id][data-site-annotation-document]')
    : null;
  const hovered = document.querySelector<HTMLElement>(
    '[data-site-annotation-section-id][data-site-annotation-document]:hover',
  );
  const section = active ?? hovered ?? sections
    .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight)
    .sort((a, b) => Math.abs((a.rect.top + a.rect.bottom) / 2 - window.innerHeight / 2)
      - Math.abs((b.rect.top + b.rect.bottom) / 2 - window.innerHeight / 2))[0]?.candidate;
  if (!section) return null;
  const sectionId = section.dataset.siteAnnotationSectionId;
  const documentKey = section.dataset.siteAnnotationDocument;
  return sectionId && documentKey ? { section, sectionId, documentKey } : null;
};

window.addEventListener('keydown', (event) => {
  if (stage) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeStage();
      return;
    }
    const command = event.metaKey || event.ctrlKey;
    if (!command || event.altKey || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.shiftKey) activeDrawRef?.current?.redo();
    else activeDrawRef?.current?.undo();
    return;
  }
  if (!document.documentElement.classList.contains('is-dev-mode')) return;
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyD') return;
  syncSelectionButton();
  const selected = selectionTarget && selectionAnchor
    ? { target: selectionTarget, anchor: selectionAnchor }
    : null;
  const target = selected?.target ?? shortcutTarget();
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.getSelection()?.removeAllRanges();
  startDrawing(target, selected?.anchor ?? null);
}, { capture: true, signal: lifecycle.signal });

window.addEventListener('vcd:dev-mode-change', (event) => {
  if (!(event as CustomEvent<{ active: boolean }>).detail.active) closeStage();
  else bindButtons();
}, { signal: lifecycle.signal });
const syncTargets = () => {
  bindButtons();
  for (const [key, entry] of state) {
    if (entry.target.section.isConnected) pushPending(entry.target);
    else window.dispatchEvent(new CustomEvent('vcd:dev-pending-remove', { detail: { id: `annotation:${key}` } }));
  }
};
window.addEventListener('vcd:dev-section-structure-changed', syncTargets, { signal: lifecycle.signal });
window.addEventListener('vcd:site-annotation-targets-changed', syncTargets, { signal: lifecycle.signal });
window.addEventListener('vcd:site-annotation-section-remap', (event) => {
  const { document: documentKey, previousId, sectionId } = (event as CustomEvent<{
    document: string; previousId: string; sectionId: string;
  }>).detail;
  const key = `${documentKey}:${previousId}`;
  const entry = state.get(key);
  if (!entry) return;
  state.delete(key);
  entry.target.sectionId = sectionId;
  for (const annotations of [entry.original, entry.current]) {
    for (const annotation of annotations) annotation.sectionId = sectionId;
  }
  state.set(targetKey(entry.target), entry);
  renderCurrent(entry.target);
}, { signal: lifecycle.signal });
window.addEventListener('vcd:site-annotations-saved', (event) => {
  const detail = (event as CustomEvent<{ document: string; sectionId: string }>).detail;
  const entry = state.get(`${detail.document}:${detail.sectionId}`);
  if (entry) entry.original = structuredClone(entry.current);
}, { signal: lifecycle.signal });
document.addEventListener('astro:page-load', () => {
  closeStage();
  state.clear();
  if (!selectionButton.isConnected) document.body.append(selectionButton);
  bindButtons();
}, { signal: lifecycle.signal });
document.addEventListener('astro:before-swap', closeStage, { signal: lifecycle.signal });
bindButtons();

if (import.meta.hot) import.meta.hot.dispose(() => { lifecycle.abort(); closeStage(); state.clear(); selectionButton.remove(); });
