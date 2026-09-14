const SAFE_HREF = /^(https?:\/\/|\/|#|mailto:)/i;
const BARE_HOST = /^(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#].*)?$/i;

/** Normalize editable links while rejecting script/data/javascript protocols. */
export function normalizeHref(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (SAFE_HREF.test(trimmed)) return trimmed;
  if (BARE_HOST.test(trimmed)) return `https://${trimmed}`;
  return null;
}
