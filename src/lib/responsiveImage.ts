export type ImageViewport = 'desktop' | 'tablet' | 'mobile';

export interface ImageVariant {
  aspectRatio: string;
  x: number;
  y: number;
  zoom: number;
}

export type ImageVariants = Partial<Record<ImageViewport, Partial<ImageVariant>>>;

/** Legacy single count, or per-breakpoint column counts. */
export type ImageGridColumns = number | Partial<Record<ImageViewport, number>>;

/**
 * Grid width constraint as a percent (30–90), or 100 / false / omitted for full width.
 * Legacy boolean `true` maps to 80. Per-breakpoint object inherits smaller widths
 * from the next larger breakpoint when omitted.
 */
export type ImageGridConstrainedValue = number | boolean;
export type ImageGridConstrained =
  | ImageGridConstrainedValue
  | Partial<Record<ImageViewport, ImageGridConstrainedValue>>;

/** Allowed constrain dropdown values (100 = None / full width). */
export const IMAGE_GRID_CONSTRAIN_PERCENTS = [30, 40, 50, 60, 70, 80, 90, 100] as const;

export type ImageGridConstrainPercent = (typeof IMAGE_GRID_CONSTRAIN_PERCENTS)[number];

/** Visible item ids for one breakpoint. Omitted breakpoints inherit from the next larger one. */
export interface ImageGridLayout {
  visible: string[];
}

export type ImageGridLayouts = Partial<Record<ImageViewport, ImageGridLayout>>;

export interface ResolvedImageGridLayout {
  visible: string[];
  hidden: string[];
  /** True when this viewport uses its own saved layout rather than inheriting. */
  overridden: boolean;
}

export const IMAGE_VIEWPORTS: ImageViewport[] = ['desktop', 'tablet', 'mobile'];

const VIEWPORTS = IMAGE_VIEWPORTS;

const normalizeConstrainPercent = (value: unknown, fallback = 100): ImageGridConstrainPercent => {
  if (value === true) return 80;
  if (value === false || value === null || value === undefined) return fallback as ImageGridConstrainPercent;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback as ImageGridConstrainPercent;
  if (n >= 100) return 100;
  const stepped = Math.round(n / 10) * 10;
  if (stepped < 30) return 30;
  if (stepped > 90) return 90;
  return stepped as ImageGridConstrainPercent;
};

export function resolveImageGridColumns(
  columns: ImageGridColumns | undefined,
  fallback = 2,
): Record<ImageViewport, number> {
  if (typeof columns === 'number' && Number.isFinite(columns) && columns > 0) {
    const count = Math.max(1, Math.round(columns));
    return { desktop: count, tablet: count, mobile: count };
  }
  if (columns && typeof columns === 'object') {
    const desktop = Math.max(1, Math.round(Number(columns.desktop) || fallback));
    const tablet = Math.max(1, Math.round(Number(columns.tablet) || desktop));
    const mobile = Math.max(1, Math.round(Number(columns.mobile) || tablet));
    return { desktop, tablet, mobile };
  }
  return { desktop: fallback, tablet: fallback, mobile: fallback };
}

export function imageGridColumnsStyle(columns: Record<ImageViewport, number>): string {
  return VIEWPORTS
    .map((viewport) => `--project-image-grid-columns-${viewport}:${columns[viewport]}`)
    .join(';');
}

export function resolveImageGridConstrained(
  constrained: ImageGridConstrained | undefined,
): Record<ImageViewport, ImageGridConstrainPercent> {
  if (typeof constrained === 'boolean' || typeof constrained === 'number') {
    const percent = normalizeConstrainPercent(constrained, 100);
    return { desktop: percent, tablet: percent, mobile: percent };
  }
  if (constrained && typeof constrained === 'object') {
    const desktop = normalizeConstrainPercent(constrained.desktop, 100);
    const tablet = constrained.tablet === undefined
      ? desktop
      : normalizeConstrainPercent(constrained.tablet, desktop);
    const mobile = constrained.mobile === undefined
      ? tablet
      : normalizeConstrainPercent(constrained.mobile, tablet);
    return { desktop, tablet, mobile };
  }
  return { desktop: 100, tablet: 100, mobile: 100 };
}

export function imageGridConstrainedStyle(
  constrained: Record<ImageViewport, number>,
): string {
  return VIEWPORTS
    .map((viewport) => `--project-image-grid-width-${viewport}:${constrained[viewport]}%`)
    .join(';');
}

const sanitizeVisibleIds = (itemIds: string[], visible: string[] | undefined): string[] => {
  const known = new Set(itemIds);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of visible ?? []) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
};

/**
 * Resolve per-breakpoint visible/hidden lists. Desktop starts from the items
 * array order; tablet inherits desktop; mobile inherits tablet — unless that
 * viewport has its own `layouts[viewport]` override.
 */
export function resolveImageGridLayouts(
  itemIds: string[],
  layouts: ImageGridLayouts | undefined,
): Record<ImageViewport, ResolvedImageGridLayout> {
  const resolved = {} as Record<ImageViewport, ResolvedImageGridLayout>;
  let inheritedVisible = [...itemIds];

  for (const viewport of VIEWPORTS) {
    const override = layouts?.[viewport]?.visible;
    const overridden = Array.isArray(override);
    const visible = overridden
      ? sanitizeVisibleIds(itemIds, override)
      : [...inheritedVisible];
    const visibleSet = new Set(visible);
    const hidden = itemIds.filter((id) => !visibleSet.has(id));
    resolved[viewport] = { visible, hidden, overridden };
    inheritedVisible = visible;
  }

  return resolved;
}

export function imageGridItemLayoutStyle(
  itemId: string,
  layouts: Record<ImageViewport, ResolvedImageGridLayout>,
): string {
  return VIEWPORTS.flatMap((viewport) => {
    const visibleIndex = layouts[viewport].visible.indexOf(itemId);
    const order = visibleIndex >= 0 ? visibleIndex + 1 : layouts[viewport].visible.length + layouts[viewport].hidden.indexOf(itemId) + 1;
    const hidden = visibleIndex < 0;
    return [
      `--project-image-grid-order-${viewport}:${order}`,
      `--project-image-grid-hidden-${viewport}:${hidden ? 1 : 0}`,
    ];
  }).join(';');
}

const normalizeVariant = (
  variant: Partial<ImageVariant> | undefined,
  fallback: ImageVariant,
): ImageVariant => ({
  aspectRatio: variant?.aspectRatio ?? fallback.aspectRatio,
  x: variant?.x ?? fallback.x,
  y: variant?.y ?? fallback.y,
  zoom: variant?.zoom ?? fallback.zoom,
});

export function normalizeImageVariants(
  variants: ImageVariants | undefined,
  fallbackAspectRatio: string,
  legacyCrop?: { x?: number; y?: number; zoom?: number },
): Record<ImageViewport, ImageVariant> {
  const initial: ImageVariant = {
    aspectRatio: fallbackAspectRatio,
    x: legacyCrop?.x ?? 0,
    y: legacyCrop?.y ?? 0,
    zoom: legacyCrop?.zoom ?? 1,
  };

  const normalized = {} as Record<ImageViewport, ImageVariant>;
  let fallback = initial;
  for (const viewport of VIEWPORTS) {
    normalized[viewport] = normalizeVariant(variants?.[viewport], fallback);
    fallback = normalized[viewport];
  }
  return normalized;
}

/** Unitless width÷height for `calc()` (e.g. max-height width caps). */
export function aspectRatioNumber(aspectRatio: string): number | null {
  if (!aspectRatio || aspectRatio === 'original') return null;
  const [widthRaw, heightRaw] = aspectRatio.split(':').map(Number);
  if (!widthRaw || !heightRaw) return null;
  return widthRaw / heightRaw;
}

export function responsiveImageStyle(
  variants: Record<ImageViewport, ImageVariant>,
): string {
  return VIEWPORTS.flatMap((viewport) => {
    const variant = variants[viewport];
    const ratio = variant.aspectRatio === 'original'
      ? 'var(--project-image-original-ratio, 1 / 1)'
      : variant.aspectRatio.replace(':', ' / ');
    const ratioNum = aspectRatioNumber(variant.aspectRatio);
    return [
      `--project-image-ratio-${viewport}:${ratio}`,
      `--project-image-ratio-num-${viewport}:${
        ratioNum === null
          ? 'var(--project-image-original-ratio-num, 1)'
          : String(ratioNum)
      }`,
      `--project-image-x-${viewport}:${variant.x}%`,
      `--project-image-y-${viewport}:${variant.y}%`,
      `--project-image-zoom-${viewport}:${variant.zoom}`,
    ];
  }).join(';');
}
