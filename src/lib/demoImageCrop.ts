import { coverWidthFraction, IMAGE_VIEWPORTS, normalizeImageVariants, responsiveImageStyle, type ImageVariant, type ImageViewport } from './responsiveImage';
import { createImageCropStage, cropResizeHeight, type CropResizeDirection } from './imageCropStage';
import { createCropWheelPanGain } from './cropWheelPan';

export interface DemoImageCropState {
  source: { src: string; width: number; height: number; alt: string };
  crop: { aspect: string; cx: number; cy: number; w: number };
  locked: boolean;
  variants?: Record<ImageViewport, ImageVariant>;
}

interface CropDemoOptions {
  host: HTMLElement;
  controls?: HTMLElement;
  sourceAspect?: number;
  initialAspect?: string;
  initialState?: DemoImageCropState;
  active?: boolean;
  onChange?: () => void;
}

const isValidAspect = (value: unknown): value is string => {
  if (value === 'original') return true;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return false;
  const [width, height] = value.split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
};

const viewports = IMAGE_VIEWPORTS;

const isValidCrop = (value: unknown): value is ImageVariant => {
  if (!value || typeof value !== 'object') return false;
  const crop = value as ImageVariant;
  return isValidAspect(crop.aspect)
    && Number.isFinite(crop.cx) && Number.isFinite(crop.cy)
    && Number.isFinite(crop.w) && crop.w > 0;
};

const validVariants = (value: unknown): value is Record<ImageViewport, ImageVariant> => (
  !!value && typeof value === 'object'
    && viewports.every((viewport) => isValidCrop((value as Record<string, unknown>)[viewport]))
);

const isValidState = (value: unknown): value is DemoImageCropState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as DemoImageCropState;
  const source = state.source;
  const crop = state.crop;
  return Boolean(source && typeof source.src === 'string' && source.src)
    && typeof source.alt === 'string'
    && Number.isFinite(source.width) && source.width > 0
    && Number.isFinite(source.height) && source.height > 0
    && Boolean(crop && isValidAspect(crop.aspect))
    && Number.isFinite(crop.cx) && Number.isFinite(crop.cy)
    && Number.isFinite(crop.w) && crop.w > 0
    && typeof state.locked === 'boolean';
};

const cloneState = (state: DemoImageCropState): DemoImageCropState => ({
  source: { ...state.source },
  crop: { ...state.crop },
  locked: state.locked,
  ...(validVariants(state.variants) ? {
    variants: Object.fromEntries(viewports.map((viewport) => [viewport, { ...state.variants![viewport] }])) as Record<ImageViewport, ImageVariant>,
  } : {}),
});

export function createDemoImageCrop({ host, controls, sourceAspect: initialSourceAspect = 4 / 3, initialAspect = '4:3', initialState, active = true, onChange }: CropDemoOptions) {
  const document = host.ownerDocument;
  const win = document.defaultView!;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const image = host.querySelector<HTMLImageElement>('.project-crop-clip img, img')!;
  const original = { src: image.dataset.imagePreview || image.src, alt: image.alt, width: initialSourceAspect, height: 1 };
  const requestedInitialState = isValidState(initialState) ? cloneState(initialState) : undefined;
  let variants = validVariants(requestedInitialState?.variants) ? requestedInitialState.variants : undefined;
  let viewport: ImageViewport = 'desktop';
  let source = requestedInitialState?.source ? { ...requestedInitialState.source } : { ...original };
  let dimensions = { width: source.width, height: source.height };
  let sourceAspect = source.width / source.height;
  let aspect = requestedInitialState?.crop.aspect ?? initialAspect;
  let w = requestedInitialState?.crop.w ?? coverWidthFraction(aspect, sourceAspect) / 1.25;
  let cx = requestedInitialState?.crop.cx ?? 0.5;
  let cy = requestedInitialState?.crop.cy ?? 0.5;
  let locked = requestedInitialState?.locked ?? true;
  const poseFitsLockedBounds = (pose: ImageVariant) => {
    const frameAspect = pose.aspect === 'original' ? sourceAspect : pose.aspect.split(':').map(Number).reduce((a, b) => a / b);
    const h = pose.w * sourceAspect / frameAspect;
    return pose.w <= 1 && h <= 1 && pose.cx >= pose.w / 2 && pose.cx <= 1 - pose.w / 2 && pose.cy >= h / 2 && pose.cy <= 1 - h / 2;
  };
  const loadPose = (pose: ImageVariant) => {
    aspect = pose.aspect; cx = pose.cx; cy = pose.cy; w = pose.w;
    if (locked && !poseFitsLockedBounds(pose)) locked = false;
  };
  if (variants) loadPose(variants.desktop);
  const initialBaseline = requestedInitialState ?? {
    source: { ...original },
    crop: { aspect: initialAspect, cx: 0.5, cy: 0.5, w: coverWidthFraction(initialAspect, initialSourceAspect) / 1.25 },
    locked: true,
  };
  const initialBaselineState = cloneState(initialBaseline);
  const { stage, ghost, ghostImg } = createImageCropStage({ src: source.src, document });
  image.src = source.src;
  image.alt = source.alt;
  image.removeAttribute('role');
  image.removeAttribute('tabindex');
  image.removeAttribute('aria-label');
  image.draggable = false;
  host.classList.add('dev-crop-stage-host');
  host.prepend(ghost);
  host.append(stage);
  stage.style.inset = ghost.style.inset = '0';
  const preview = controls?.querySelector<HTMLElement>('[data-crop-preview]');
  const select = controls?.querySelector<HTMLSelectElement>('select.dev-select__native');
  const constraint = controls?.querySelector<HTMLButtonElement>('[data-crop-constraint]');
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  let syncingSelect = false;
  let pointerFrame = 0;
  let renderedAspect: string | undefined;
  let renderedAspectValue: string | undefined;
  let renderedLocked: boolean | undefined;
  const cancelPointerRender = () => {
    if (!pointerFrame) return;
    win.cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
  };
  const schedulePointerRender = () => {
    if (pointerFrame) return;
    pointerFrame = win.requestAnimationFrame(() => {
      pointerFrame = 0;
      render();
    });
  };
  const flushPointerRender = () => {
    if (!pointerFrame) return;
    cancelPointerRender();
    render();
  };
  const applySource = () => {
    image.src = source.src; image.alt = source.alt; ghostImg.src = source.src;
    const previewImage = preview?.querySelector<HTMLImageElement>('[data-crop-image]');
    if (previewImage) { previewImage.src = source.src; previewImage.alt = source.alt; }
  };
  const aspectValue = () => aspect === 'original' ? sourceAspect : aspect.split(':').map(Number).reduce((a, b) => a / b);
  const contentHeight = () => w * sourceAspect / aspectValue();
  const minWidth = () => coverWidthFraction(aspect, sourceAspect) / 100;
  const maxWidth = () => coverWidthFraction(aspect, sourceAspect) / (locked ? 1 : 0.01);
  const render = () => {
    cancelPointerRender();
    w = clamp(w, minWidth(), maxWidth());
    const h = contentHeight();
    const xReach = Math.max(1.5, w / 2);
    const yReach = Math.max(1.5, h / 2);
    cx = locked ? clamp(cx, w / 2, 1 - w / 2) : clamp(cx, 0.5 - xReach, 0.5 + xReach);
    cy = locked ? clamp(cy, h / 2, 1 - h / 2) : clamp(cy, 0.5 - yReach, 0.5 + yReach);
    const pose = { aspect, cx, cy, w };
    if (variants) variants[viewport] = { ...pose };
    const styles = responsiveImageStyle(variants ?? normalizeImageVariants({ desktop: pose, tablet: pose, mobile: pose }, aspect, dimensions), dimensions);
    for (const declaration of styles.split(';')) {
      const colon = declaration.indexOf(':');
      host.style.setProperty(declaration.slice(0, colon), declaration.slice(colon + 1));
    }
    const nextAspectValue = String(aspectValue());
    const aspectChanged = aspect !== renderedAspect;
    const aspectValueChanged = nextAspectValue !== renderedAspectValue;
    if (aspectChanged) host.dataset.cropAspect = aspect;
    if (aspectChanged || aspectValueChanged) {
      host.closest<HTMLElement>('[data-crop-demo]')?.style.setProperty('--crop-demo-aspect', nextAspectValue);
      controls?.style.setProperty('--crop-demo-aspect', nextAspectValue);
      if (preview) preview.style.aspectRatio = nextAspectValue;
      renderedAspect = aspect;
      renderedAspectValue = nextAspectValue;
    }
    if (preview) {
      preview.style.setProperty('--tuner-content-w', String(w));
      preview.style.setProperty('--tuner-content-cx', String(cx));
      preview.style.setProperty('--tuner-content-cy', String(cy));
    }
    ghostImg.style.setProperty('--project-content-w', String(w));
    ghostImg.style.setProperty('--project-content-cx', String(cx));
    ghostImg.style.setProperty('--project-content-cy', String(cy));
    if (locked !== renderedLocked) {
      constraint?.setAttribute('aria-pressed', String(locked));
      constraint?.classList.toggle('is-locked', locked);
      const label = constraint?.querySelector('[data-crop-constraint-state]');
      if (label) label.textContent = locked ? 'Crop locked' : 'Crop unlocked';
      const lockPath = constraint?.querySelector('path');
      lockPath?.setAttribute('d', locked ? 'M7 11V7a5 5 0 0 1 10 0v4' : 'M7 11V7a5 5 0 0 1 9.9-1');
      renderedLocked = locked;
    }
    onChange?.();
  };
  const syncSelect = () => {
    if (!select) return;
    let custom = select.querySelector<HTMLOptionElement>('[data-crop-custom]');
    const preset = [...select.options].some((option) => option !== custom && option.value === aspect);
    if (preset) custom?.remove();
    else {
      if (!custom) { custom = select.ownerDocument.createElement('option'); custom.dataset.cropCustom = ''; select.append(custom); }
      custom.value = aspect;
      custom.textContent = 'Custom';
    }
    select.value = aspect;
    syncingSelect = true;
    const selectWindow = select.ownerDocument.defaultView!;
    select.dispatchEvent(new selectWindow.Event('change', { bubbles: true }));
    syncingSelect = false;
  };
  const zoomAt = (factor: number, x = 0.5, y = 0.5) => {
    const sourceX = cx + (x - 0.5) * w;
    const sourceY = cy + (y - 0.5) * contentHeight();
    w = clamp(w / factor, minWidth(), maxWidth());
    cx = sourceX - (x - 0.5) * w;
    cy = sourceY - (y - 0.5) * contentHeight();
  };
  const panBy = (dx: number, dy: number) => {
    if (!active || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    cx -= dx * w;
    cy -= dy * contentHeight();
    render();
    return true;
  };
  const zoomBy = (factor: number, x = 0.5, y = 0.5) => {
    if (!active || !Number.isFinite(factor) || factor <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    zoomAt(factor, x, y);
    render();
    return true;
  };
  const releases: Array<() => void> = [];
  const bind = (surface: HTMLElement) => {
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-label', 'Crop image. Drag or use arrow keys to pan; pinch or use plus and minus to zoom. Drag an edge to resize.');
    surface.tabIndex = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: { x: number; y: number; cx: number; cy: number; w: number; h: number; bounds: DOMRect; direction?: CropResizeDirection } | undefined;
    let pinch: { distance: number; w: number; sourceX: number; sourceY: number } | undefined;
    let wheelFrame = 0;
    let wheelIdle = 0;
    let speed = 0;
    const panGain = createCropWheelPanGain(160);
    let lastWheelMode: boolean | null = null;
    let pending: { dx: number; dy: number; zoom: boolean; x: number; y: number; bounds: DOMRect } | undefined;
    const flushWheel = () => {
      wheelFrame = 0;
      if (!pending) return;
      const { dx, dy, zoom, x, y, bounds } = pending;
      pending = undefined;
      if (zoom) {
        speed += (Math.abs(dy) - speed) * 0.32;
        const t = Math.min(1, speed / 40);
        const blend = t * t * (3 - 2 * t);
        zoomAt(Math.exp(-dy * (0.00085 + (0.0022 - 0.00085) * blend)), x, y);
      } else {
        cx += dx / bounds.width * w;
        cy += dy / bounds.height * contentHeight();
      }
      render();
    };
    const release = () => {
      const ids = [...pointers.keys()];
      pointers.clear();
      gesture = pinch = undefined;
      surface.classList.remove('is-dragging', 'is-resizing');
      ids.forEach((id) => { if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); });
      if (wheelFrame) win.cancelAnimationFrame(wheelFrame);
      if (wheelIdle) win.clearTimeout(wheelIdle);
      wheelFrame = wheelIdle = 0;
      pending = undefined;
      speed = 0;
      panGain.reset();
      lastWheelMode = null;
    };
    releases.push(release);
    surface.addEventListener('pointerdown', (event) => {
      if (!active || event.button !== 0 || (gesture?.direction && pointers.size)) return;
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      surface.focus({ preventScroll: true });
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      surface.setPointerCapture(event.pointerId);
      if (pointers.size === 1) {
        const direction = (event.target as HTMLElement).closest<HTMLElement>('[data-page-resize], [data-crop-resize]');
        gesture = { x: event.clientX, y: event.clientY, cx, cy, w, h: contentHeight(), bounds, direction: (direction?.dataset.pageResize || direction?.dataset.cropResize) as CropResizeDirection | undefined };
        surface.classList.add(gesture.direction ? 'is-resizing' : 'is-dragging');
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), w, sourceX: cx + ((a.x + b.x) / 2 - bounds.left - bounds.width / 2) / bounds.width * w, sourceY: cy + ((a.y + b.y) / 2 - bounds.top - bounds.height / 2) / bounds.height * contentHeight() };
      }
    }, { signal });
    surface.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const { bounds } = gesture;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        w = clamp(pinch.w * pinch.distance / Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), minWidth(), maxWidth());
        cx = pinch.sourceX - ((a.x + b.x) / 2 - bounds.left - bounds.width / 2) / bounds.width * w;
        cy = pinch.sourceY - ((a.y + b.y) / 2 - bounds.top - bounds.height / 2) / bounds.height * contentHeight();
      } else {
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (gesture.direction) aspect = `${Math.round(bounds.width)}:${Math.round(cropResizeHeight(gesture.direction, bounds.width, bounds.height, dx, dy))}`;
        else {
          cx = gesture.cx - (event.shiftKey && Math.abs(dy) > Math.abs(dx) ? 0 : dx) / bounds.width * gesture.w;
          cy = gesture.cy - (event.shiftKey && Math.abs(dx) >= Math.abs(dy) ? 0 : dy) / bounds.height * gesture.h;
        }
      }
      schedulePointerRender();
    }, { signal });
    const end = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      const resized = Boolean(gesture?.direction);
      flushPointerRender();
      release();
      if (resized) syncSelect();
    };
    surface.addEventListener('pointerup', end, { signal });
    surface.addEventListener('pointercancel', end, { signal });
    surface.addEventListener('lostpointercapture', end, { signal });
    surface.addEventListener('wheel', (event) => {
      if (!active || gesture) return;
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      const zoom = event.ctrlKey || (locked && w >= 0.9999 && contentHeight() >= 0.9999);
      if (lastWheelMode !== null && lastWheelMode !== zoom) {
        if (wheelFrame) {
          win.cancelAnimationFrame(wheelFrame);
          wheelFrame = 0;
        }
        flushWheel();
        panGain.reset();
      }
      lastWheelMode = zoom;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const gain = zoom ? 1 : panGain.gainFor(dx, dy, event.timeStamp);
      pending = { dx: (pending?.dx ?? 0) + dx * gain, dy: (pending?.dy ?? 0) + dy * gain, zoom, x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, bounds };
      if (!wheelFrame) wheelFrame = win.requestAnimationFrame(flushWheel);
      if (wheelIdle) win.clearTimeout(wheelIdle);
      wheelIdle = win.setTimeout(() => {
        speed = 0;
        panGain.reset();
        lastWheelMode = null;
        wheelIdle = 0;
      }, 160);
    }, { signal, passive: false });
    surface.addEventListener('keydown', (event) => {
      if (!active) return;
      const step = event.shiftKey ? 0.05 : 0.02;
      if (event.key === 'Escape') release();
      else if (event.key === '+' || event.key === '=') zoomAt(1.1);
      else if (event.key === '-') zoomAt(1 / 1.1);
      else if (event.key === 'ArrowLeft') cx -= step;
      else if (event.key === 'ArrowRight') cx += step;
      else if (event.key === 'ArrowUp') cy -= step;
      else if (event.key === 'ArrowDown') cy += step;
      else return;
      event.preventDefault();
      render();
    }, { signal });
  };
  bind(stage);
  if (preview) bind(preview);
  select?.addEventListener('change', () => {
    if (syncingSelect) return;
    const value = select.value;
    if (value !== 'original' && !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return;
    aspect = value;
    render();
  }, { signal });
  const setViewport = (next: ImageViewport) => {
    if (!variants || !viewports.includes(next)) return;
    cancelPointerRender();
    releases.forEach((release) => release());
    viewport = next;
    loadPose(variants[viewport]);
    render(); syncSelect();
  };
  const getViewport = () => viewport;
  controls?.querySelector('[data-crop-center-x]')?.addEventListener('click', () => { cx = 0.5; render(); }, { signal });
  controls?.querySelector('[data-crop-center-y]')?.addEventListener('click', () => { cy = 0.5; render(); }, { signal });
  controls?.querySelector('[data-crop-fit]')?.addEventListener('click', () => { locked = false; cx = cy = 0.5; w = Math.max(1, aspectValue() / sourceAspect); render(); }, { signal });
  constraint?.addEventListener('click', () => { locked = !locked; render(); }, { signal });
  const resetCrop = () => {
    cancelPointerRender();
    releases.forEach((release) => release());
    aspect = initialAspect;
    w = coverWidthFraction(aspect, sourceAspect) / 1.25;
    cx = cy = 0.5;
    locked = true;
    if (variants) {
      const pose = { aspect, cx, cy, w };
      variants = { desktop: { ...pose }, tablet: { ...pose }, mobile: { ...pose } };
    }
    render(); syncSelect();
  };
  const setSource = (next: { src: string; width: number; height: number; alt?: string }) => {
    if (!next || typeof next.src !== 'string' || !next.src || !Number.isFinite(next.width) || !Number.isFinite(next.height) || next.width <= 0 || next.height <= 0) return false;
    source = { src: next.src, width: next.width, height: next.height, alt: next.alt ?? source.alt }; dimensions = { width: next.width, height: next.height }; sourceAspect = next.width / next.height; applySource();
    resetCrop(); return true;
  };
  const getState = (): DemoImageCropState => cloneState({ source: { ...source }, crop: { aspect, cx, cy, w }, locked, ...(variants ? { variants } : {}) });
  const restore = (next: DemoImageCropState) => {
    if (!isValidState(next) || (next.variants !== undefined && !validVariants(next.variants))) return false;
    cancelPointerRender();
    const nextVariants = validVariants(next.variants) ? Object.fromEntries(viewports.map((name) => [name, { ...next.variants![name] }])) as Record<ImageViewport, ImageVariant> : undefined;
    releases.forEach((release) => release());
    source = { ...next.source };
    dimensions = { width: source.width, height: source.height };
    sourceAspect = source.width / source.height;
    locked = next.locked;
    variants = nextVariants;
    loadPose(variants?.[viewport] ?? next.crop);
    applySource();
    render();
    syncSelect();
    return true;
  };
  const reset = () => restore(initialBaselineState);
  controls?.querySelector('[data-crop-reset]')?.addEventListener('click', reset, { signal });
  const setActive = (next: boolean) => {
    active = next;
    if (!active) {
      cancelPointerRender();
      releases.forEach((release) => release());
    }
    stage.classList.toggle('is-visible', active);
    ghost.classList.toggle('is-visible', active);
    stage.style.pointerEvents = active ? '' : 'none';
    stage.tabIndex = active ? 0 : -1;
    stage.setAttribute('aria-hidden', String(!active));
  };
  applySource();
  render(); syncSelect(); setActive(active);
  return { reset, setSource, getState, restore, setViewport, getViewport, setActive, panBy, zoomBy, destroy() {
    cancelPointerRender();
    releases.forEach((release) => release());
    lifecycle.abort();
    stage.remove(); ghost.remove();
    host.classList.remove('dev-crop-stage-host');
  } };
}
