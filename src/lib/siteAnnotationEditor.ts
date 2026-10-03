import { createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Draw, PEN_BY_ID, type DrawHandle, type Stroke } from 'drawesome';
import 'drawesome/styles.css';
import type { SiteAnnotation } from './siteAnnotations';
import { siteAnnotationSvg, siteAnnotationHasFreeInk } from './siteAnnotationSvg';
import { captureTextParts, editableTextStrokes } from './siteAnnotationTextParts';
import { annotationRect, annotationBaseRect, annotationVisibleRect, rangeForOffsets, textPartRect, positionSiteAnnotations } from '../scripts/siteAnnotationPosition';
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
let editingImages: HTMLImageElement[] = [];
let savedSelection: { anchor: TextAnchor; rect: DOMRect } | null = null;
const lifecycle = new AbortController();
const launcherPositionKey = 'vcd:draw-launcher-position:v1';
const launcherMargin = 16;
type LauncherPoint = { x: number; y: number };
let drawLauncher: HTMLElement | null = null;
let launcherPosition = 4;
let launcherDragging = false;
let launcherDragStart: { pointerId: number; x: number; y: number; left: number; top: number; position: number } | null = null;
let launcherSelection: ReturnType<typeof drawingSelection> | null = null;

const readLauncherPosition = () => {
  try {
    const stored = window.localStorage.getItem(launcherPositionKey);
    if (stored !== null && /^(?:[0-7])$/.test(stored)) launcherPosition = Number(stored);
  } catch { /* Keep the default when browser storage is unavailable. */ }
};

const saveLauncherPosition = () => {
  try { window.localStorage.setItem(launcherPositionKey, String(launcherPosition)); }
  catch { /* Keep the position in memory when browser storage is unavailable. */ }
};

const safeArea = (side: 'left' | 'right' | 'top' | 'bottom') => {
  const value = Number.parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue(`--draw-launcher-safe-${side}`));
  return Number.isFinite(value) ? value : 0;
};

const launcherViewport = () => {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
};

const launcherPoint = (index: number, width: number, height: number): LauncherPoint => {
  const viewport = launcherViewport();
  const left = viewport.left + launcherMargin + safeArea('left');
  const right = viewport.left + viewport.width - launcherMargin - safeArea('right') - width;
  const top = viewport.top + launcherMargin + safeArea('top');
  const bottom = viewport.top + viewport.height - launcherMargin - safeArea('bottom') - height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const points = [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: right, y: centerY },
    { x: right, y: bottom },
    { x: centerX, y: bottom },
    { x: left, y: bottom },
    { x: left, y: centerY },
  ];
  const point = points[((index % 8) + 8) % 8];
  return { ...point, x: Math.max(left, Math.min(right, point.x)), y: Math.max(top, Math.min(bottom, point.y)) };
};

const nearestLauncherPosition = (x: number, y: number, width = drawLauncher?.offsetWidth ?? 0, height = drawLauncher?.offsetHeight ?? 0) => {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 8; index += 1) {
    const point = launcherPoint(index, width, height);
    const next = (point.x + width / 2 - x) ** 2 + (point.y + height / 2 - y) ** 2;
    if (next < distance) { distance = next; nearest = index; }
  }
  return nearest;
};

const positionLauncher = (animate = false) => {
  if (!drawLauncher || drawLauncher.hidden || launcherDragging) return;
  const point = launcherPoint(launcherPosition, drawLauncher.offsetWidth, drawLauncher.offsetHeight);
  drawLauncher.classList.toggle('is-snapping', animate);
  drawLauncher.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
};

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
  layer.replaceChildren(...entry.current.flatMap((annotation) => {
    const images: HTMLImageElement[] = [];
    const addImage = (partIndex?: number, sliceIndex?: number, strokeIndex?: number) => {
      const image = document.createElement('img');
      image.dataset.siteAnnotation = annotation.id;
      if (partIndex !== undefined) {
        image.dataset.siteAnnotationPart = String(partIndex);
        image.dataset.siteAnnotationSlice = String(sliceIndex);
      }
      if (strokeIndex !== undefined) image.dataset.siteAnnotationStroke = String(strokeIndex);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(siteAnnotationSvg(annotation,
        partIndex !== undefined ? { partIndex, sliceIndex: sliceIndex! }
          : strokeIndex !== undefined ? { strokeIndex } : undefined))}`;
      image.alt = '';
      image.draggable = false;
      images.push(image);
    };
    if (annotation.textParts?.length) {
      annotation.strokes.forEach((stroke, strokeIndex) => {
        if (stroke.erase) return;
        const parts = annotation.textParts!.map((part, partIndex) => ({ part, partIndex }))
          .filter(({ part }) => part.strokeId === stroke.id);
        if (parts.length) parts.forEach(({ part, partIndex }) => part.slices.forEach((_, sliceIndex) => addImage(partIndex, sliceIndex)));
        else addImage(undefined, undefined, strokeIndex);
      });
    } else if (siteAnnotationHasFreeInk(annotation)) addImage();
    return images;
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
  const selectedText = range.toString();
  const tokenMatch = /\S+/.exec(selectedText);
  if (!tokenMatch || tokenMatch[0].length > 100) return null;
  const beforeSelection = document.createRange();
  beforeSelection.selectNodeContents(block);
  beforeSelection.setEnd(range.startContainer, range.startOffset);
  const tokenStart = beforeSelection.toString().length + tokenMatch.index;
  const tokenRange = /\s/.test(selectedText)
    ? rangeForOffsets(block, tokenStart, tokenStart + tokenMatch[0].length)
    : range;
  if (!tokenRange) return null;
  const exact = tokenMatch[0];
  const rects = [...tokenRange.getClientRects()].filter((item) => item.width > 0 && item.height > 0);
  if (!rects.length || rects.some((item) => Math.abs(item.top - rects[0].top) > 3)) return null;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(tokenRange.startContainer, tokenRange.startOffset);
  const after = document.createRange();
  after.selectNodeContents(block);
  after.setStart(tokenRange.endContainer, tokenRange.endOffset);
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
  editingImages.forEach((image) => image.style.removeProperty('display'));
  editingImages = [];
  activeDrawRef = null;
  reactRoot?.unmount();
  reactRoot = null;
  stage?.remove();
  stage = null;
  if (drawLauncher) {
    drawLauncher.hidden = !document.documentElement.classList.contains('is-dev-mode');
    positionLauncher();
  }
};

const drawingSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const element = range.startContainer instanceof Element
    ? range.startContainer : range.startContainer.parentElement;
  const section = element?.closest<HTMLElement>('[data-site-annotation-section-id][data-site-annotation-document]');
  if (!section) return;
  if (!section.contains(range.startContainer) || !section.contains(range.endContainer)) return;
  const selectionRects = [...range.getClientRects()].filter((item) => item.width > 0 && item.height > 0);
  if (!selectionRects.some((item) => item.bottom > 0 && item.top < window.innerHeight)) return;
  const selected = selectedAnchor(section, range);
  const target: Target = {
    section,
    documentKey: section.dataset.siteAnnotationDocument || '',
    sectionId: section.dataset.siteAnnotationSectionId || '',
  };
  return { target, anchor: selected };
};

type LayoutSnapshot = {
  viewport: [number, number, number, number];
  section: [number, number, number, number];
  internals: number[];
};

const layoutSnapshot = (section: HTMLElement): LayoutSnapshot => {
  const rect = section.getBoundingClientRect();
  const internals: number[] = [];
  const addRects = (rects: DOMRectList | DOMRect[]) => {
    for (const item of [...rects].filter((candidate) => candidate.width > 0 && candidate.height > 0)) {
      internals.push(item.left, item.top, item.width, item.height);
    }
  };
  for (const block of textBlocks(section)) {
    const range = document.createRange();
    range.selectNodeContents(block);
    addRects(range.getClientRects());
  }
  const media = section.querySelectorAll<HTMLElement>(
    '[data-grid-item-id], .project-crop-clip, .project-video-player, .project-image-grid__frame, '
      + '[data-carousel-frame], img:not([data-site-annotation]), video, iframe',
  );
  for (const element of media) addRects([element.getBoundingClientRect()]);
  return {
    viewport: [window.innerWidth, window.innerHeight, window.scrollX, window.scrollY],
    section: [rect.left, rect.top, rect.width, rect.height],
    internals,
  };
};

const layoutChanged = (before: LayoutSnapshot, after: LayoutSnapshot) => {
  const values = [...before.viewport, ...before.section];
  const current = [...after.viewport, ...after.section];
  if (before.internals.length !== after.internals.length || values.length !== current.length) return true;
  for (let index = 0; index < values.length; index += 1) {
    if (Math.abs(values[index] - current[index]) > .5) return true;
  }
  for (let index = 0; index < before.internals.length; index += 1) {
    if (Math.abs(before.internals[index] - after.internals[index]) > .5) return true;
  }
  return false;
};

const cropStrokes = (strokes: Stroke[]) => {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (!points.length || strokes.every((stroke) => stroke.erase)) return null;
  const pad = Math.max(4, ...strokes.map((stroke) => stroke.size / 2 + 2));
  const left = Math.min(...points.map((point) => point[0])) - pad;
  const top = Math.min(...points.map((point) => point[1])) - pad;
  const right = Math.max(...points.map((point) => point[0])) + pad;
  const bottom = Math.max(...points.map((point) => point[1])) + pad;
  if (right <= left || bottom <= top) return null;
  return {
    rect: new DOMRect(left, top, right - left, bottom - top),
    strokes: strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map(([x, y, pressure]) => [x - left, y - top, pressure] as [number, number, number]),
    })),
  };
};

const doodleBlockAnchor = (section: HTMLElement, rect: DOMRect): SiteAnnotation['blockAnchor'] => {
  if (section.querySelector('.project-body-text, .project-section-title')) return;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const item = [...section.querySelectorAll<HTMLElement>('[data-grid-item-id]')].reverse().find((element) => {
    const bounds = annotationVisibleRect(element);
    return bounds.width > 0 && bounds.height > 0
      && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  });
  if (item) {
    const itemPath: string[] = [];
    let current: HTMLElement | null = item;
    while (current && current !== section) {
      if (current.dataset.gridItemId) itemPath.unshift(current.dataset.gridItemId);
      current = current.parentElement;
    }
    return { surface: 'media', itemPath };
  }
  if (section.querySelector('[data-grid-item-id]')) return { surface: 'block' };
  const media = section.matches('.project-image, .project-award')
    || section.querySelector(':scope > .project-media, :scope > .project-video-player, :scope > iframe');
  return { surface: media ? 'media' : 'block' };
};

const startDrawing = (target: Target, selected: { anchor: TextAnchor; rect: DOMRect } | null, existing?: SiteAnnotation) => {
  closeStage();
  target = annotationsFor(target).target;
  const anchor = existing?.anchor ?? selected?.anchor;
  const existingRect = existing ? annotationRect(target.section, existing) : null;
  const resolvedPart = existing?.textParts?.some((part) => part.slices.some((_, index) => textPartRect(target.section, part, index)));
  if (existing?.textParts?.some((part) => part.slices.some((_, index) => !textPartRect(target.section, part, index)))) {
    window.alert('Some highlighted text is missing or ambiguous. Restore it before editing this drawing.');
    return;
  }
  if (existing && !existingRect && (!resolvedPart || siteAnnotationHasFreeInk(existing))) {
    window.alert('This drawing’s target is missing. Restore or reattach it before editing.');
    return;
  }
  const textStrokes = existing?.textParts ? editableTextStrokes(target.section, existing) : undefined;
  if (existing?.textParts && !textStrokes) {
    window.alert('This highlight has reflowed. Restore its original layout or delete and redraw it to edit.');
    return;
  }
  if (existing) {
    editingImages = [...target.section.querySelectorAll<HTMLImageElement>('[data-site-annotation]')]
      .filter((image) => image.dataset.siteAnnotation === existing.id);
    editingImages.forEach((image) => { image.style.display = 'none'; });
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
  });
  const mobile = document.createElement('label');
  mobile.className = 'site-draw-stage__mobile';
  const mobileInput = document.createElement('input');
  mobileInput.type = 'checkbox';
  mobileInput.checked = existing ? existing.mobile === 'show' : currentKind === 'highlight';
  mobile.append(mobileInput, document.createTextNode('Show on phone'));
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
  if (drawLauncher) drawLauncher.hidden = true;
  overlay.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });

  const drawRef = createRef<DrawHandle>();
  activeDrawRef = drawRef;
  const sectionRect = target.section.getBoundingClientRect();
  const layoutAtOpen = layoutSnapshot(target.section);
  const scaleX = existing && existingRect ? existingRect.width / existing.board.w : 1;
  const scaleY = existing && existingRect ? existingRect.height / existing.board.h : 1;
  // Strokes have one pen width; exact anisotropic nib scaling would require transformed SVG paths.
  let latest: Stroke[] = textStrokes ?? (existing && existingRect ? existing.strokes.map((stroke) => ({
    ...stroke,
    size: stroke.size * Math.sqrt(scaleX * scaleY),
    points: stroke.points.map(([x, y, pressure]) => [
      sectionRect.left + existingRect.left + x * scaleX,
      sectionRect.top + existingRect.top + y * scaleY,
      pressure,
    ] as [number, number, number]),
  })) : []);
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
    const mobileVisibility = mobileInput.checked ? 'show' : 'hide';
    let annotation: SiteAnnotation;
    if (existing && JSON.stringify(latest) === initialStrokes) {
      annotation = { ...existing, mobile: mobileVisibility };
    } else {
      if (layoutChanged(layoutAtOpen, layoutSnapshot(target.section))) {
        window.alert('The page layout changed while drawing. Restore its original size and scroll position, or cancel and reopen Draw.');
        return;
      }
      const cropped = cropStrokes(latest);
      if (!cropped) { closeStage(); return; }
      const blockAnchor = existing?.blockAnchor ?? (!anchor ? doodleBlockAnchor(target.section, cropped.rect) : undefined);
      const textParts = captureTextParts(target.section, latest, cropped.rect, currentKind === 'highlight' || Boolean(existing?.textParts));
      const effectiveAnchor = anchor && (textParts || existing?.textParts) && !annotationBaseRect(target.section, { anchor })
        ? undefined : anchor;
      const base = annotationBaseRect(target.section, { anchor: effectiveAnchor, blockAnchor });
      if (!base) {
        window.alert('The drawing’s target moved or changed. Cancel and select it again.');
        return;
      }
      const x = cropped.rect.left - base.left;
      const y = cropped.rect.top - base.top;
      annotation = {
        id: existing?.id ?? crypto.randomUUID(),
        sectionId: target.sectionId,
        kind: currentKind,
        ...(effectiveAnchor ? { anchor: effectiveAnchor } : {}),
        ...(blockAnchor ? { blockAnchor } : {}),
        ...(textParts ? { textParts } : {}),
        ...(textParts ? { kind: 'doodle' as const } : {}),
        board: { w: cropped.rect.width, h: cropped.rect.height },
        box: (!textParts && currentKind === 'highlight') || blockAnchor
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
    const mobile = document.createElement('button');
    mobile.type = 'button';
    mobile.className = 'dev-btn dev-btn--page';
    mobile.dataset.siteDrawMobile = '';
    mobile.textContent = `Show ${label} on phone`;
    mobile.setAttribute('aria-pressed', String(annotation.mobile === 'show'));
    mobile.addEventListener('click', () => {
      entry.current[index] = { ...annotation, mobile: annotation.mobile === 'show' ? 'hide' : 'show' };
      pushPending(target);
      menu.remove();
    });
    menu.append(edit, mobile, remove);
    if (annotation.blockAnchor?.itemPath) {
      const reattach = document.createElement('button');
      reattach.type = 'button';
      reattach.className = 'dev-btn dev-btn--page';
      reattach.textContent = `Reattach ${label} to block`;
      reattach.addEventListener('click', () => {
        entry.current[index] = { ...annotation, blockAnchor: { surface: 'block' } };
        pushPending(target);
        menu.remove();
      });
      menu.append(reattach);
    }
    if (selected && annotation.anchor && !annotation.textParts?.length) {
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
  for (const section of document.querySelectorAll<HTMLElement>('[data-dev-content-id][data-dev-spacing-document]')) {
    if (!section.dataset.siteAnnotationSectionId) {
      section.dataset.siteAnnotationSectionId = section.dataset.devContentId;
      section.dataset.siteAnnotationDocument = section.dataset.devSpacingDocument;
    }
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-site-annotation-section-id][data-site-annotation-document]')) {
    const sectionId = section.dataset.siteAnnotationSectionId || '';
    const documentKey = section.dataset.siteAnnotationDocument || '';
    if (!sectionId || !documentKey) continue;
    const entry = annotationsFor({ section, sectionId, documentKey });
    const target = entry.target;
    target.section = section;
    if (section.querySelector('[data-site-draw-manage]')) continue;
    const controls = document.createElement('div');
    controls.className = 'site-draw-controls dev-surface';
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
    controls.append(manage);
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

const startFromSelection = (captured: ReturnType<typeof drawingSelection> | null = null) => {
  const selected = captured?.target.section.isConnected ? captured : drawingSelection();
  const target = selected?.target ?? shortcutTarget();
  if (!target) return false;
  window.getSelection()?.removeAllRanges();
  startDrawing(target, selected?.anchor ?? null);
  launcherSelection = null;
  return true;
};

const createLauncher = () => {
  if (drawLauncher) return;
  readLauncherPosition();
  const launcher = document.createElement('div');
  launcher.className = 'site-draw-launcher dev-surface';
  launcher.setAttribute('role', 'group');
  launcher.setAttribute('aria-label', 'Drawing tools');
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'site-draw-launcher__grip';
  grip.setAttribute('aria-label', 'Move Draw button');
  grip.innerHTML = '<svg aria-hidden="true" viewBox="0 0 18 18"><circle cx="5" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/><circle cx="5" cy="9" r="1.3"/><circle cx="13" cy="9" r="1.3"/><circle cx="5" cy="13" r="1.3"/><circle cx="13" cy="13" r="1.3"/></svg>';
  const draw = document.createElement('button');
  draw.type = 'button';
  draw.className = 'dev-btn dev-btn--page site-draw-launcher__draw';
  draw.textContent = 'Draw';
  const move = (event: PointerEvent) => {
    if (!launcherDragStart || event.pointerId !== launcherDragStart.pointerId) return;
    const x = launcherDragStart.left + event.clientX - launcherDragStart.x;
    const y = launcherDragStart.top + event.clientY - launcherDragStart.y;
    launcher.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const finishMove = (event: PointerEvent, cancelled = false) => {
    if (!launcherDragStart || event.pointerId !== launcherDragStart.pointerId) return;
    if (!cancelled) launcherPosition = nearestLauncherPosition(
      launcherDragStart.left + event.clientX - launcherDragStart.x + launcher.offsetWidth / 2,
      launcherDragStart.top + event.clientY - launcherDragStart.y + launcher.offsetHeight / 2,
    );
    else launcherPosition = launcherDragStart.position;
    launcherDragging = false;
    launcherDragStart = null;
    launcherSelection = null;
    if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture?.(event.pointerId);
    if (!cancelled) saveLauncherPosition();
    positionLauncher(!cancelled);
  };
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || launcherDragging) return;
    event.preventDefault();
    launcherDragging = true;
    launcherDragStart = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: launcher.getBoundingClientRect().left,
      top: launcher.getBoundingClientRect().top,
      position: launcherPosition,
    };
    grip.setPointerCapture?.(event.pointerId);
    launcher.classList.add('is-dragging');
    launcher.style.transform = `translate3d(${launcherDragStart.left}px, ${launcherDragStart.top}px, 0)`;
  });
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', (event) => {
    launcher.classList.remove('is-dragging');
    finishMove(event);
  });
  grip.addEventListener('pointercancel', (event) => {
    launcher.classList.remove('is-dragging');
    finishMove(event, true);
  });
  grip.addEventListener('lostpointercapture', (event) => {
    if (launcherDragging) {
      launcher.classList.remove('is-dragging');
      finishMove(event as PointerEvent, true);
    }
  });
  grip.addEventListener('keydown', (event) => {
    const direction = { ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1 }[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    launcherPosition = (launcherPosition + direction + 8) % 8;
    saveLauncherPosition();
    positionLauncher(true);
  });
  draw.addEventListener('pointerdown', (event) => {
    launcherSelection = drawingSelection();
    event.preventDefault();
  });
  draw.addEventListener('click', () => {
    const captured = launcherSelection;
    launcherSelection = null;
    startFromSelection(captured);
  });
  draw.addEventListener('pointercancel', () => { launcherSelection = null; });
  launcher.append(grip, draw);
  document.body.append(launcher);
  drawLauncher = launcher;
  positionLauncher();
};

const syncLauncher = (active = document.documentElement.classList.contains('is-dev-mode')) => {
  if (!active) {
    if (drawLauncher) drawLauncher.hidden = true;
    return;
  }
  createLauncher();
  if (!drawLauncher!.isConnected) document.body.append(drawLauncher!);
  if (!stage) drawLauncher!.hidden = false;
  positionLauncher();
};

const launcherViewportChanged = () => {
  if (launcherDragStart) {
    const pointerId = launcherDragStart.pointerId;
    launcherPosition = launcherDragStart.position;
    launcherDragStart = null;
    launcherDragging = false;
    drawLauncher?.classList.remove('is-dragging');
    const grip = drawLauncher?.querySelector<HTMLElement>('.site-draw-launcher__grip');
    if (grip?.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId);
  }
  positionLauncher();
};
window.addEventListener('resize', launcherViewportChanged, { signal: lifecycle.signal });
window.visualViewport?.addEventListener('resize', launcherViewportChanged, { signal: lifecycle.signal });
window.visualViewport?.addEventListener('scroll', launcherViewportChanged, { signal: lifecycle.signal });

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
  const selected = drawingSelection();
  if (!selected && !shortcutTarget()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  startFromSelection(selected);
}, { capture: true, signal: lifecycle.signal });

window.addEventListener('vcd:dev-mode-change', (event) => {
  const active = (event as CustomEvent<{ active: boolean }>).detail.active;
  if (!active) closeStage();
  else bindButtons();
  syncLauncher(active);
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
  bindButtons();
  syncLauncher();
}, { signal: lifecycle.signal });
document.addEventListener('astro:before-swap', closeStage, { signal: lifecycle.signal });
bindButtons();
syncLauncher();

if (import.meta.hot) import.meta.hot.dispose(() => { lifecycle.abort(); closeStage(); drawLauncher?.remove(); drawLauncher = null; state.clear(); });
