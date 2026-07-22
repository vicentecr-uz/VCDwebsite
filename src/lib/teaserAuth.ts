/** Client-visible teaser password (static build — soft gate only). */
export function getTeaserPassword(): string {
  return import.meta.env.PUBLIC_TEASER_PASSWORD || 'preview';
}
