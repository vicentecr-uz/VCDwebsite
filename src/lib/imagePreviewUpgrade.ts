/** Preload preview URLs and swap thumb → preview once ready. */
export function createImagePreviewUpgrade(options: { onError?: (image: HTMLImageElement) => void } = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  const frames = new Set<number>();
  const timers = new Set<number>();
  const preloads = new Set<HTMLImageElement>();
  const clones = new Set<HTMLImageElement>();
  const revealClones = new Map<HTMLImageElement, HTMLImageElement>();
  const bound = new Set<HTMLImageElement>();
  const nextFrame = (callback: FrameRequestCallback) => {
    const id = requestAnimationFrame((time) => {
      frames.delete(id);
      if (!signal.aborted) callback(time);
    });
    frames.add(id);
    return id;
  };
  const later = (callback: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!signal.aborted) callback();
    }, ms);
    timers.add(id);
    return id;
  };
  const current = (img: HTMLImageElement, preview: string) =>
    !signal.aborted && img.isConnected && img.getAttribute('data-image-preview') === preview;
  let gateOpen = false;
  const candidates = new Set<HTMLImageElement>();
  const thumbPreloaded = new WeakSet<HTMLImageElement>();
  const thumbReady = new WeakSet<HTMLImageElement>();
  const previewLoaded = new WeakMap<HTMLImageElement, string>();
  const previewQueue = new Set<HTMLImageElement>();
  let previewQueueScheduled = false;

  let swapObserver: IntersectionObserver | null = null;

  const SWAP_MARGIN_PX = 200;
  const REVEAL_DURATION_MS = 500;

  function previewMatchesCurrent(preview: string, img: HTMLImageElement): boolean {
    try {
      const resolved = new URL(preview, location.href).href;
      const current = img.currentSrc || img.src;
      return resolved === current;
    } catch {
      return preview === (img.currentSrc || img.src);
    }
  }

  function isAboutPhoto(img: HTMLImageElement): boolean {
    return img.classList.contains('area-photo');
  }

  function cleanupCandidate(img: HTMLImageElement): void {
    img.removeAttribute('data-image-preview');
    delete img.dataset.imagePreviewUpgrading;
    delete img.dataset.imagePreviewRevealing;
    candidates.delete(img);
    previewQueue.delete(img);
    swapObserver?.unobserve(img);
  }

  function cancel(img: HTMLImageElement): void {
    cleanupCandidate(img);
    previewLoaded.delete(img);
    const clone = revealClones.get(img);
    if (clone) {
      clone.remove();
      clones.delete(clone);
      revealClones.delete(img);
    }
    img.classList.remove('image-preview-reveal--fade-only', 'is-revealing');
  }

  function afterNextPaint(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      if (signal.aborted) return done();
      signal.addEventListener('abort', done, { once: true });
      nextFrame(() => {
        nextFrame(done);
      });
    });
  }

  async function decodeImage(img: HTMLImageElement, expectedSrc?: string): Promise<void> {
    if (signal.aborted) return;
    const ready = () =>
      img.complete &&
      img.naturalWidth > 0 &&
      (!expectedSrc || previewMatchesCurrent(expectedSrc, img));

    if (!ready()) {
      await new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        signal.addEventListener('abort', done, { once: true });
        if (ready()) done();
      });
    }
    if (!signal.aborted && typeof img.decode === 'function' && img.naturalWidth > 0) {
      try {
        await img.decode();
      } catch {
        /* broken / unsupported */
      }
    }
  }

  function freezeInFlowBox(img: HTMLImageElement): void {
    const cs = getComputedStyle(img);
    if (cs.position === 'absolute' || cs.position === 'fixed') return;
    const width = img.offsetWidth;
    const height = img.offsetHeight;
    if (!width || !height) return;
    // WebKit zeros intrinsic size on `src` change. The wipe clone is position:absolute
    // so it cannot hold document flow — without this, in-flow thumbs collapse and
    // the page jumps until the preview decodes (random: cache vs decode timing).
    img.style.aspectRatio = `${width} / ${height}`;
    if (!img.getAttribute('width') || !img.getAttribute('height')) {
      img.setAttribute('width', String(Math.round(width)));
      img.setAttribute('height', String(Math.round(height)));
    }
  }

  async function finishUpgrade(
    img: HTMLImageElement,
    preview: string,
    clone?: HTMLImageElement,
  ): Promise<void> {
    if (!current(img, preview)) {
      clone?.remove();
      if (clone) clones.delete(clone);
      if (revealClones.get(img) === clone) revealClones.delete(img);
      return;
    }
    freezeInFlowBox(img);
    img.src = preview;
    img.removeAttribute('data-image-preview');
    img.dataset.imageUpgraded = 'true';
    delete img.dataset.imagePreviewUpgrading;
    candidates.delete(img);
    swapObserver?.unobserve(img);

    // WebKit (Edge iOS / Safari) blanks the bitmap the moment `src` changes,
    // even when the preview is already in cache from the preload Image().
    // Hold the wipe clone until this element has decoded and painted, or the
    // thumb disappears for a frame after the reveal finishes.
    if (clone) {
      await Promise.race([
        decodeImage(img, preview),
        new Promise<void>((resolve) => later(resolve, 2000)),
      ]);
      await afterNextPaint();
      clone.remove();
      clones.delete(clone);
      if (revealClones.get(img) === clone) revealClones.delete(img);
    }
    if (signal.aborted) return;
    delete img.dataset.imagePreviewRevealing;
  }

  function isIntersectingWithMargin(img: HTMLImageElement, marginPx: number): boolean {
    const rect = img.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    return (
      rect.bottom > -marginPx &&
      rect.right > -marginPx &&
      rect.top < vh + marginPx &&
      rect.left < vw + marginPx
    );
  }

  function preloadThumb(img: HTMLImageElement): void {
    if (thumbPreloaded.has(img)) return;
    thumbPreloaded.add(img);
    const thumb = new Image();
    preloads.add(thumb);
    thumb.onload = () => {
      thumb.onload = thumb.onerror = null;
      void decodeImage(thumb).then(() => {
        preloads.delete(thumb);
        if (signal.aborted) return;
        thumbReady.add(img);
        queuePreviewFetch(img);
      });
    };
    thumb.onerror = () => {
      thumb.onload = thumb.onerror = null;
      preloads.delete(thumb);
    };
    thumb.src = img.getAttribute('src') || img.currentSrc || img.src;
  }

  function flushPreviewQueue(): void {
    previewQueueScheduled = false;
    if (signal.aborted) return;

    const ready = [...previewQueue]
      .filter((img) => {
        if (!img.isConnected || !img.hasAttribute('data-image-preview')) {
          previewQueue.delete(img);
          return false;
        }
        if (!isIntersectingWithMargin(img, SWAP_MARGIN_PX)) {
          previewQueue.delete(img);
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.top - bRect.top || aRect.left - bRect.left;
      });

    for (const img of ready) {
      previewQueue.delete(img);
      startPreviewFetch(img);
    }
  }

  function queuePreviewFetch(img: HTMLImageElement): void {
    if (signal.aborted || !thumbReady.has(img) || !isIntersectingWithMargin(img, SWAP_MARGIN_PX)) return;
    previewQueue.add(img);
    if (previewQueueScheduled) return;
    previewQueueScheduled = true;
    queueMicrotask(flushPreviewQueue);
  }

  function startPreviewFetch(img: HTMLImageElement): void {
    const preview = img.getAttribute('data-image-preview');
    if (!preview || previewMatchesCurrent(preview, img)) {
      cleanupCandidate(img);
      return;
    }

    if (previewLoaded.get(img) === preview) {
      trySwap(img);
      return;
    }

    if (img.dataset.imagePreviewUpgrading === 'true') return;
    img.dataset.imagePreviewUpgrading = 'true';

    const hi = new Image();
    preloads.add(hi);
    hi.onload = () => {
      hi.onload = hi.onerror = null;
      void decodeImage(hi).then(() => {
        preloads.delete(hi);
        if (!current(img, preview)) return;
        previewLoaded.set(img, preview);
        delete img.dataset.imagePreviewUpgrading;
        trySwap(img);
      });
    };
    hi.onerror = () => {
      hi.onload = hi.onerror = null;
      preloads.delete(hi);
      if (!current(img, preview)) return;
      delete img.dataset.imagePreviewUpgrading;
      options.onError?.(img);
    };
    hi.src = preview;
  }

  function pinCloneToThumb(thumb: HTMLImageElement, clone: HTMLImageElement): void {
    const position = getComputedStyle(thumb).position;
    if (position === 'absolute' || position === 'fixed') return;
    const cs = getComputedStyle(thumb);
    clone.style.position = 'absolute';
    clone.style.left = `${thumb.offsetLeft}px`;
    clone.style.top = `${thumb.offsetTop}px`;
    clone.style.width = `${thumb.offsetWidth}px`;
    clone.style.height = `${thumb.offsetHeight}px`;
    clone.style.margin = '0';
    clone.style.maxWidth = 'none';
    clone.style.objectFit = cs.objectFit;
    clone.style.objectPosition = cs.objectPosition;
  }

  function revealAboutFade(img: HTMLImageElement, preview: string): void {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      img.removeEventListener('transitionend', onEnd);
      img.classList.remove('image-preview-reveal--fade-only', 'is-revealing');
      void finishUpgrade(img, preview);
    };

    const onEnd = (event: TransitionEvent) => {
      if (event.target !== img || event.propertyName !== 'opacity') return;
      done();
    };

    img.addEventListener('transitionend', onEnd, { signal });
    later(done, REVEAL_DURATION_MS + 100);

    img.classList.add('image-preview-reveal--fade-only');
    freezeInFlowBox(img);
    img.src = preview;
    nextFrame(() => {
      nextFrame(() => {
        img.classList.add('is-revealing');
      });
    });
  }

  function revealWithClone(img: HTMLImageElement, preview: string): void {
    const clone = img.cloneNode(false) as HTMLImageElement;
    clones.add(clone);
    revealClones.set(img, clone);
    clone.className = img.className;
    clone.removeAttribute('data-image-preview');
    clone.removeAttribute('data-image-preview-bound');
    clone.setAttribute('data-preview-reveal', '');
    clone.alt = '';
    clone.setAttribute('aria-hidden', 'true');
    clone.src = preview;

    for (const attr of ['sizes', 'srcset', 'width', 'height', 'decoding'] as const) {
      const value = img.getAttribute(attr);
      if (value) clone.setAttribute(attr, value);
    }

    img.insertAdjacentElement('afterend', clone);
    pinCloneToThumb(img, clone);

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clone.removeEventListener('transitionend', onEnd);
      void finishUpgrade(img, preview, clone);
    };

    const onEnd = (event: TransitionEvent) => {
      if (event.target !== clone) return;
      if (event.propertyName !== 'opacity' && !event.propertyName.includes('mask')) return;
      done();
    };

    clone.addEventListener('transitionend', onEnd, { signal });
    later(() => {
      if (clone.isConnected) done();
    }, REVEAL_DURATION_MS + 100);

    nextFrame(() => {
      nextFrame(() => {
        clone.classList.add('is-revealing');
      });
    });
  }

  function performReveal(img: HTMLImageElement): void {
    const preview = img.getAttribute('data-image-preview');
    if (!preview || previewMatchesCurrent(preview, img)) {
      cleanupCandidate(img);
      return;
    }

    if (img.dataset.imagePreviewRevealing === 'true') return;
    img.dataset.imagePreviewRevealing = 'true';

    swapObserver?.unobserve(img);

    if (isAboutPhoto(img)) {
      revealAboutFade(img, preview);
      return;
    }

    revealWithClone(img, preview);
  }

  function trySwap(img: HTMLImageElement): void {
    if (!gateOpen) return;

    const preview = img.getAttribute('data-image-preview');
    if (!preview || previewMatchesCurrent(preview, img)) {
      cleanupCandidate(img);
      return;
    }

    if (previewLoaded.get(img) !== preview) {
      if (img.dataset.imagePreviewUpgrading !== 'true' && isIntersectingWithMargin(img, SWAP_MARGIN_PX)) {
        queuePreviewFetch(img);
      }
      return;
    }

    if (!isIntersectingWithMargin(img, SWAP_MARGIN_PX)) return;

    performReveal(img);
  }

  function ensureSwapObserver(): IntersectionObserver {
    if (swapObserver) return swapObserver;

    swapObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target as HTMLImageElement;
          queuePreviewFetch(img);
          if (gateOpen) trySwap(img);
        }
      },
      { rootMargin: `${SWAP_MARGIN_PX}px` },
    );

    return swapObserver;
  }

  function registerCandidate(img: HTMLImageElement): void {
    candidates.add(img);
    preloadThumb(img);
    ensureSwapObserver().observe(img);

    if (gateOpen) {
      trySwap(img);
    }
  }

  function bind(root: ParentNode = document): void {
    if (signal.aborted) return;
    root.querySelectorAll<HTMLImageElement>('img[data-image-preview]').forEach((img) => {
      if (img.dataset.imagePreviewBound === 'true') return;

      const preview = img.getAttribute('data-image-preview');
      if (!preview || previewMatchesCurrent(preview, img)) {
        img.removeAttribute('data-image-preview');
        return;
      }

      img.dataset.imagePreviewBound = 'true';
      bound.add(img);
      registerCandidate(img);
    });
  }

  function open(): void {
    if (signal.aborted || gateOpen) return;
    gateOpen = true;

    for (const img of [...candidates]) {
      if (!img.isConnected || !img.hasAttribute('data-image-preview')) {
        candidates.delete(img);
        continue;
      }
      trySwap(img);
    }
  }

  return {
    bind,
    open,
    cancel,
    destroy() {
      controller.abort();
      frames.forEach(cancelAnimationFrame);
      timers.forEach((id) => window.clearTimeout(id));
      frames.clear();
      timers.clear();
      swapObserver?.disconnect();
      swapObserver = null;
      for (const image of preloads) {
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }
      preloads.clear();
      clones.forEach((clone) => clone.remove());
      clones.clear();
      revealClones.clear();
      previewQueue.clear();
      for (const image of bound) {
        delete image.dataset.imagePreviewBound;
        delete image.dataset.imagePreviewUpgrading;
        delete image.dataset.imagePreviewRevealing;
        image.classList.remove('image-preview-reveal--fade-only', 'is-revealing');
      }
      bound.clear();
      candidates.clear();
    },
  };
}

const pageUpgrade = createImagePreviewUpgrade();
export const bindImagePreviewUpgrade = pageUpgrade.bind;
export const openImagePreviewUpgrade = pageUpgrade.open;

export const cancelImagePreviewUpgrade = pageUpgrade.cancel;
