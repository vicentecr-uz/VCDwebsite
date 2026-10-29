import { isVideoSrc } from './imageUpload.mjs';

/** Public /images path with encoded filename segments. Source lives in `media/`. */
export function projectImage(filename: string): string {
  if (filename === 'placeholder.svg' || filename === '/images/placeholder.svg') return '/demo-fixtures/placeholder.svg';
  if (filename.startsWith('/')) {
    return filename;
  }

  return `/images/${filename.split('/').map(encodeURIComponent).join('/')}`;
}

/** Generated first-frame poster for a media-backed video, when available. */
export function projectVideoPoster(filename: string): string | undefined {
  const value = String(filename || '');
  if (value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  const suffixIndex = value.search(/[?#]/);
  const clean = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : value.slice(suffixIndex);
  if (!isVideoSrc(clean)) return undefined;
  if (clean.startsWith('/')) {
    if (!clean.startsWith('/images/')) return undefined;
    return `${clean}.poster.webp${suffix}`;
  }
  return `${projectImage(`${clean}.poster.webp`)}${suffix}`;
}

export type ImageDisplayTier = 'original' | 'thumb' | 'preview';

function isRasterImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  return !lower.endsWith('.svg') && !lower.endsWith('.gif');
}

function shouldUseOriginalTier(filename: string): boolean {
  if (!filename || filename.startsWith('/')) return true;
  if (isVideoSrc(filename)) return true;
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
