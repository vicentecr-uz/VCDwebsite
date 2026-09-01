import { resolveImageGridConstrained } from './responsiveImage';

/**
 * Section types that render a media block. Everything else is text and caps at
 * `--page-text-max-width`. Kept as an explicit list rather than "not text" so a
 * new section type has to be classified deliberately — defaulting an unknown
 * type to media would silently widen a page that should have stayed narrow.
 */
const MEDIA_SECTION_TYPES = new Set([
  'heroImage',
  'imageGrid',
  'imageCarousel',
  'image',
  'video',
  'pressQuoteTicker',
  'redditCommentCarousel',
  'placeholder',
  'projectGrid',
]);

/**
 * Widest fraction of the media cap this section occupies, or `null` when it
 * caps at the text column ("Match text") and so can't widen the page.
 *
 * Desktop only: the page column is only visible where there is gutter to
 * spare, and narrower breakpoints are governed by the viewport, not the cap.
 */
const mediaFraction = (section: Record<string, unknown>): number | null => {
  if (!('constrained' in section)) return 1;
  const desktop = resolveImageGridConstrained(section.constrained as never).desktop;
  if (desktop === 'text') return null;
  return desktop / 100;
};

/**
 * The column a page actually needs, as an inline `style` value for
 * `#site-wrapper` — or `undefined` when the page wants the default and no
 * override should be written.
 *
 * A page's column is the widest block on it, floored at the text column, so a
 * text-only page pulls its gutter — and the header sitting inside it — in to
 * the text width instead of reserving room for media it doesn't have.
 *
 * This is only safe because a block's width no longer depends on its column:
 * percentages measure against `--page-media-max-width`, a fixed baseline. If
 * they measured against the column, shrinking the column would shrink the
 * block that determined it, and the two would chase each other. See
 * docs/page-width.md.
 */
export function pageColumnStyle(sections: unknown): string | undefined {
  if (!Array.isArray(sections)) return undefined;

  let widest = 0;
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const type = String((section as Record<string, unknown>).type ?? '');
    if (!MEDIA_SECTION_TYPES.has(type)) continue;

    const fraction = mediaFraction(section as Record<string, unknown>);
    if (fraction === null) continue; // caps at text; can't widen the page
    if (fraction >= 1) return undefined; // full-width media: the default column
    widest = Math.max(widest, fraction);
  }

  if (widest === 0) return '--page-max-width: var(--page-text-max-width)';
  return `--page-max-width: max(var(--page-text-max-width), calc(var(--page-media-max-width) * ${widest}))`;
}
