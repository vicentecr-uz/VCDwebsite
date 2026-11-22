export const PLACEHOLDER_COVER = '/images/black-token.svg';

export const EMPTY_COVER_FILL = '#000000';

export function isPlaceholderCoverSrc(src) {
  const value = String(src || '').trim();
  if (!value) return true;
  return value === PLACEHOLDER_COVER || value.includes('black-token');
}
