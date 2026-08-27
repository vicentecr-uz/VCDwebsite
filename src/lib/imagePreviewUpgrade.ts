/** Preload preview URLs and swap thumb → preview once ready. */

let gateOpen = false;
const candidates = new Set<HTMLImageElement>();
const thumbPreloaded = new WeakSet<HTMLImageElement>();
const previewLoaded = new WeakMap<HTMLImageElement, string>();

let thumbPreloadObserver: IntersectionObserver | null = null;
let fetchObserver: IntersectionObserver | null = null;
let swapObserver: IntersectionObserver | null = null;

const SWAP_MARGIN_PX = 200;
const FETCH_ROOT_MARGIN = '80% 0px';
const THUMB_PRELOAD_ROOT_MARGIN = '150% 0px';
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
  thumbPreloadObserver?.unobserve(img);
  fetchObserver?.unobserve(img);
  swapObserver?.unobserve(img);
}

function finishUpgrade(img: HTMLImageElement, preview: string, clone?: HTMLImageElement): void {
  img.src = preview;
  img.removeAttribute('data-image-preview');
  img.dataset.imageUpgraded = 'true';
  delete img.dataset.imagePreviewUpgrading;
  delete img.dataset.imagePreviewRevealing;
  candidates.delete(img);
  clone?.remove();
  thumbPreloadObserver?.unobserve(img);
  fetchObserver?.unobserve(img);
  swapObserver?.unobserve(img);
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

function isInFetchZone(img: HTMLImageElement): boolean {
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return isIntersectingWithMargin(img, vh * 0.8);
}

function preloadThumb(img: HTMLImageElement): void {
  if (thumbPreloaded.has(img)) return;
  thumbPreloaded.add(img);
  const thumb = new Image();
  thumb.src = img.currentSrc || img.src;
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
    previewLoaded.set(img, preview);
    delete img.dataset.imagePreviewUpgrading;
    trySwap(img);
  };
  hi.onerror = () => {
    delete img.dataset.imagePreviewUpgrading;
  };
  hi.src = preview;
}

function revealAboutFade(img: HTMLImageElement, preview: string): void {
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    img.removeEventListener('transitionend', onEnd);
    img.classList.remove('image-preview-reveal--fade-only', 'is-revealing');
    finishUpgrade(img, preview);
  };

  const onEnd = (event: TransitionEvent) => {
    if (event.target !== img || event.propertyName !== 'opacity') return;
    done();
  };

  img.addEventListener('transitionend', onEnd);
  window.setTimeout(done, REVEAL_DURATION_MS + 100);

  img.classList.add('image-preview-reveal--fade-only');
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

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clone.removeEventListener('transitionend', onEnd);
    finishUpgrade(img, preview, clone);
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

  fetchObserver?.unobserve(img);
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
    if (img.dataset.imagePreviewUpgrading !== 'true' && isInFetchZone(img)) {
      startPreviewFetch(img);
    }
    return;
  }

  if (!isIntersectingWithMargin(img, SWAP_MARGIN_PX)) return;

  performReveal(img);
}

function ensureThumbPreloadObserver(): IntersectionObserver {
  if (thumbPreloadObserver) return thumbPreloadObserver;

  thumbPreloadObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        thumbPreloadObserver!.unobserve(img);
        preloadThumb(img);
      }
    },
    { rootMargin: THUMB_PRELOAD_ROOT_MARGIN },
  );

  return thumbPreloadObserver;
}

function ensureFetchObserver(): IntersectionObserver {
  if (fetchObserver) return fetchObserver;

  fetchObserver = new IntersectionObserver(
    (entries) => {
      if (!gateOpen) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        startPreviewFetch(entry.target as HTMLImageElement);
      }
    },
    { rootMargin: FETCH_ROOT_MARGIN },
  );

  return fetchObserver;
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
  ensureThumbPreloadObserver().observe(img);
  ensureFetchObserver().observe(img);
  ensureSwapObserver().observe(img);

  if (gateOpen) {
    if (isInFetchZone(img)) startPreviewFetch(img);
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
    if (isInFetchZone(img)) startPreviewFetch(img);
    trySwap(img);
  }
}
