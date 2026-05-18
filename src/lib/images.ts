/** Public /images path with encoded filename segments. */
export function projectImage(filename: string): string {
  return `/images/${filename.split('/').map(encodeURIComponent).join('/')}`;
}
