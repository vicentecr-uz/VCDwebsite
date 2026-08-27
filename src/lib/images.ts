/** Public /images path with encoded filename segments. Source lives in `media/`. */
export function projectImage(filename: string): string {
  if (filename.startsWith('/')) {
    return filename;
  }

  return `/images/${filename.split('/').map(encodeURIComponent).join('/')}`;
}

export type ImageDisplayTier = 'original' | 'thumb' | 'preview';

function isRasterImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  return !lower.endsWith('.svg') && !lower.endsWith('.gif');
}

function shouldUseOriginalTier(filename: string): boolean {
  if (!filename || filename.startsWith('/')) return true;
  const base = filename.split('/').pop() ?? filename;
  if (base === 'placeholder.svg' || base === 'black-token.svg') return true;
  if (filename.includes('black-token')) return true;
  return !isRasterImage(filename);
}

/** Display-sized derivative URL; JSON `src` stays the original filename. */
export function projectImageTier(filename: string, tier: ImageDisplayTier): string {
  if (filename.startsWith('/')) {
    return filename;
  }

  if (tier === 'original' || shouldUseOriginalTier(filename)) {
    return projectImage(filename);
  }

  const parts = filename.split('/');
  const base = parts.pop() ?? '';
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  parts.push(`${stem}.${tier}.webp`);
  return `/images/${parts.map(encodeURIComponent).join('/')}`;
}
