const MAX_PIXELS = 8_000_000;

interface DemoCropBitmapOptions {
  image: HTMLImageElement;
  ghostImage: HTMLImageElement;
  previewImage?: HTMLImageElement;
}

interface CanvasRecord {
  image: HTMLImageElement;
  canvas: HTMLCanvasElement;
  opacity: string;
}

const canvasStyle = (kind: 'main' | 'ghost' | 'preview') => {
  const vars = kind === 'preview'
    ? 'var(--tuner-content-w, 1)' : 'var(--project-content-w, 1)';
  const x = kind === 'preview'
    ? 'var(--tuner-content-cx, .5)' : 'var(--project-content-cx, .5)';
  const y = kind === 'preview'
    ? 'var(--tuner-content-cy, .5)' : 'var(--project-content-cy, .5)';
  return `position:absolute;top:50%;left:50%;width:100%;height:auto;max-width:none;transform-origin:0 0;transform:scale(calc(1 / ${vars})) translate(calc(${x} * -100%), calc(${y} * -100%));will-change:transform;pointer-events:none;${kind === 'ghost' ? 'opacity:.25;' : ''}`;
};

export function createDemoCropBitmap({ image, ghostImage, previewImage }: DemoCropBitmapOptions) {
  const records: CanvasRecord[] = [];
  let generation = 0;
  let currentSrc = '';
  let readyPromise: Promise<boolean> = Promise.resolve(false);
  let destroyed = false;

  const restore = (record: CanvasRecord) => {
    if (record.opacity) record.image.style.opacity = record.opacity;
    else record.image.style.removeProperty('opacity');
  };
  const remove = () => {
    records.splice(0).forEach((record) => {
      restore(record);
      record.canvas.width = 0;
      record.canvas.height = 0;
      record.canvas.remove();
    });
    currentSrc = '';
  };
  const makeCanvas = (source: HTMLCanvasElement, target: HTMLImageElement, kind: 'main' | 'ghost' | 'preview', allocations: CanvasRecord[]) => {
    const canvas = target.ownerDocument.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.style.cssText = canvasStyle(kind);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');
    canvas.className = 'demo-crop-bitmap';
    const record = { image: target, canvas, opacity: target.style.opacity };
    allocations.push(record);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.drawImage(source, 0, 0);
    return record;
  };
  const prepare = (src: string) => {
    if (destroyed) return Promise.resolve(false);
    if (src === currentSrc && records.length) return readyPromise;
    const token = ++generation;
    remove();
    readyPromise = (async () => {
      const next: CanvasRecord[] = [];
      const cleanup = () => next.forEach((record) => { record.canvas.width = 0; record.canvas.height = 0; record.canvas.remove(); });
      try {
        if (typeof image.decode !== 'function') return false;
        await image.decode();
        if (token !== generation) return false;
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        // Keep this single-pass bitmap under an 8MP ceiling; tiled rendering is the upgrade path for larger uploads.
        if (!width || !height || width * height > MAX_PIXELS) return false;
        const mainCanvas = image.ownerDocument.createElement('canvas');
        mainCanvas.width = width;
        mainCanvas.height = height;
        mainCanvas.style.cssText = canvasStyle('main');
        mainCanvas.setAttribute('aria-hidden', 'true');
        mainCanvas.setAttribute('role', 'presentation');
        mainCanvas.className = 'demo-crop-bitmap';
        const mainRecord = { image, canvas: mainCanvas, opacity: image.style.opacity };
        next.push(mainRecord);
        const mainContext = mainCanvas.getContext('2d');
        if (!mainContext) throw new Error('Canvas rendering is unavailable.');
        mainContext.drawImage(image, 0, 0);
        makeCanvas(mainCanvas, ghostImage, 'ghost', next);
        if (previewImage) makeCanvas(mainCanvas, previewImage, 'preview', next);
        if (token !== generation) {
          cleanup();
          return false;
        }
        image.insertAdjacentElement('afterend', next[0].canvas);
        ghostImage.insertAdjacentElement('afterend', next[1].canvas);
        if (previewImage && next[2]) previewImage.insertAdjacentElement('afterend', next[2].canvas);
        records.push(...next);
        currentSrc = src;
        records.forEach((record) => { record.image.style.opacity = '0'; });
        return true;
      } catch {
        cleanup();
        return false;
      }
    })();
    return readyPromise;
  };
  return {
    prepare,
    whenReady: () => readyPromise,
    destroy() { destroyed = true; generation += 1; remove(); readyPromise = Promise.resolve(false); },
  };
}
