/**
 * Normalize the solid image-frame fill used by project media.
 * Alpha-bearing picker values are intentionally reduced to opaque RGB; alpha
 * 00 is the canonical transparent/no-fill value.
 */
export function normalizeImageBackground(value) {
  if (value === undefined || value === null || value === '' || value === 'transparent') return 'transparent';
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (raw === 'transparent') return 'transparent';
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split('').map((c) => c + c).join('')}`;
  }
  if (/^#[0-9a-f]{4}$/i.test(raw)) {
    const hex = raw.slice(1);
    return hex.slice(3) === '0' ? 'transparent' : `#${hex.slice(0, 3).split('').map((c) => c + c).join('')}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{8}$/i.test(raw)) return raw.slice(7, 9) === '00' ? 'transparent' : raw.slice(0, 7);
  return null;
}

export function imageBackgroundStyle(value) {
  const normalized = normalizeImageBackground(value) ?? 'transparent';
  return normalized === 'transparent' ? undefined : `--project-image-background:${normalized}`;
}
