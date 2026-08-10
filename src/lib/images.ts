/** Public /images path with encoded filename segments. Source lives in `media/`. */
export function projectImage(filename: string): string {
  if (filename.startsWith('/')) {
    return filename;
  }

  return `/images/${filename.split('/').map(encodeURIComponent).join('/')}`;
}
