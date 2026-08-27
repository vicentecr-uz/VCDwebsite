/**
 * Binds runtime media-ground sampling to gallery cards (Home / Work / Play).
 */

import {
  applyMediaGround,
  cropFrameRegionToSourceRegion,
  groundForRegion,
  lumaGridFor,
  unionFrameRegions,
  type MediaGround,
  type NormalizedRegion,
} from './adaptiveMediaInk';
import { coverBoxRegionToSourceRegion } from './coverLuminance';

function elementRegionInCover(el: HTMLElement, coverRect: DOMRect): NormalizedRegion | null {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height || !coverRect.width || !coverRect.height) return null;
  return {
    x: (rect.left - coverRect.left) / coverRect.width,
    y: (rect.top - coverRect.top) / coverRect.height,
    w: rect.width / coverRect.width,
    h: rect.height / coverRect.height,
  };
}

function sampleRegionForItem(item: HTMLElement, cover: HTMLElement): NormalizedRegion | null {
  const coverRect = cover.getBoundingClientRect();
  if (!coverRect.width || !coverRect.height) return null;

  const regions: NormalizedRegion[] = [];
  const meta = cover.querySelector<HTMLElement>('.project-grid__meta');
  if (meta) {
    const metaRegion = elementRegionInCover(meta, coverRect);
    if (metaRegion) regions.push(metaRegion);
  }

  item.querySelectorAll<HTMLElement>('.project-grid__chips').forEach((chipRail) => {
    const chipRegion = elementRegionInCover(chipRail, coverRect);
    if (chipRegion) regions.push(chipRegion);
  });

  if (!regions.length) return null;
  return unionFrameRegions(regions);
}

function isPlaceholderSrc(src: string | undefined, cover: HTMLElement): boolean {
  if (!src) return true;
  if (cover.dataset.devCoverEmpty === 'true') return true;
  return src.includes('black-token');
}

function fallbackFromDataAttrs(item: HTMLElement, hover: boolean): MediaGround {
  if (hover) {
    const hoverDark = item.dataset.devHoverDark;
    if (hoverDark === 'true') return 'dark';
    if (hoverDark === 'false') return 'light';
  }
  return item.dataset.devDark === 'true' ? 'dark' : 'light';
}

function cropHostFor(cover: HTMLElement): HTMLElement | null {
  if (cover.classList.contains('project-cropped') || cover.classList.contains('project-responsive-image')) {
    return cover;
  }
  return cover.closest<HTMLElement>('.project-cropped, .project-responsive-image');
}

function readCropVars(host: HTMLElement, hover: boolean): { w: number; cx: number; cy: number } | null {
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

function bindItem(item: HTMLElement): { cleanup: () => void; refresh: () => void } {
  let generation = 0;

  const refreshItem = async () => {
    const gen = ++generation;
    try {
      const cover = item.querySelector<HTMLElement>('.project-grid__cover');
      if (!cover) return;

      const baseImg = cover.querySelector<HTMLImageElement>('.project-grid__img--base');
      const hoverImg = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
      const hoverForced =
        cover.classList.contains('is-dev-hover-forced') && Boolean(hoverImg?.src);
      const imgEl = hoverForced && hoverImg ? hoverImg : baseImg;
      const src = imgEl?.currentSrc || imgEl?.src;

      if (!src || isPlaceholderSrc(src, cover)) {
        if (gen === generation) applyMediaGround(item, fallbackFromDataAttrs(item, hoverForced));
        return;
      }

      const decoded = await lumaGridFor(src);
      if (gen !== generation) return;
      if (!decoded) {
        applyMediaGround(item, fallbackFromDataAttrs(item, hoverForced));
        return;
      }

      const region = sampleRegionForItem(item, cover);
      if (!region) {
        applyMediaGround(item, fallbackFromDataAttrs(item, hoverForced));
        return;
      }

      const coverRect = cover.getBoundingClientRect();
      const naturalWidth = Number((decoded as HTMLImageElement).naturalWidth) || 0;
      const naturalHeight = Number((decoded as HTMLImageElement).naturalHeight) || 0;
      const frame = { width: coverRect.width, height: coverRect.height };
      const source = { width: naturalWidth, height: naturalHeight };

      const cropHost = cropHostFor(cover);
      const crop = cropHost ? readCropVars(cropHost, hoverForced) : null;
      const sourceRegion = crop
        ? cropFrameRegionToSourceRegion(region, frame, source, crop)
        : coverBoxRegionToSourceRegion(region, frame, source);

      if (gen === generation) {
        applyMediaGround(item, groundForRegion(decoded, sourceRegion));
      }
    } catch {
      if (gen === generation) {
        const cover = item.querySelector<HTMLElement>('.project-grid__cover');
        const hoverForced =
          cover?.classList.contains('is-dev-hover-forced') &&
          Boolean(cover.querySelector<HTMLImageElement>('.project-grid__img--hover')?.src);
        applyMediaGround(item, fallbackFromDataAttrs(item, Boolean(hoverForced)));
      }
    }
  };

  const cover = item.querySelector<HTMLElement>('.project-grid__cover');
  if (!cover) {
    return { cleanup: () => {}, refresh: () => {} };
  }

  const resizeObserver = new ResizeObserver(() => {
    void refreshItem();
  });
  resizeObserver.observe(cover);

  const mutationObserver = new MutationObserver(() => {
    void refreshItem();
  });
  mutationObserver.observe(cover, { attributes: true, attributeFilter: ['class'] });

  const hoverImg = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
  if (hoverImg) {
    mutationObserver.observe(hoverImg, { attributes: true, attributeFilter: ['src', 'hidden'] });
  }

  void refreshItem();

  return {
    cleanup: () => {
      generation += 1;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    },
    refresh: () => {
      void refreshItem();
    },
  };
}

/** Sample cover pixels under title+chip union; set `data-media-ground` on each item. */
export function bindGalleryMediaInk(): () => void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.project-grid__item'));
  if (!items.length) return () => {};

  const bindings = items.map((item) => bindItem(item));

  const onRefresh = () => {
    bindings.forEach(({ refresh }) => refresh());
  };

  window.addEventListener('vcd:dev-pending-upsert', onRefresh);
  window.addEventListener('vcd:dev-frame-changed', onRefresh);

  return () => {
    window.removeEventListener('vcd:dev-pending-upsert', onRefresh);
    window.removeEventListener('vcd:dev-frame-changed', onRefresh);
    bindings.forEach(({ cleanup }) => cleanup());
  };
}
