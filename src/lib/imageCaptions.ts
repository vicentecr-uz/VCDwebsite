import type { ImageViewport } from './responsiveImage';
import { IMAGE_VIEWPORTS } from './responsiveImage';

export const IMAGE_CAPTION_STYLES = [
  { id: 'white', label: 'On image' },
  { id: 'below', label: 'Below' },
] as const;

export type ImageCaptionStyleId = (typeof IMAGE_CAPTION_STYLES)[number]['id'];

export function isBelowImageCaptionStyle(style: ImageCaptionStyleId): boolean {
  return style === 'below';
}

export const IMAGE_CAPTION_OVERLAY_POSITIONS = [
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'top-left', label: 'Top left' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'top-right', label: 'Top right' },
] as const;

export const IMAGE_CAPTION_BELOW_ALIGNS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
] as const;

export type ImageCaptionOverlayPositionId = (typeof IMAGE_CAPTION_OVERLAY_POSITIONS)[number]['id'];
export type ImageCaptionBelowAlignId = (typeof IMAGE_CAPTION_BELOW_ALIGNS)[number]['id'];
export type ImageCaptionPositionId = ImageCaptionOverlayPositionId | ImageCaptionBelowAlignId;

export const DEFAULT_IMAGE_CAPTION_POSITION: ImageCaptionOverlayPositionId = 'bottom-left';
export const DEFAULT_IMAGE_CAPTION_BELOW_ALIGN: ImageCaptionBelowAlignId = 'left';

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

export const DEFAULT_IMAGE_CAPTION_REVEALS: ImageCaptionReveals = {
  desktop: 'hover',
  tablet: 'always',
  mobile: 'always',
};

export const BELOW_IMAGE_CAPTION_REVEALS: ImageCaptionReveals = {
  desktop: 'always',
  tablet: 'always',
  mobile: 'always',
};

export function isImageCaptionStyleId(value: unknown): value is ImageCaptionStyleId {
  return IMAGE_CAPTION_STYLES.some((style) => style.id === value);
}

export function resolveImageCaptionStyle(value: unknown): ImageCaptionStyleId {
  if (value === 'below') return 'below';
  if (value === 'default' || value === 'black') return 'white';
  return isImageCaptionStyleId(value) ? value : 'white';
}

export function isImageCaptionPositionId(value: unknown): value is ImageCaptionPositionId {
  return (
    IMAGE_CAPTION_OVERLAY_POSITIONS.some((position) => position.id === value)
    || IMAGE_CAPTION_BELOW_ALIGNS.some((align) => align.id === value)
  );
}

export function resolveImageCaptionPosition(
  value: unknown,
  style?: ImageCaptionStyleId,
): ImageCaptionPositionId {
  const resolvedStyle = style ?? 'white';
  if (resolvedStyle === 'below') {
    switch (value) {
      case 'left':
      case 'center':
      case 'right':
        return value;
      case 'bottom-left':
      case 'top-left':
        return 'left';
      case 'bottom-right':
      case 'top-right':
        return 'right';
      default:
        return DEFAULT_IMAGE_CAPTION_BELOW_ALIGN;
    }
  }
  switch (value) {
    case 'bottom-left':
    case 'top-left':
    case 'bottom-right':
    case 'top-right':
      return value;
    case 'left':
      return 'bottom-left';
    case 'right':
      return 'bottom-right';
    case 'center':
      return 'bottom-left';
    default:
      return DEFAULT_IMAGE_CAPTION_POSITION;
  }
}

export function imageCaptionStyleClass(style: ImageCaptionStyleId): string {
  return style === 'below' ? 'project-caption--below' : '';
}

export function isImageCaptionReveal(value: unknown): value is ImageCaptionReveal {
  return IMAGE_CAPTION_REVEALS.some((reveal) => reveal.id === value);
}

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
