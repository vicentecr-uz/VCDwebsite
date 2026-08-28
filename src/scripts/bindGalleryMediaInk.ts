/**
 * Binds runtime media-ground sampling to gallery cards (Home / Work / Play).
 */

import {
  applyMediaGround,
  cropHostFor,
  groundForBox,
  lumaGridFor,
  readCropVars,
  type MediaGround,
} from './adaptiveMediaInk';

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

function isLiveHoverBitmap(item: HTMLElement, hoverImg: HTMLImageElement | null): boolean {
  if (document.documentElement.classList.contains('is-dev-mode')) return false;
  if (!hoverImg?.src || hoverImg.hidden) return false;
  const card = item.querySelector('.project-grid__card');
  if (!(card instanceof HTMLElement)) return false;
  // Same gates as ProjectGrid.astro hover overlay (#132): CSS only fades the
  // hover bitmap in under (hover:hover)+(pointer:fine), or :focus-visible.
  // iOS sticky :hover must not sample hoverDark / the hover image while the
  // cover is still what's painted.
  if (card.matches(':focus-visible')) return true;
  if (!card.matches(':hover')) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function inkTargets(item: HTMLElement, cover: HTMLElement): HTMLElement[] {
  const meta = cover.querySelector<HTMLElement>('.project-grid__meta');
  const chips = [...item.querySelectorAll<HTMLElement>('.project-grid__chip')];
  return [meta, ...chips].filter((el): el is HTMLElement => el instanceof HTMLElement);
}

function applyFallbackGround(
  item: HTMLElement,
  cover: HTMLElement,
  ground: MediaGround,
): void {
  applyMediaGround(item, ground);
  inkTargets(item, cover).forEach((el) => applyMediaGround(el, ground));
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
      const hover = hoverForced || isLiveHoverBitmap(item, hoverImg);
      const imgEl = hover && hoverImg ? hoverImg : baseImg;
      const src = imgEl?.currentSrc || imgEl?.src;

      const meta = cover.querySelector<HTMLElement>('.project-grid__meta');
      const chips = [...item.querySelectorAll<HTMLElement>('.project-grid__chip')];
      const fallback = fallbackFromDataAttrs(item, hover);

      if (!src || isPlaceholderSrc(src, cover)) {
        if (gen === generation) applyFallbackGround(item, cover, fallback);
        return;
      }

      const decoded = await lumaGridFor(src);
      if (gen !== generation) return;
      if (!decoded) {
        applyFallbackGround(item, cover, fallback);
        return;
      }

      const coverRect = cover.getBoundingClientRect();
      const naturalWidth = Number((decoded as HTMLImageElement).naturalWidth) || 0;
      const naturalHeight = Number((decoded as HTMLImageElement).naturalHeight) || 0;
      const frame = { width: coverRect.width, height: coverRect.height };
      const source = { width: naturalWidth, height: naturalHeight };

      const cropHost = cropHostFor(cover);
      const crop = cropHost ? readCropVars(cropHost, hover) : null;

      const metaGround = meta
        ? (groundForBox(meta, cover, decoded, frame, source, crop) ?? fallback)
        : fallback;

      if (gen === generation) {
        applyMediaGround(item, metaGround);
        if (meta) applyMediaGround(meta, metaGround);
        for (const chip of chips) {
          applyMediaGround(chip, groundForBox(chip, cover, decoded, frame, source, crop) ?? metaGround);
        }
      }
    } catch {
      if (gen === generation) {
        const cover = item.querySelector<HTMLElement>('.project-grid__cover');
        if (!cover) return;
        const hoverImg = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
        const hoverForced =
          Boolean(cover.classList.contains('is-dev-hover-forced') && hoverImg?.src);
        const hover = hoverForced || isLiveHoverBitmap(item, hoverImg ?? null);
        applyFallbackGround(item, cover, fallbackFromDataAttrs(item, hover));
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

  const card = item.querySelector('.project-grid__card');
  const onCardHoverChange = () => {
    void refreshItem();
  };
  if (card instanceof HTMLElement) {
    card.addEventListener('pointerenter', onCardHoverChange);
    card.addEventListener('pointerleave', onCardHoverChange);
    card.addEventListener('focusin', onCardHoverChange);
    card.addEventListener('focusout', onCardHoverChange);
  }

  void refreshItem();

  return {
    cleanup: () => {
      generation += 1;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (card instanceof HTMLElement) {
        card.removeEventListener('pointerenter', onCardHoverChange);
        card.removeEventListener('pointerleave', onCardHoverChange);
        card.removeEventListener('focusin', onCardHoverChange);
        card.removeEventListener('focusout', onCardHoverChange);
      }
    },
    refresh: () => {
      void refreshItem();
    },
  };
}

/** Sample cover pixels under title and each chip; set `data-media-ground` per target. */
export function bindGalleryMediaInk(): () => void {
  const bindings = new Map<HTMLElement, { cleanup: () => void; refresh: () => void }>();

  const bindMissing = () => {
    document.querySelectorAll<HTMLElement>('.project-grid__item').forEach((item) => {
      if (bindings.has(item)) return;
      bindings.set(item, bindItem(item));
    });
  };

  const unbindStale = () => {
    for (const [item, binding] of bindings) {
      if (item.isConnected) continue;
      binding.cleanup();
      bindings.delete(item);
    }
  };

  bindMissing();

  const onRefresh = () => {
    unbindStale();
    bindMissing();
    bindings.forEach(({ refresh }) => refresh());
  };

  const gridObserver = new MutationObserver(onRefresh);
  document.querySelectorAll('.project-grid').forEach((grid) => {
    gridObserver.observe(grid, { childList: true });
  });

  window.addEventListener('vcd:dev-pending-upsert', onRefresh);
  window.addEventListener('vcd:dev-frame-changed', onRefresh);

  return () => {
    window.removeEventListener('vcd:dev-pending-upsert', onRefresh);
    window.removeEventListener('vcd:dev-frame-changed', onRefresh);
    gridObserver.disconnect();
    bindings.forEach(({ cleanup }) => cleanup());
    bindings.clear();
  };
}
