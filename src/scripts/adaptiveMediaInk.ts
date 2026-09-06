/**
 * Decode-source-agnostic media-ground sampling for gallery cards (#172 v1).
 * Reuses coverLuminance.ts — do not duplicate the luma loop.
 * Retune light/dark flip: `HOVER_LUMA_THRESHOLD` in `coverLuminance.ts`.
 */

import {
  coverBoxRegionToSourceRegion,
  isRegionDark,
  measureRenderedRegionLuma,
  measureRegionLuma,
  type NormalizedRegion,
} from './coverLuminance';

export function elementRegionInCover(el: HTMLElement, coverRect: DOMRect): NormalizedRegion | null {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height || !coverRect.width || !coverRect.height) return null;
  return {
    x: (rect.left - coverRect.left) / coverRect.width,
    y: (rect.top - coverRect.top) / coverRect.height,
    w: rect.width / coverRect.width,
    h: rect.height / coverRect.height,
  };
}

export function groundForBox(
  el: HTMLElement,
  cover: HTMLElement,
  decoded: CanvasImageSource,
  frame: { width: number; height: number },
  source: { width: number; height: number },
  crop: { w: number; cx: number; cy: number } | null,
  background?: string,
): MediaGround | null {
  const coverRect = cover.getBoundingClientRect();
  const region = elementRegionInCover(el, coverRect);
  if (!region) return null;
  if (background) {
    const luma = measureRenderedRegionLuma(decoded, region, frame, source, crop, background);
    return isRegionDark(luma) ? 'dark' : 'light';
  }
  const sourceRegion = crop
    ? cropFrameRegionToSourceRegion(region, frame, source, crop)
    : coverBoxRegionToSourceRegion(region, frame, source);
  return groundForRegion(decoded, sourceRegion);
}

export function cropHostFor(cover: HTMLElement): HTMLElement | null {
  if (cover.classList.contains('project-cropped') || cover.classList.contains('project-responsive-image')) {
    return cover;
  }
  return cover.closest<HTMLElement>('.project-cropped, .project-responsive-image');
}

export function readCropVars(host: HTMLElement, hover: boolean): { w: number; cx: number; cy: number } | null {
  const style = getComputedStyle(host);
  const wRaw = style.getPropertyValue(hover ? '--project-hover-content-w' : '--project-content-w').trim();
  const cxRaw = style.getPropertyValue(hover ? '--project-hover-content-cx' : '--project-content-cx').trim();
  const cyRaw = style.getPropertyValue(hover ? '--project-hover-content-cy' : '--project-content-cy').trim();
  const w = parseFloat(wRaw);
  const cx = parseFloat(cxRaw);
  const cy = parseFloat(cyRaw);
  if (!Number.isFinite(w) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { w, cx, cy };
}

export type MediaGround = 'light' | 'dark';
export type { NormalizedRegion };

const decodeCache = new Map<string, Promise<HTMLImageElement | null>>();

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Cache by image src. One decode per distinct URL. */
export async function lumaGridFor(src: string): Promise<CanvasImageSource | null> {
  let pending = decodeCache.get(src);
  if (!pending) {
    pending = (async () => {
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('decode failed'));
          img.src = src;
        });
        if (typeof img.decode === 'function') {
          try {
            await img.decode();
          } catch {
            /* paint-ready enough after load */
          }
        }
        return img.naturalWidth > 0 ? img : null;
      } catch {
        return null;
      }
    })();
    decodeCache.set(src, pending);
  }
  return pending;
}

export function groundForRegion(source: CanvasImageSource, sourceRegion: NormalizedRegion): MediaGround {
  const luma = measureRegionLuma(source, sourceRegion);
  return isRegionDark(luma) ? 'dark' : 'light';
}

/**
 * Frame-normalised region → source-normalised region for the cropped cover CSS
 * model (not object-fit:cover). Source point (cx,cy) is at the frame centre;
 * visible source width fraction is `w` (`--project-content-w`).
 *
 * nx = cx + (fx - 0.5) * w
 * ny = cy + (fy - 0.5) * (frameH * w * natW) / (frameW * natH)
 */
export function cropFrameRegionToSourceRegion(
  region: NormalizedRegion,
  frame: { width: number; height: number },
  source: { width: number; height: number },
  crop: { w: number; cx: number; cy: number },
): NormalizedRegion {
  const { w: cropW, cx, cy } = crop;
  if (
    !Number.isFinite(cropW) ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !frame.width ||
    !frame.height ||
    !source.width ||
    !source.height
  ) {
    return coverBoxRegionToSourceRegion(region, frame, source);
  }

  const yScale = (frame.height * cropW * source.width) / (frame.width * source.height);

  const mapPoint = (fx: number, fy: number) => ({
    x: cx + (fx - 0.5) * cropW,
    y: cy + (fy - 0.5) * yScale,
  });

  const corners = [
    mapPoint(region.x, region.y),
    mapPoint(region.x + region.w, region.y),
    mapPoint(region.x, region.y + region.h),
    mapPoint(region.x + region.w, region.y + region.h),
  ];

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const point of corners) {
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
  }

  const sx = clamp01(x0);
  const sy = clamp01(y0);
  const ex = clamp01(x1);
  const ey = clamp01(y1);

  return { x: sx, y: sy, w: Math.max(0, ex - sx), h: Math.max(0, ey - sy) };
}

export function unionFrameRegions(regions: NormalizedRegion[]): NormalizedRegion {
  if (!regions.length) return { x: 0, y: 0, w: 0, h: 0 };

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const region of regions) {
    x0 = Math.min(x0, region.x);
    y0 = Math.min(y0, region.y);
    x1 = Math.max(x1, region.x + region.w);
    y1 = Math.max(y1, region.y + region.h);
  }

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function applyMediaGround(host: HTMLElement, ground: MediaGround): void {
  host.dataset.mediaGround = ground;
  host.style.setProperty(
    '--media-ink',
    ground === 'dark' ? 'var(--sys-color-on-dark-media)' : 'var(--sys-color-on-light-media)',
  );
  host.style.setProperty(
    '--media-ink-subtle',
    ground === 'dark'
      ? 'var(--sys-color-on-dark-media-subtle)'
      : 'var(--sys-color-on-light-media-subtle)',
  );
}
