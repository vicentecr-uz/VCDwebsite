/**
 * Binds runtime media-ground sampling to gallery cards (Home / Work / Play).
 * Retune light/dark flip: `HOVER_LUMA_THRESHOLD` in `coverLuminance.ts`.
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

  // Hover state comes from the events, not card.matches(':hover') inside the
  // handlers: Firefox applies/removes :hover *after* dispatching pointerenter/
  // pointerleave, so reading it mid-handler samples the pre-event bitmap and
  // the ink runs one event behind (#325). Chrome applies it before dispatch.
  let pointerHover = false;
  let focusVisible = false;
  let metaPinnedToHover = false;

  const liveHoverBitmap = (hoverImg: HTMLImageElement | null): boolean => {
    if (document.documentElement.classList.contains('is-dev-mode')) return false;
    if (!hoverImg?.src || hoverImg.hidden) return false;
    // Same gates as ProjectGrid.astro hover overlay (#132): CSS only fades the
    // hover bitmap in under (hover:hover)+(pointer:fine), or :focus-visible.
    // iOS sticky :hover must not sample hoverDark / the hover image while the
    // cover is still what's painted.
    if (focusVisible) return true;
    if (cover?.classList.contains('is-mobile-preview')) {
      return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }
    if (!pointerHover) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  };

  const refreshItem = async () => {
    const gen = ++generation;
    try {
      const cover = item.querySelector<HTMLElement>('.project-grid__cover');
      if (!cover) return;

      const baseImg = cover.querySelector<HTMLImageElement>('.project-grid__img--base');
      const hoverImg = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
      const hoverForced =
        cover.classList.contains('is-dev-hover-forced') && Boolean(hoverImg?.src);
      const hover = hoverForced || liveHoverBitmap(hoverImg);

      const meta = cover.querySelector<HTMLElement>('.project-grid__meta');
      const chips = [...item.querySelectorAll<HTMLElement>('.project-grid__chip')];

      if (document.documentElement.classList.contains('is-dev-mode')) {
        // Pointer hover never swaps bitmaps in Edit. Hidden meta still belongs
        // to the visible base image; only the forced-hover control overrides it.
        metaPinnedToHover = false;
      } else if (!hover && meta) {
        // Pin only on a *settled* opacity: pointerleave fires while the 0.3s
        // meta fade-out is still running, and a mid-fade value must not clear
        // the pin — that would swap the colour during the fade-out (#325 T3).
        const restOpacity = parseFloat(getComputedStyle(meta).opacity);
        if (restOpacity === 0 || restOpacity === 1) {
          const hoverSrc = hoverImg?.currentSrc || hoverImg?.src;
          metaPinnedToHover =
            restOpacity === 0 &&
            Boolean(hoverSrc) &&
            !isPlaceholderSrc(hoverSrc, cover);
        }
      }

      const metaUsesHoverBitmap = metaPinnedToHover || hover;

      const chipImgEl = hover && hoverImg ? hoverImg : baseImg;
      const chipSrc = chipImgEl?.currentSrc || chipImgEl?.src;
      const chipFallback = fallbackFromDataAttrs(item, hover);

      const metaImgEl = metaUsesHoverBitmap && hoverImg ? hoverImg : baseImg;
      const metaSrc = metaImgEl?.currentSrc || metaImgEl?.src;
      const metaFallback = fallbackFromDataAttrs(item, metaUsesHoverBitmap);

      const chipPlaceholder = !chipSrc || isPlaceholderSrc(chipSrc, cover);
      const metaPlaceholder = !metaSrc || isPlaceholderSrc(metaSrc, cover);

      if (chipPlaceholder && metaPlaceholder) {
        if (gen === generation) {
          applyMediaGround(item, metaFallback);
          if (meta) applyMediaGround(meta, metaFallback);
          for (const chip of chips) {
            applyMediaGround(chip, chipFallback);
          }
        }
        return;
      }

      const [chipDecoded, metaDecoded] = await Promise.all([
        chipPlaceholder ? null : lumaGridFor(chipSrc),
        metaPlaceholder ? null : lumaGridFor(metaSrc),
      ]);
      if (gen !== generation) return;

      const coverRect = cover.getBoundingClientRect();
      const cropHost = cropHostFor(cover);
      const cropFor = (usesHoverBitmap: boolean) => (
        cropHost && (!usesHoverBitmap || cover.classList.contains('project-grid__cover--hover-cropped'))
          ? readCropVars(cropHost, usesHoverBitmap)
          : null
      );
      const chipCrop = cropFor(hover);
      const metaCrop = cropFor(metaUsesHoverBitmap);
      const background = item.dataset.devBg || getComputedStyle(cover).backgroundColor;

      let metaGround = metaFallback;
      if (!metaPlaceholder && metaDecoded) {
        const naturalWidth = Number((metaDecoded as HTMLImageElement).naturalWidth) || 0;
        const naturalHeight = Number((metaDecoded as HTMLImageElement).naturalHeight) || 0;
        const frame = { width: coverRect.width, height: coverRect.height };
        const source = { width: naturalWidth, height: naturalHeight };
        metaGround = meta
          ? (groundForBox(meta, cover, metaDecoded, frame, source, metaCrop, background) ?? metaFallback)
          : metaFallback;
      }

      if (gen === generation) {
        applyMediaGround(item, metaGround);
        if (meta) applyMediaGround(meta, metaGround);

        if (chipPlaceholder || !chipDecoded) {
          for (const chip of chips) {
            applyMediaGround(chip, chipFallback);
          }
        } else {
          const naturalWidth = Number((chipDecoded as HTMLImageElement).naturalWidth) || 0;
          const naturalHeight = Number((chipDecoded as HTMLImageElement).naturalHeight) || 0;
          const frame = { width: coverRect.width, height: coverRect.height };
          const source = { width: naturalWidth, height: naturalHeight };
          for (const chip of chips) {
            applyMediaGround(
              chip,
              groundForBox(chip, cover, chipDecoded, frame, source, chipCrop, background) ?? metaGround,
            );
          }
        }
      }
    } catch {
      if (gen === generation) {
        const cover = item.querySelector<HTMLElement>('.project-grid__cover');
        if (!cover) return;
        const hoverImg = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
        const hoverForced =
          Boolean(cover.classList.contains('is-dev-hover-forced') && hoverImg?.src);
        const hover = hoverForced || liveHoverBitmap(hoverImg ?? null);
        applyFallbackGround(item, cover, fallbackFromDataAttrs(item, metaPinnedToHover || hover));
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
  mutationObserver.observe(item, { attributes: true, attributeFilter: ['data-dev-bg'] });

  const hoverImg = cover.querySelector<HTMLImageElement>('.project-grid__img--hover');
  if (hoverImg) {
    mutationObserver.observe(hoverImg, { attributes: true, attributeFilter: ['src', 'hidden'] });
  }

  const card = item.querySelector('.project-grid__card');
  const onPointerEnter = () => {
    pointerHover = true;
    void refreshItem();
  };
  const onPointerLeave = () => {
    pointerHover = false;
    void refreshItem();
  };
  const onFocusIn = () => {
    // :focus-visible may not have applied yet at focusin — read it next frame.
    requestAnimationFrame(() => {
      focusVisible = card instanceof HTMLElement && card.matches(':focus-visible');
      void refreshItem();
    });
  };
  const onFocusOut = () => {
    focusVisible = false;
    void refreshItem();
  };
  if (card instanceof HTMLElement) {
    // Initial read is safe here — the dispatch race only exists mid-event.
    pointerHover = card.matches(':hover');
    card.addEventListener('pointerenter', onPointerEnter);
    card.addEventListener('pointerleave', onPointerLeave);
    card.addEventListener('focusin', onFocusIn);
    card.addEventListener('focusout', onFocusOut);
  }

  void refreshItem();

  return {
    cleanup: () => {
      generation += 1;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (card instanceof HTMLElement) {
        card.removeEventListener('pointerenter', onPointerEnter);
        card.removeEventListener('pointerleave', onPointerLeave);
        card.removeEventListener('focusin', onFocusIn);
        card.removeEventListener('focusout', onFocusOut);
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

  // Dev-mode toggles live on <html> (is-dev-mode, is-dev-crop-open, …) and
  // change which bitmap/ground applies without touching any cover — refresh
  // all cards or the ink stays stale until the next pointer event.
  const htmlObserver = new MutationObserver(onRefresh);
  htmlObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  window.addEventListener('vcd:dev-pending-upsert', onRefresh);
  window.addEventListener('vcd:dev-frame-changed', onRefresh);

  return () => {
    window.removeEventListener('vcd:dev-pending-upsert', onRefresh);
    window.removeEventListener('vcd:dev-frame-changed', onRefresh);
    gridObserver.disconnect();
    htmlObserver.disconnect();
    bindings.forEach(({ cleanup }) => cleanup());
    bindings.clear();
  };
}
