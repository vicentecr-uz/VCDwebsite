/**
 * Measure whether a region of an image reads as visually dark or light.
 *
 * Built for #182 — measuring a dropped hover-cover image at authoring time so
 * a card's title can pick a readable colour without any canvas work in the
 * visitor's browser. #172 (deferred, v2) will want the same primitive at
 * runtime; keep it decode-source-agnostic so it can be lifted as-is.
 */

export type NormalizedRegion = { x: number; y: number; w: number; h: number };

/** Below this mean relative luminance a region reads as a dark backdrop —
 * matches what `dark: true` already means for `titleColor` everywhere else
 * (dark backdrop -> light text). Named so a future tuning pass has one place
 * to change it. */
export const HOVER_LUMA_THRESHOLD = 0.7;

/** Long edge of the offscreen sample canvas, in px. Luminance only needs a
 * coarse read — this keeps the decode + pixel walk cheap. */
const SAMPLE_LONG_EDGE = 64;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const toLinear = (channel: number) => {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

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

  const x = Math.round(clamp01(region.x) * canvasWidth);
  const y = Math.round(clamp01(region.y) * canvasHeight);
  const w = Math.min(Math.max(1, Math.round(clamp01(region.w) * canvasWidth)), canvasWidth - x);
  const h = Math.min(Math.max(1, Math.round(clamp01(region.h) * canvasHeight)), canvasHeight - y);
  if (w <= 0 || h <= 0) return 0;

  const { data } = ctx.getImageData(x, y, w, h);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
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
