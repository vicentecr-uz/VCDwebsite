import { resolveImageGridConstrained } from './responsiveImage';

export const ADAPTIVE_PAGE_COLUMNS_ENABLED = false;

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
  'interactiveDemo',
  'sidenotes',
  'codeBlock',
  'sabiExample',
  'productHero',
  'award',
]);

const mediaFraction = (section: Record<string, unknown>): number | null => {
  if (!('constrained' in section)) return 1;
  const desktop = resolveImageGridConstrained(section.constrained as never).desktop;
  if (desktop === 'text') return null;
  return desktop / 100;
};

const blockWidth = (section: Record<string, unknown>, type: string): string | null => {
  if (!MEDIA_SECTION_TYPES.has(type)) return 'var(--page-text-max-width)';
  const fraction = mediaFraction(section);
  if (fraction === null) return 'var(--page-text-max-width)';
  if (fraction >= 1) return null;
  return `calc(var(--page-media-max-width) * ${fraction})`;
};

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
    if (fraction === null) continue;
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
  if (headerWidth === undefined) headerWidth = 'var(--page-text-max-width)';
  if (headerWidth !== null) declarations.push(`--page-header-width: ${headerWidth}`);

  return declarations.length ? declarations.join('; ') : undefined;
}
