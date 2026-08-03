export type ImageViewport = 'desktop' | 'tablet' | 'mobile';

/**
 * Frame + content, kept deliberately separate.
 *
 * `aspect` is the *frame*: the shape of the box on the page. `cx`/`cy`/`w`
 * describe the *content*: which part of the source bitmap sits in that box,
 * anchored to the source image rather than to the rendered frame. That anchoring
 * is the whole point — the same values pick the same slice at any frame size,
 * so a crop no longer drifts when the breakpoint, caption or height cap changes.
 */
export interface ImageVariant {
  /** Frame shape, `"W:H"` or `"original"` (natural ratio). */
  aspect: string;
  /** Source point at the frame centre, 0–1 of natural width. */
  cx: number;
  /** Source point at the frame centre, 0–1 of natural height. */
  cy: number;
  /** Fraction of the source WIDTH the frame spans. 1 = fit width, 0.5 = 2× zoom. */
  w: number;
}

/** Pre-migration shape. Read-only support; see scripts/migrate-crop-rects.mjs. */
export interface LegacyImageVariant {
  aspectRatio: string;
  x: number;
  y: number;
  zoom: number;
}

export type ImageVariants = Partial<
  Record<ImageViewport, Partial<ImageVariant> & Partial<LegacyImageVariant>>
>;

/** Natural pixel dimensions, stored on the image node as `srcWidth`/`srcHeight`. */
export interface ImageSourceDims {
  width: number;
  height: number;
}

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

/** True when any breakpoint uses less than full column width. */
export function imageHasWidthConstraint(
  constrained: Record<ImageViewport, ImageGridConstrainPercent>,
): boolean {
  return VIEWPORTS.some((viewport) => constrained[viewport] < 100);
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const hasRectFields = (
  variant: (Partial<ImageVariant> & Partial<LegacyImageVariant>) | undefined,
): boolean => !!variant && (variant.w !== undefined || variant.cx !== undefined || variant.cy !== undefined);

/**
 * Convert a pre-migration variant. Closed form and frame-independent — the same
 * maths as scripts/migrate-crop-rects.mjs, kept here so content the CMS writes in
 * the old shape still renders. Needs the natural ratio; without it we can only
 * carry the frame aspect across and centre the content.
 */
const fromLegacy = (
  variant: Partial<LegacyImageVariant>,
  fallbackAspect: string,
  srcAspect: number | null,
): ImageVariant => {
  const aspect = variant.aspectRatio ?? fallbackAspect;
  if (!srcAspect) return { aspect, cx: 0.5, cy: 0.5, w: 1 };

  const frameAspect = aspect === 'original'
    ? srcAspect
    : (aspectRatioNumber(aspect) ?? srcAspect);
  const zoom = variant.zoom || 1;
  const w = clamp01(Math.min(1, frameAspect / srcAspect) / zoom);
  const h = clamp01((w * srcAspect) / frameAspect);
  return {
    aspect,
    cx: clamp01(0.5 - ((variant.x ?? 0) / 100) * w),
    cy: clamp01(0.5 - ((variant.y ?? 0) / 100) * h),
    w,
  };
};

/**
 * Largest `w` that still covers the frame. Wider-than-frame sources must show
 * less than their full width or the frame is left short vertically — this is the
 * implicit default for content that has never been positioned (e.g. grid cells
 * inheriting the grid's aspect), matching the old cover-fit behaviour.
 */
export function coverWidthFraction(aspect: string, srcAspect: number | null): number {
  if (!srcAspect) return 1;
  const frameAspect = aspect === 'original'
    ? srcAspect
    : (aspectRatioNumber(aspect) ?? srcAspect);
  return Math.min(1, frameAspect / srcAspect);
}

const normalizeVariant = (
  variant: (Partial<ImageVariant> & Partial<LegacyImageVariant>) | undefined,
  fallback: ImageVariant,
  srcAspect: number | null,
): ImageVariant => {
  if (variant && !hasRectFields(variant) && variant.aspectRatio !== undefined) {
    return fromLegacy(variant, fallback.aspect, srcAspect);
  }
  const aspect = variant?.aspect ?? variant?.aspectRatio ?? fallback.aspect;
  return {
    aspect,
    cx: variant?.cx ?? fallback.cx,
    cy: variant?.cy ?? fallback.cy,
    // Clamp inherited zoom to this frame's cover bound so a breakpoint that only
    // changes `aspect` can't end up under-covering.
    w: variant?.w ?? Math.min(fallback.w, coverWidthFraction(aspect, srcAspect)),
  };
};

/**
 * Resolve per-breakpoint variants. Tablet inherits desktop and mobile inherits
 * tablet unless overridden — unchanged from before, only the fields differ.
 */
export function normalizeImageVariants(
  variants: ImageVariants | undefined,
  fallbackAspect: string,
  srcDims?: ImageSourceDims | null,
): Record<ImageViewport, ImageVariant> {
  const srcAspect = srcDims && srcDims.width > 0 && srcDims.height > 0
    ? srcDims.width / srcDims.height
    : null;

  const normalized = {} as Record<ImageViewport, ImageVariant>;
  let fallback: ImageVariant = { aspect: fallbackAspect, cx: 0.5, cy: 0.5, w: 1 };
  for (const viewport of VIEWPORTS) {
    normalized[viewport] = normalizeVariant(variants?.[viewport], fallback, srcAspect);
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

/**
 * Emit the per-breakpoint custom properties the frame and content read.
 *
 * With `srcDims` known, `aspect: "original"` resolves to a literal ratio here,
 * so the frame is correct in the first paint. Without it we fall back to the
 * JS-written var, which costs a layout pass once the bitmap decodes.
 */
export function responsiveImageStyle(
  variants: Record<ImageViewport, ImageVariant>,
  srcDims?: ImageSourceDims | null,
): string {
  const hasDims = !!srcDims && srcDims.width > 0 && srcDims.height > 0;
  return VIEWPORTS.flatMap((viewport) => {
    const variant = variants[viewport];
    const isOriginal = variant.aspect === 'original';

    const ratio = isOriginal
      ? (hasDims
        ? `${srcDims!.width} / ${srcDims!.height}`
        : 'var(--project-image-original-ratio, 1 / 1)')
      : variant.aspect.replace(':', ' / ');

    const ratioNum = isOriginal
      ? (hasDims
        ? String(srcDims!.width / srcDims!.height)
        : 'var(--project-image-original-ratio-num, 1)')
      : String(aspectRatioNumber(variant.aspect) ?? 1);

    return [
      `--project-image-ratio-${viewport}:${ratio}`,
      `--project-image-ratio-num-${viewport}:${ratioNum}`,
      `--project-content-w-${viewport}:${variant.w}`,
      `--project-content-cx-${viewport}:${variant.cx}`,
      `--project-content-cy-${viewport}:${variant.cy}`,
    ];
  }).join(';');
}
