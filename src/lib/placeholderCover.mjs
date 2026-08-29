/**
 * Shared between src/components/ProjectGrid.astro (via import) and
 * scripts/dev-api-plugins.mjs (a plain .mjs script, so this file stays
 * TS-free rather than living in src/lib/images.ts) — see #176 handoff.
 */
export const PLACEHOLDER_COVER = '/images/black-token.svg';

/** Listing `bg` for a new project with no cover image — fill, not a token SVG. */
export const EMPTY_COVER_FILL = '#000000';

export function isPlaceholderCoverSrc(src) {
  const value = String(src || '').trim();
  if (!value) return true;
  return value === PLACEHOLDER_COVER || value.includes('black-token');
}
