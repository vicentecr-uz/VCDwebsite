/** Preload preview URLs and swap thumb → preview once ready. */

let gateOpen = false;
const candidates = new Set<HTMLImageElement>();
let observer: IntersectionObserver | null = null;

const VIEW_MARGIN_PX = 200;

function previewMatchesCurrent(preview: string, img: HTMLImageElement): boolean {
  try {
    const resolved = new URL(preview, location.href).href;
    const current = img.currentSrc || img.src;
    return resolved === current;
  } catch {
    return preview === (img.currentSrc || img.src);
  }
}

function upgradeImage(img: HTMLImageElement): void {
  const preview = img.getAttribute('data-image-preview');
  if (!preview || previewMatchesCurrent(preview, img)) {
    img.removeAttribute('data-image-preview');
    candidates.delete(img);
    return;
  }

  if (img.dataset.imagePreviewUpgrading === 'true') return;
  img.dataset.imagePreviewUpgrading = 'true';

  const hi = new Image();
  hi.onload = () => {
    img.src = preview;
    img.removeAttribute('data-image-preview');
    img.dataset.imageUpgraded = 'true';
    delete img.dataset.imagePreviewUpgrading;
    candidates.delete(img);
  };
  hi.onerror = () => {
    delete img.dataset.imagePreviewUpgrading;
  };
  hi.src = preview;
}

function isNearViewport(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const m = VIEW_MARGIN_PX;
  return rect.bottom > -m && rect.right > -m && rect.top < vh + m && rect.left < vw + m;
}

function ensureObserver(): IntersectionObserver {
  if (observer) return observer;

  observer = new IntersectionObserver(
    (entries) => {
      if (!gateOpen) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        observer!.unobserve(img);
        upgradeImage(img);
      }
    },
    { rootMargin: `${VIEW_MARGIN_PX}px` },
  );

  return observer;
}

function registerCandidate(img: HTMLImageElement): void {
  candidates.add(img);
  ensureObserver().observe(img);
  if (gateOpen && isNearViewport(img)) {
    observer!.unobserve(img);
    upgradeImage(img);
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
    if (isNearViewport(img)) {
      observer?.unobserve(img);
      upgradeImage(img);
    }
  }
}
