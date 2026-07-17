export type ImageViewport = 'desktop' | 'tablet' | 'mobile';

export interface ImageVariant {
  aspectRatio: string;
  x: number;
  y: number;
  zoom: number;
}

export type ImageVariants = Partial<Record<ImageViewport, Partial<ImageVariant>>>;

const VIEWPORTS: ImageViewport[] = ['desktop', 'tablet', 'mobile'];

const normalizeVariant = (
  variant: Partial<ImageVariant> | undefined,
  fallback: ImageVariant,
): ImageVariant => ({
  aspectRatio: variant?.aspectRatio ?? fallback.aspectRatio,
  x: variant?.x ?? fallback.x,
  y: variant?.y ?? fallback.y,
  zoom: variant?.zoom ?? fallback.zoom,
});

export function normalizeImageVariants(
  variants: ImageVariants | undefined,
  fallbackAspectRatio: string,
  legacyCrop?: { x?: number; y?: number; zoom?: number },
): Record<ImageViewport, ImageVariant> {
  const initial: ImageVariant = {
    aspectRatio: fallbackAspectRatio,
    x: legacyCrop?.x ?? 0,
    y: legacyCrop?.y ?? 0,
    zoom: legacyCrop?.zoom ?? 1,
  };

  const normalized = {} as Record<ImageViewport, ImageVariant>;
  let fallback = initial;
  for (const viewport of VIEWPORTS) {
    normalized[viewport] = normalizeVariant(variants?.[viewport], fallback);
    fallback = normalized[viewport];
  }
  return normalized;
}

export function responsiveImageStyle(
  variants: Record<ImageViewport, ImageVariant>,
): string {
  return VIEWPORTS.flatMap((viewport) => {
    const variant = variants[viewport];
    const ratio = variant.aspectRatio === 'original'
      ? 'var(--project-image-original-ratio, 1 / 1)'
      : variant.aspectRatio.replace(':', ' / ');
    return [
      `--project-image-ratio-${viewport}:${ratio}`,
      `--project-image-x-${viewport}:${variant.x}%`,
      `--project-image-y-${viewport}:${variant.y}%`,
      `--project-image-zoom-${viewport}:${variant.zoom}`,
    ];
  }).join(';');
}
