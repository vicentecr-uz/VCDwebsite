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

/** CSS length for one section's block width, or null when it can't widen the page. */
const blockWidth = (section: Record<string, unknown>, type: string): string | null => {
  if (!MEDIA_SECTION_TYPES.has(type)) return 'var(--page-text-max-width)';
  const fraction = mediaFraction(section);
  if (fraction === null) return 'var(--page-text-max-width)';
  if (fraction >= 1) return null; // full media column
  return `calc(var(--page-media-max-width) * ${fraction})`;
};

/**
 * Inline style for `#site-wrapper`, carrying two things:
 *
 * - `--page-max-width`: the column the page needs — the widest block on it,
 *   floored at the text column. A page with no media pulls its gutter (and the
 *   header sitting inside it) in to the text width.
 * - `--page-header-width`: what the header ROW spans, taken from the **first**
 *   block. The header reads as a pair with whatever sits directly under it, so
 *   the wordmark and logo line up with the intro text on a gallery page and
 *   with the hero image on a project page. Only the row narrows — the header
 *   box, its slot and its full-bleed fill stay at the column width, so the fill
 *   still reaches the viewport edge and the dock/ride geometry is untouched.
 *
 * Returns undefined when the page wants the defaults and no override is needed.
 *
 * This is only safe because a block's width doesn't depend on its column:
 * percentages measure against `--page-media-max-width`, a fixed baseline. If
 * they measured against the column, shrinking the column would shrink the block
 * that determined it. See docs/page-width.md.
 */
export function pageColumnStyle(sections: unknown): string | undefined {
  if (!Array.isArray(sections)) return undefined;

  let widest = 0;
  let full = false;
  let headerWidth: string | null | undefined;

  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const record = section as Record<string, unknown>;
    const type = String(record.type ?? '');

    if (headerWidth === undefined) headerWidth = blockWidth(record, type);

    if (!MEDIA_SECTION_TYPES.has(type)) continue;
    const fraction = mediaFraction(record);
    if (fraction === null) continue; // caps at text; can't widen the page
    if (fraction >= 1) full = true;
    else widest = Math.max(widest, fraction);
  }

  const declarations: string[] = [];

  if (!full) {
    declarations.push(
      widest === 0
        ? '--page-max-width: var(--page-text-max-width)'
        : `--page-max-width: max(var(--page-text-max-width), calc(var(--page-media-max-width) * ${widest}))`,
    );
  }
  // A page with no sections at all has nothing under the header; the text
  // column is the sane floor, and matches the column chosen above.
  if (headerWidth === undefined) headerWidth = 'var(--page-text-max-width)';
  if (headerWidth !== null) declarations.push(`--page-header-width: ${headerWidth}`);

  return declarations.length ? declarations.join('; ') : undefined;
}
