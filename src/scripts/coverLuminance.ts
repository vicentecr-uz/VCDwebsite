/**
 * Measure whether a region of an image reads as visually dark or light.
 *
 * Shared by dropped-image authoring and runtime gallery sampling. Keep the
 * measurement decode-source-agnostic so both paths use the same threshold.
 */

export type NormalizedRegion = { x: number; y: number; w: number; h: number };

/**
 * Gallery adaptive ink — when cover titles / meta flip light↔dark.
 * Agents: change **only this constant** (not CSS, not ProjectGrid). Higher =
 * stay on dark ink longer over mid-tones; lower = flip to light ink sooner.
 * Wired via `isRegionDark` → `adaptiveMediaInk` → `bindGalleryMediaInk`.
 */
export const HOVER_LUMA_THRESHOLD = 0.6;

/** Chips keep a light surface through mid-tones; their protective fill supplies contrast. */
export const CHIP_DARK_LUMA_THRESHOLD = 0.25;

/** Long edge of the offscreen sample canvas, in px. Luminance only needs a
 * coarse read — this keeps the decode + pixel walk cheap. */
const SAMPLE_LONG_EDGE = 64;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const toLinear = (channel: number) => {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

function canvasRegionLuma(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  region: NormalizedRegion,
): number {
  const x = Math.round(clamp01(region.x) * canvasWidth);
  const y = Math.round(clamp01(region.y) * canvasHeight);
  const w = Math.min(Math.max(1, Math.round(clamp01(region.w) * canvasWidth)), canvasWidth - x);
  const h = Math.min(Math.max(1, Math.round(clamp01(region.h) * canvasHeight)), canvasHeight - y);
  if (w <= 0 || h <= 0) return 0;

  const { data } = ctx.getImageData(x, y, w, h);
  return pixelsLuma(data);
}

function pixelsLuma(data: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Mean relative luminance (0..1) of a normalised region of `source`.
 * `region` is a fraction (0..1) of the source's own natural bounds — project
 * through whatever crop / `object-fit` box the region was derived from
 * before calling this (see `coverBoxRegionToSourceRegion`).
 */
export function measureRegionLuma(
  source: CanvasImageSource,
  region: NormalizedRegion,
): number {
  const naturalWidth = Number(
    (source as HTMLImageElement).naturalWidth ?? (source as HTMLCanvasElement).width,
  ) || 0;
  const naturalHeight = Number(
    (source as HTMLImageElement).naturalHeight ?? (source as HTMLCanvasElement).height,
  ) || 0;
  if (!naturalWidth || !naturalHeight) return 0;

  const scale = SAMPLE_LONG_EDGE / Math.max(naturalWidth, naturalHeight);
  const canvasWidth = Math.max(1, Math.round(naturalWidth * scale));
  const canvasHeight = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.drawImage(source, 0, 0, canvasWidth, canvasHeight);

  return canvasRegionLuma(ctx, canvasWidth, canvasHeight, region);
}

/**
 * Mean luminance of a region after the image is laid out in its visible frame
 * and composited over a background colour. Unlike source-only sampling, this
 * includes transparent pixels and any frame area exposed by an unlocked crop.
 */
export function measureRenderedRegionLuma(
  source: CanvasImageSource,
  region: NormalizedRegion,
  box: { width: number; height: number },
  sourceSize: { width: number; height: number },
  crop: { w: number; cx: number; cy: number } | null,
  background: string,
): number {
  return measureRenderedRegion(source, region, box, sourceSize, crop, background)?.luma ?? 0;
}

export type RenderedRegionSample = { luma: number; pixels: Uint8ClampedArray };

export function measureRenderedRegion(
  source: CanvasImageSource,
  region: NormalizedRegion,
  box: { width: number; height: number },
  sourceSize: { width: number; height: number },
  crop: { w: number; cx: number; cy: number } | null,
  background: string,
): RenderedRegionSample | null {
  if (
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    !Number.isFinite(region.w) ||
    !Number.isFinite(region.h) ||
    region.w <= 0 ||
    region.h <= 0 ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    !Number.isFinite(sourceSize.width) ||
    !Number.isFinite(sourceSize.height) ||
    box.width <= 0 ||
    box.height <= 0 ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0
  ) return null;

  const regionX = region.x * box.width;
  const regionY = region.y * box.height;
  const regionWidth = region.w * box.width;
  const regionHeight = region.h * box.height;
  const sampleScale = SAMPLE_LONG_EDGE / Math.max(regionWidth, regionHeight);
  const canvasWidth = Math.max(1, Math.round(regionWidth * sampleScale));
  const canvasHeight = Math.max(1, Math.round(regionHeight * sampleScale));
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  let displayedWidth: number;
  let displayedHeight: number;
  let left: number;
  let top: number;
  if (crop && Number.isFinite(crop.w) && Number.isFinite(crop.cx) && Number.isFinite(crop.cy) && crop.w > 0) {
    displayedWidth = box.width / crop.w;
    displayedHeight = displayedWidth * sourceSize.height / sourceSize.width;
    left = box.width / 2 - crop.cx * displayedWidth;
    top = box.height / 2 - crop.cy * displayedHeight;
  } else {
    const coverScale = Math.max(box.width / sourceSize.width, box.height / sourceSize.height);
    displayedWidth = sourceSize.width * coverScale;
    displayedHeight = sourceSize.height * coverScale;
    left = (box.width - displayedWidth) / 2;
    top = (box.height - displayedHeight) / 2;
  }

  const scaleX = canvasWidth / regionWidth;
  const scaleY = canvasHeight / regionHeight;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-regionX * scaleX, -regionY * scaleY, box.width * scaleX, box.height * scaleY);
  ctx.clip();
  ctx.drawImage(
    source,
    (left - regionX) * scaleX,
    (top - regionY) * scaleY,
    displayedWidth * scaleX,
    displayedHeight * scaleY,
  );
  ctx.restore();

  const pixels = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
  return { luma: pixelsLuma(pixels), pixels };
}

/**
 * Map a normalised region of an `object-fit: cover` display box (e.g. the
 * card's title area, relative to the cover frame) into the normalised region
 * of the underlying source image that actually shows there — i.e. undo the
 * crop `cover` performs so `measureRegionLuma` samples the right pixels.
 */
export function coverBoxRegionToSourceRegion(
  region: NormalizedRegion,
  box: { width: number; height: number },
  source: { width: number; height: number },
): NormalizedRegion {
  if (!box.width || !box.height || !source.width || !source.height) return region;

  const scale = Math.max(box.width / source.width, box.height / source.height);
  const displayedWidth = source.width * scale;
  const displayedHeight = source.height * scale;
  const offsetX = (displayedWidth - box.width) / 2;
  const offsetY = (displayedHeight - box.height) / 2;

  const x0 = clamp01((region.x * box.width + offsetX) / displayedWidth);
  const y0 = clamp01((region.y * box.height + offsetY) / displayedHeight);
  const x1 = clamp01((( region.x + region.w) * box.width + offsetX) / displayedWidth);
  const y1 = clamp01((( region.y + region.h) * box.height + offsetY) / displayedHeight);

  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function isRegionDark(luma: number, threshold = HOVER_LUMA_THRESHOLD): boolean {
  return luma < threshold;
}
