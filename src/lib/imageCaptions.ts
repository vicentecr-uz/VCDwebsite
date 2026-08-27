import type { ImageViewport } from './responsiveImage';
import { IMAGE_VIEWPORTS } from './responsiveImage';

/** Caption styles (Dev Mode tuner + project images). */
export const IMAGE_CAPTION_STYLES = [
  { id: 'white', label: 'On image' },
  { id: 'below', label: 'Below' },
] as const;

export type ImageCaptionStyleId = (typeof IMAGE_CAPTION_STYLES)[number]['id'];

/** Below-image captions are in-flow body text; overlays use corner + reveal. */
export function isBelowImageCaptionStyle(style: ImageCaptionStyleId): boolean {
  return style === 'below';
}

/** Overlay caption alignment along the bottom edge (Dev Mode tuner + project images). */
export const IMAGE_CAPTION_POSITIONS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
] as const;

export type ImageCaptionPositionId = (typeof IMAGE_CAPTION_POSITIONS)[number]['id'];

export const DEFAULT_IMAGE_CAPTION_POSITION: ImageCaptionPositionId = 'left';

/** How the caption appears at a breakpoint. */
export const IMAGE_CAPTION_REVEALS = [
  { id: 'hover', label: 'On hover' },
  { id: 'always', label: 'Always visible' },
] as const;

export type ImageCaptionReveal = (typeof IMAGE_CAPTION_REVEALS)[number]['id'];

export type ImageCaptions = Record<ImageViewport, string>;
export type ImageCaptionReveals = Record<ImageViewport, ImageCaptionReveal>;

export type ImageCaptionInput =
  | string
  | Partial<Record<ImageViewport, string>>
  | null
  | undefined;

export type ImageCaptionRevealInput =
  | ImageCaptionReveal
  | Partial<Record<ImageViewport, ImageCaptionReveal>>
  | null
  | undefined;

const VIEWPORTS = IMAGE_VIEWPORTS;

/** Defaults when content has no reveal setting: hover on desktop, always on touch-first sizes. */
export const DEFAULT_IMAGE_CAPTION_REVEALS: ImageCaptionReveals = {
  desktop: 'hover',
  tablet: 'always',
  mobile: 'always',
};

/** Forced reveal map for below-image captions (always visible, no hover). */
export const BELOW_IMAGE_CAPTION_REVEALS: ImageCaptionReveals = {
  desktop: 'always',
  tablet: 'always',
  mobile: 'always',
};

export function isImageCaptionStyleId(value: unknown): value is ImageCaptionStyleId {
  return IMAGE_CAPTION_STYLES.some((style) => style.id === value);
}

/** Resolve style id; legacy `default` / `black` map to overlay (`white`). */
export function resolveImageCaptionStyle(value: unknown): ImageCaptionStyleId {
  if (value === 'below') return 'below';
  if (value === 'default' || value === 'black') return 'white';
  return isImageCaptionStyleId(value) ? value : 'white';
}

export function isImageCaptionPositionId(value: unknown): value is ImageCaptionPositionId {
  return IMAGE_CAPTION_POSITIONS.some((position) => position.id === value);
}

/** Resolve bottom-edge alignment; legacy corner ids map forward; missing / unknown → left. */
export function resolveImageCaptionPosition(value: unknown): ImageCaptionPositionId {
  switch (value) {
    case 'left':
    case 'bottom-left':
    case 'top-left':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'bottom-right':
    case 'top-right':
      return 'right';
    default:
      return DEFAULT_IMAGE_CAPTION_POSITION;
  }
}

/** On-image overlay uses base `.project-caption`; below adds a modifier class. */
export function imageCaptionStyleClass(style: ImageCaptionStyleId): string {
  return style === 'below' ? 'project-caption--below' : '';
}

export function isImageCaptionReveal(value: unknown): value is ImageCaptionReveal {
  return IMAGE_CAPTION_REVEALS.some((reveal) => reveal.id === value);
}

/** Expand legacy / partial reveal into a full per-breakpoint map. */
export function resolveImageCaptionReveals(
  input: ImageCaptionRevealInput,
): ImageCaptionReveals {
  if (isImageCaptionReveal(input)) {
    return { desktop: input, tablet: input, mobile: input };
  }
  if (input && typeof input === 'object') {
    const desktop = isImageCaptionReveal(input.desktop)
      ? input.desktop
      : DEFAULT_IMAGE_CAPTION_REVEALS.desktop;
    const tablet = isImageCaptionReveal(input.tablet) ? input.tablet : desktop;
    const mobile = isImageCaptionReveal(input.mobile) ? input.mobile : tablet;
    return { desktop, tablet, mobile };
  }
  return { ...DEFAULT_IMAGE_CAPTION_REVEALS };
}

/**
 * Write reveal mode at `viewport`, cascading down to smaller breakpoints
 * (same rule as caption text).
 */
export function setImageCaptionRevealAtViewport(
  reveals: ImageCaptionReveals,
  viewport: ImageViewport,
  reveal: ImageCaptionReveal,
): ImageCaptionReveals {
  const next = { ...reveals };
  if (viewport === 'desktop') {
    next.desktop = reveal;
    next.tablet = reveal;
    next.mobile = reveal;
  } else if (viewport === 'tablet') {
    next.tablet = reveal;
    next.mobile = reveal;
  } else {
    next.mobile = reveal;
  }
  return next;
}

/** Expand legacy `caption` string or partial `captions` into a full per-breakpoint map. */
export function resolveImageCaptions(input: {
  caption?: ImageCaptionInput;
  captions?: ImageCaptionInput;
}): ImageCaptions {
  const source = input.captions ?? input.caption;
  if (typeof source === 'string') {
    const text = source.trim();
    return { desktop: text, tablet: text, mobile: text };
  }
  if (source && typeof source === 'object') {
    const desktop = String(source.desktop ?? '').trim();
    const tablet = String(source.tablet ?? desktop).trim();
    const mobile = String(source.mobile ?? tablet).trim();
    return { desktop, tablet, mobile };
  }
  return { desktop: '', tablet: '', mobile: '' };
}

export function imageCaptionsHaveText(captions: ImageCaptions): boolean {
  return VIEWPORTS.some((viewport) => captions[viewport].length > 0);
}

/**
 * Write caption text at `viewport`, cascading down to smaller breakpoints.
 * Desktop → tablet + mobile; tablet → mobile; mobile → mobile only.
 */
export function setImageCaptionAtViewport(
  captions: ImageCaptions,
  viewport: ImageViewport,
  text: string,
): ImageCaptions {
  const next = { ...captions };
  const value = text.replaceAll('\u00a0', ' ');
  if (viewport === 'desktop') {
    next.desktop = value;
    next.tablet = value;
    next.mobile = value;
  } else if (viewport === 'tablet') {
    next.tablet = value;
    next.mobile = value;
  } else {
    next.mobile = value;
  }
  return next;
}

export function matchImageCaptionViewport(width = typeof window !== 'undefined' ? window.innerWidth : 1200): ImageViewport {
  if (width <= 767) return 'mobile';
  if (width <= 991) return 'tablet';
  return 'desktop';
}
