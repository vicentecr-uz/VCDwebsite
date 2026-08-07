const DRAFT_SRC_PREFIX = 'draft:';

/** Public /images path with encoded filename segments. */
export function projectImage(filename: string): string {
  if (filename.startsWith(DRAFT_SRC_PREFIX)) {
    const draftPath = filename.slice(DRAFT_SRC_PREFIX.length);
    return `/draft-media/${draftPath.split('/').map(encodeURIComponent).join('/')}`;
  }

  if (filename.startsWith('/')) {
    return filename;
  }

  return `/images/${filename.split('/').map(encodeURIComponent).join('/')}`;
}

/** Build a draft media src token stored in project JSON. */
export function draftProjectImageSrc(filename: string): string {
  return `${DRAFT_SRC_PREFIX}${filename}`;
}

export function isDraftImageSrc(src: string): boolean {
  return src.startsWith(DRAFT_SRC_PREFIX);
}
