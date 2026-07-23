import type { ImageVariants } from './responsiveImage';

/** Centred, full-width content in a natural-ratio frame — i.e. an uncropped image. */
export const DEFAULT_IMAGE_VARIANTS: ImageVariants = {
  desktop: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 },
  tablet: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 },
  mobile: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 },
};

export const PLACEHOLDER_IMAGE_VARIANTS: ImageVariants = {
  desktop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
  tablet: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
  mobile: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
};

export function slugifyId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image';
}

export function uniqueSectionId(base: string, existing: Set<string>): string {
  let id = slugifyId(base);
  if (!existing.has(id)) {
    existing.add(id);
    return id;
  }
  let index = 2;
  while (existing.has(`${id}-${index}`)) index += 1;
  const next = `${id}-${index}`;
  existing.add(next);
  return next;
}
