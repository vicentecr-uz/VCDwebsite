/**
 * Binds runtime media-ground sampling to overlay project captions.
 */

import {
  applyMediaGround,
  cropHostFor,
  groundForBox,
  lumaGridFor,
  readCropVars,
  type MediaGround,
} from './adaptiveMediaInk';

function isBelow(caption: HTMLElement): boolean {
  return (
    caption.classList.contains('project-caption--below') ||
    caption.dataset.captionStyle === 'below'
  );
}

function clearMediaGround(caption: HTMLElement): void {
  delete caption.dataset.mediaGround;
  caption.style.removeProperty('--media-ink');
  caption.style.removeProperty('--media-ink-subtle');
}

function fallback(caption: HTMLElement): MediaGround {
  return caption.dataset.captionStyle === 'black' ? 'light' : 'dark';
}

function coverFor(caption: HTMLElement): HTMLElement | null {
  const frame = caption.closest<HTMLElement>('.project-image-grid__frame');
  if (frame) return frame;

  const media = caption.closest<HTMLElement>('.project-media, .project-image');
  if (!media) return null;

  const clip = media.querySelector<HTMLElement>(':scope > .project-crop-clip');
  return clip ?? media;
}

function imgIn(cover: HTMLElement): HTMLImageElement | null {
  return (
    cover.querySelector<HTMLImageElement>(
      '.project-image-grid__image, .project-media__img, .project-image__img',
    ) ?? null
  );
}

function isPlaceholderSrc(src: string | undefined, cover: HTMLElement): boolean {
  if (!src) return true;
  if (cover.dataset.devCoverEmpty === 'true') return true;
  return src.includes('black-token');
}

function bindCaption(caption: HTMLElement): { cleanup: () => void; refresh: () => void } {
  let generation = 0;

  const refreshCaption = async () => {
    const gen = ++generation;

    if (isBelow(caption)) {
      clearMediaGround(caption);
      return;
    }

    const cover = coverFor(caption);
    const img = cover ? imgIn(cover) : null;

    if (!cover || !img || !caption.getBoundingClientRect().width) {
      if (gen === generation) applyMediaGround(caption, fallback(caption));
      return;
    }

    const src = img.currentSrc || img.src;
    if (isPlaceholderSrc(src, cover)) {
      if (gen === generation) applyMediaGround(caption, fallback(caption));
      return;
    }

    const decoded = await lumaGridFor(src);
    if (gen !== generation) return;
    if (!decoded) {
      applyMediaGround(caption, fallback(caption));
      return;
    }

    const coverRect = cover.getBoundingClientRect();
    const naturalWidth = Number((decoded as HTMLImageElement).naturalWidth) || 0;
    const naturalHeight = Number((decoded as HTMLImageElement).naturalHeight) || 0;
    const frame = { width: coverRect.width, height: coverRect.height };
    const source = { width: naturalWidth, height: naturalHeight };
    const crop = readCropVars(cropHostFor(cover) ?? cover, false);

    const ground =
      groundForBox(caption, cover, decoded, frame, source, crop) ?? fallback(caption);

    if (gen === generation) {
      applyMediaGround(caption, ground);
    }
  };

  const cover = coverFor(caption);
  const resizeObserver = cover
    ? new ResizeObserver(() => {
        void refreshCaption();
      })
    : null;
  if (cover && resizeObserver) {
    resizeObserver.observe(cover);
  }

  const captionObserver = new MutationObserver(() => {
    void refreshCaption();
  });
  captionObserver.observe(caption, {
    attributes: true,
    attributeFilter: ['class', 'data-caption-style', 'data-caption-position'],
  });

  const img = cover ? imgIn(cover) : null;
  const imgObserver = img
    ? new MutationObserver(() => {
        void refreshCaption();
      })
    : null;
  if (img && imgObserver) {
    imgObserver.observe(img, { attributes: true, attributeFilter: ['src'] });
  }

  void refreshCaption();

  return {
    cleanup: () => {
      generation += 1;
      resizeObserver?.disconnect();
      captionObserver.disconnect();
      imgObserver?.disconnect();
    },
    refresh: () => {
      void refreshCaption();
    },
  };
}

/** Sample cover pixels under each overlay caption; set `data-media-ground` per caption. */
export function bindCaptionMediaInk(): () => void {
  const bindings = new Map<HTMLElement, { cleanup: () => void; refresh: () => void }>();

  const bindMissing = () => {
    document.querySelectorAll<HTMLElement>('.project-caption').forEach((caption) => {
      if (isBelow(caption)) return;
      if (bindings.has(caption)) return;
      bindings.set(caption, bindCaption(caption));
    });
  };

  const unbindStale = () => {
    for (const [caption, binding] of bindings) {
      if (caption.isConnected) continue;
      binding.cleanup();
      bindings.delete(caption);
    }
  };

  bindMissing();

  const onRefresh = () => {
    unbindStale();
    bindMissing();
    bindings.forEach(({ refresh }) => refresh());
  };

  const bodyObserver = new MutationObserver(onRefresh);
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('vcd:dev-pending-upsert', onRefresh);
  window.addEventListener('vcd:dev-frame-changed', onRefresh);

  return () => {
    window.removeEventListener('vcd:dev-pending-upsert', onRefresh);
    window.removeEventListener('vcd:dev-frame-changed', onRefresh);
    bodyObserver.disconnect();
    bindings.forEach(({ cleanup }) => cleanup());
    bindings.clear();
  };
}
