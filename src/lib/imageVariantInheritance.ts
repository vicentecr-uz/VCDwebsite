import type { ImageVariant, ImageVariants, ImageViewport } from './responsiveImage';
import { IMAGE_VIEWPORTS } from './responsiveImage';

export type ImageVariantSetting = 'aspect' | 'crop';

const fieldsFor = (setting: ImageVariantSetting): readonly string[] => (
  setting === 'aspect' ? ['aspect', 'aspectRatio'] : ['cx', 'cy', 'w', 'x', 'y', 'zoom']
);

const hasSetting = (variant: ImageVariants[ImageViewport], setting: ImageVariantSetting) => (
  !!variant && fieldsFor(setting).some((field) => (variant as Record<string, unknown>)[field] !== undefined)
);

export function setImageVariantSetting(
  variants: ImageVariants,
  viewport: ImageViewport,
  setting: ImageVariantSetting,
  value: ImageVariant,
): ImageVariants {
  const next = structuredClone(variants);
  next[viewport] = { ...(next[viewport] ?? {}) };
  if (setting === 'aspect') next[viewport]!.aspect = value.aspect;
  else {
    next[viewport]!.cx = value.cx;
    next[viewport]!.cy = value.cy;
    next[viewport]!.w = value.w;
  }
  return next;
}

export function resetImageVariantSetting(
  variants: ImageVariants,
  viewport: ImageViewport,
  setting: ImageVariantSetting,
): ImageVariants {
  const next = structuredClone(variants);
  const variant = next[viewport];
  if (!variant) return next;
  for (const field of fieldsFor(setting)) delete (variant as Record<string, unknown>)[field];
  if (!Object.keys(variant).length) delete next[viewport];
  return next;
}

export function imageVariantSettingSource(
  variants: ImageVariants,
  viewport: ImageViewport,
  setting: ImageVariantSetting,
): ImageViewport | undefined {
  const index = IMAGE_VIEWPORTS.indexOf(viewport);
  for (let i = index; i >= 0; i -= 1) {
    const candidate = IMAGE_VIEWPORTS[i];
    if (hasSetting(variants[candidate], setting)) return candidate;
  }
  return undefined;
}

export function imageVariantsSavePayload(variants: ImageVariants): ImageVariants {
  return Object.fromEntries(
    IMAGE_VIEWPORTS.map((viewport) => [viewport, structuredClone(variants[viewport] ?? {})]),
  ) as ImageVariants;
}
