export const IMAGE_LIGHTBOX_MAX_SCALE = 4;

export interface Point {
  x: number;
  y: number;
}

export const syncLightboxImage = (image: HTMLImageElement, source: string): void => {
  if (!source || source.endsWith('placeholder.svg')) {
    image.removeAttribute('data-image-original');
    image.removeAttribute('role');
    image.removeAttribute('tabindex');
    image.removeAttribute('aria-label');
    return;
  }
  image.dataset.imageOriginal = source;
  image.setAttribute('role', 'button');
  image.setAttribute('tabindex', '0');
  image.setAttribute('aria-label', `Open image: ${image.alt || 'image'}`);
};

export const clampImageScale = (scale: number): number => Math.min(
  IMAGE_LIGHTBOX_MAX_SCALE,
  Math.max(1, Number.isFinite(scale) ? scale : 1),
);

export const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export const pinchScale = (startScale: number, startDistance: number, currentDistance: number): number => (
  clampImageScale(startScale * (currentDistance / Math.max(startDistance, 1)))
);

export const panForPointer = (startPan: Point, startPoint: Point, currentPoint: Point): Point => ({
  x: startPan.x + currentPoint.x - startPoint.x,
  y: startPan.y + currentPoint.y - startPoint.y,
});

export const panForPinch = (
  startPan: Point,
  startMidpoint: Point,
  currentMidpoint: Point,
  startScale: number,
  currentScale: number,
  centre: Point,
): Point => {
  const ratio = currentScale / Math.max(startScale, 1);
  return {
    x: currentMidpoint.x - centre.x - ((startMidpoint.x - centre.x) - startPan.x) * ratio,
    y: currentMidpoint.y - centre.y - ((startMidpoint.y - centre.y) - startPan.y) * ratio,
  };
};
