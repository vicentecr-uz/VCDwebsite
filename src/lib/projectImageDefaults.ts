import type { ImageVariants } from './responsiveImage';

export const DEFAULT_IMAGE_VARIANTS: ImageVariants = {
  desktop: { aspectRatio: 'original', x: 0, y: 0, zoom: 1 },
  tablet: { aspectRatio: 'original', x: 0, y: 0, zoom: 1 },
  mobile: { aspectRatio: 'original', x: 0, y: 0, zoom: 1 },
};

export const PLACEHOLDER_IMAGE_VARIANTS: ImageVariants = {
  desktop: { aspectRatio: '4:3', x: 0, y: 0, zoom: 1 },
  tablet: { aspectRatio: '4:3', x: 0, y: 0, zoom: 1 },
  mobile: { aspectRatio: '4:3', x: 0, y: 0, zoom: 1 },
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
