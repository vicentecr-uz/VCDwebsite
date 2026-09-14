/** Keep editor media controls on the same adaptive palette as the image below them. */
import {
  applyMediaGround,
  applyChipBrightness,
  cropHostFor,
  sampleForBox,
  applyChipContrast,
  opaqueBackground,
  lumaGridFor,
  readCropVars,
} from './adaptiveMediaInk';
import { isRegionDark, measureRegionLuma, type RenderedRegionSample } from './coverLuminance';

const CHIP_SELECTOR = '.dev-image-edit-trigger, .dev-caption-add-trigger, .dev-grid-edit-trigger';
const TARGET_SELECTOR = '.dev-image-edit-target, .dev-grid-edit-target, .dev-carousel-edit-target';
const FRAME_SELECTOR = '.project-image-grid__frame, .project-crop-clip, .project-media > img, .project-image > img';

function intersectionArea(a: DOMRect, b: DOMRect): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

/** Choose the frame under a chip, especially when a grid contains many frames. */
export function frameForChip(chip: HTMLElement, scope: HTMLElement): HTMLElement | null {
  const chipRect = chip.getBoundingClientRect();
  const candidates = [
    ...(scope.matches(FRAME_SELECTOR) ? [scope] : []),
    ...scope.querySelectorAll<HTMLElement>(FRAME_SELECTOR),
  ]
    .filter((frame) => frame.getBoundingClientRect().width > 0);
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const frame of candidates) {
    const area = intersectionArea(chipRect, frame.getBoundingClientRect());
    const moreSpecific = best && area === bestArea && best.contains(frame);
    if (area > bestArea || moreSpecific) {
      best = frame;
      bestArea = area;
    }
  }
  return best;
}

function backgroundSample(el: HTMLElement): RenderedRegionSample | null {
  const background = opaqueBackground(el.parentElement ?? el);
  if (!background) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = background;
  context.fillRect(0, 0, 1, 1);
  return {
    luma: measureRegionLuma(canvas, { x: 0, y: 0, w: 1, h: 1 }),
    pixels: context.getImageData(0, 0, 1, 1).data,
  };
}

function applySample(chip: HTMLElement, sample: RenderedRegionSample | null): void {
  const luma = sample?.luma ?? null;
  applyMediaGround(chip, luma === null || !isRegionDark(luma) ? 'light' : 'dark');
  applyChipBrightness(chip, luma);
  applyChipContrast(chip, sample);
}

function scopeForChip(chip: HTMLElement): HTMLElement | null {
  return chip.closest<HTMLElement>(TARGET_SELECTOR);
}

function imageIn(frame: HTMLElement): HTMLImageElement | null {
  return frame.matches('img')
    ? frame as HTMLImageElement
    : frame.querySelector<HTMLImageElement>(
      '.project-image-grid__image, .project-media__img, .project-image__img, img',
    );
}

function clearChip(chip: HTMLElement): void {
  delete chip.dataset.mediaGround;
  chip.style.removeProperty('--media-ink');
  chip.style.removeProperty('--media-ink-subtle');
  chip.style.removeProperty('--chip-rest-brightness');
  chip.style.removeProperty('--chip-hover-brightness');
  chip.style.removeProperty('--chip-hover-ring');
  chip.style.removeProperty('--chip-contrast-fill');
}

function visible(chip: HTMLElement): boolean {
  if (chip.hidden) return false;
  const rect = chip.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  return rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < viewportHeight;
}

export function bindEditorChipMediaInk(): () => void {
  let generation = 0;
  let frameHandle = 0;
  let stopped = false;
  const knownChips = new Set<HTMLElement>();
  const observedScopes = new Set<HTMLElement>();
  const resizeObserver = new ResizeObserver(() => schedule());

  const refresh = async (chips: HTMLElement[], gen: number) => {
    await Promise.all(chips.map(async (chip) => {
      if (stopped || gen !== generation || !chip.isConnected || !visible(chip)) return;
      const scope = scopeForChip(chip);
      if (!scope) return;
      const frame = frameForChip(chip, scope);
      const image = frame ? imageIn(frame) : null;
      const source = image?.currentSrc || image?.src;
      if (!frame || !image || !source || image.hidden || !image.complete || !image.naturalWidth) {
        applySample(chip, backgroundSample(chip));
        return;
      }
      const decoded = await lumaGridFor(source);
      if (stopped || gen !== generation) return;
      if (!decoded) {
        applySample(chip, backgroundSample(chip));
        return;
      }
      const frameRect = frame.getBoundingClientRect();
      const sourceWidth = Number((decoded as HTMLImageElement).naturalWidth) || 0;
      const sourceHeight = Number((decoded as HTMLImageElement).naturalHeight) || 0;
      let sample: ReturnType<typeof sampleForBox> = null;
      try {
        sample = sampleForBox(
          chip,
          frame,
          decoded,
          { width: frameRect.width, height: frameRect.height },
          { width: sourceWidth, height: sourceHeight },
          readCropVars(cropHostFor(frame) ?? frame, false),
          opaqueBackground(frame) ?? '#fff',
        ) ?? backgroundSample(chip);
      } catch {
        sample = backgroundSample(chip);
      }
      if (gen === generation && !stopped) {
        applySample(chip, sample);
      }
    }));
  };

  const schedule = () => {
    generation += 1;
    if (frameHandle) return;
    frameHandle = requestAnimationFrame(() => {
      frameHandle = 0;
      if (stopped) return;
      if (!document.documentElement.classList.contains('is-dev-mode')) {
        knownChips.forEach(clearChip);
        knownChips.clear();
        observedScopes.forEach((scope) => resizeObserver.unobserve(scope));
        observedScopes.clear();
        return;
      }
      const chips = [...document.querySelectorAll<HTMLElement>(CHIP_SELECTOR)].filter(visible);
      knownChips.forEach((chip) => {
        if (!chips.includes(chip)) {
          clearChip(chip);
          knownChips.delete(chip);
        }
      });
      chips.forEach((chip) => knownChips.add(chip));
      const scopes = new Set(chips.map(scopeForChip).filter((scope): scope is HTMLElement => Boolean(scope)));
      observedScopes.forEach((scope) => {
        if (!scopes.has(scope)) {
          resizeObserver.unobserve(scope);
          observedScopes.delete(scope);
        }
      });
      chips.forEach((chip) => {
        const scope = scopeForChip(chip);
        if (scope && !observedScopes.has(scope)) {
          resizeObserver.observe(scope);
          observedScopes.add(scope);
        }
      });
      void refresh(chips, generation);
    });
  };

  const onLoad = (event: Event) => {
    if ((event.target as HTMLElement | null)?.matches?.('img')) schedule();
  };
  const onCarouselScrollEnd = (event: Event) => {
    if (event.target instanceof HTMLElement && event.target.matches('.project-image-carousel__track')) schedule();
  };
  const onReveal = (event: Event) => {
    const target = event.target as Node | null;
    if (target instanceof HTMLElement && target.closest(`${CHIP_SELECTOR}, ${TARGET_SELECTOR}`)) schedule();
  };
  const onCustom = () => schedule();
  const mutationObserver = new MutationObserver((records) => {
    if (!document.documentElement.classList.contains('is-dev-mode')) return;
    if (records.some((record) => {
      if (record.type !== 'attributes') {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        const target = record.target instanceof HTMLElement ? record.target : null;
        return Boolean(target?.closest(TARGET_SELECTOR) || nodes.some((node) => (
          node instanceof HTMLElement && (node.matches(TARGET_SELECTOR) || node.querySelector(TARGET_SELECTOR))
        )));
      }
      if (!(record.target instanceof HTMLElement)) return false;
      if (record.attributeName === 'data-media-ground') return false;
      if (record.target.matches(CHIP_SELECTOR) && record.attributeName === 'style') return false;
      return Boolean(record.target.closest(TARGET_SELECTOR));
    })) schedule();
  });
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style', 'class', 'hidden', 'data-media-ground'],
  });
  let editMode = document.documentElement.classList.contains('is-dev-mode');
  const htmlObserver = new MutationObserver(() => {
    const nextEditMode = document.documentElement.classList.contains('is-dev-mode');
    if (nextEditMode === editMode) return;
    editMode = nextEditMode;
    schedule();
  });
  htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('load', onLoad, true);
  document.addEventListener('pointerover', onReveal, true);
  document.addEventListener('focusin', onReveal, true);
  document.addEventListener('scrollend', onCarouselScrollEnd, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('vcd:dev-pending-upsert', onCustom);
  window.addEventListener('vcd:dev-frame-changed', onCustom);
  schedule();

  return () => {
    stopped = true;
    generation += 1;
    cancelAnimationFrame(frameHandle);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    htmlObserver.disconnect();
    document.removeEventListener('load', onLoad, true);
    document.removeEventListener('pointerover', onReveal, true);
    document.removeEventListener('focusin', onReveal, true);
    document.removeEventListener('scrollend', onCarouselScrollEnd, true);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('vcd:dev-pending-upsert', onCustom);
    window.removeEventListener('vcd:dev-frame-changed', onCustom);
    knownChips.forEach(clearChip);
    knownChips.clear();
  };
}
