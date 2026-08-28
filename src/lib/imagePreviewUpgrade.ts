/** Preload preview URLs and swap thumb → preview once ready. */

let gateOpen = false;
const candidates = new Set<HTMLImageElement>();
const thumbPreloaded = new WeakSet<HTMLImageElement>();
const previewLoaded = new WeakMap<HTMLImageElement, string>();

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
  swapObserver?.unobserve(img);
}

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function decodeImage(img: HTMLImageElement, expectedSrc?: string): Promise<void> {
  const ready = () =>
    img.complete &&
    img.naturalWidth > 0 &&
    (!expectedSrc || previewMatchesCurrent(expectedSrc, img));

  if (!ready()) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      if (ready()) done();
    });
  }
  if (typeof img.decode === 'function' && img.naturalWidth > 0) {
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
      new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
    ]);
    await afterNextPaint();
    clone.remove();
  }
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
  thumb.src = img.getAttribute('src') || img.currentSrc || img.src;
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
  hi.onload = () => {
    void decodeImage(hi).then(() => {
      previewLoaded.set(img, preview);
      delete img.dataset.imagePreviewUpgrading;
      trySwap(img);
    });
  };
  hi.onerror = () => {
    delete img.dataset.imagePreviewUpgrading;
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

  img.addEventListener('transitionend', onEnd);
  window.setTimeout(done, REVEAL_DURATION_MS + 100);

  img.classList.add('image-preview-reveal--fade-only');
  freezeInFlowBox(img);
  img.src = preview;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      img.classList.add('is-revealing');
    });
  });
}

function revealWithClone(img: HTMLImageElement, preview: string): void {
  const clone = img.cloneNode(false) as HTMLImageElement;
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

  clone.addEventListener('transitionend', onEnd);
  window.setTimeout(() => {
    if (clone.isConnected) done();
  }, REVEAL_DURATION_MS + 100);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
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
      startPreviewFetch(img);
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
      if (!gateOpen) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        trySwap(entry.target as HTMLImageElement);
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

export function bindImagePreviewUpgrade(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>('img[data-image-preview]').forEach((img) => {
    if (img.dataset.imagePreviewBound === 'true') return;

    const preview = img.getAttribute('data-image-preview');
    if (!preview || previewMatchesCurrent(preview, img)) {
      img.removeAttribute('data-image-preview');
      return;
    }

    img.dataset.imagePreviewBound = 'true';
    registerCandidate(img);
  });
}

export function openImagePreviewUpgrade(): void {
  if (gateOpen) return;
  gateOpen = true;

  for (const img of [...candidates]) {
    if (!img.isConnected || !img.hasAttribute('data-image-preview')) {
      candidates.delete(img);
      continue;
    }
    trySwap(img);
  }
}
