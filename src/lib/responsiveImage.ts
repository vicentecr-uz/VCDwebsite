export type ImageViewport = 'desktop' | 'tablet' | 'mobile';

export interface ImageVariant {
  aspect: string;
  cx: number;
  cy: number;
  w: number;
}

export interface LegacyImageVariant {
  aspectRatio: string;
  x: number;
  y: number;
  zoom: number;
}

export type ImageVariants = Partial<
  Record<ImageViewport, Partial<ImageVariant> & Partial<LegacyImageVariant>>
>;

export interface ImageSourceDims {
  width: number;
  height: number;
}

export type ImageGridColumns = number | Partial<Record<ImageViewport, number>>;

export type ImageGridConstrainedValue = number | boolean | 'text';
export type ImageGridConstrained =
  | ImageGridConstrainedValue
  | Partial<Record<ImageViewport, ImageGridConstrainedValue>>;

export const IMAGE_GRID_CONSTRAIN_PERCENTS = [30, 40, 50, 60, 70, 80, 90, 100] as const;

export type ImageGridConstrainPercent = (typeof IMAGE_GRID_CONSTRAIN_PERCENTS)[number] | 'text';

export interface ImageGridLayout {
  visible: string[];
}

export type ImageGridLayouts = Partial<Record<ImageViewport, ImageGridLayout>>;

export interface ResolvedImageGridLayout {
  visible: string[];
  hidden: string[];
  overridden: boolean;
}

export const IMAGE_VIEWPORTS: ImageViewport[] = ['desktop', 'tablet', 'mobile'];

const VIEWPORTS = IMAGE_VIEWPORTS;

const normalizeConstrainPercent = (value: unknown, fallback = 100): ImageGridConstrainPercent => {
  if (value === true) return 80;
  if (value === 'text') return 'text';
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
  if (typeof constrained === 'boolean' || typeof constrained === 'number' || constrained === 'text') {
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
  constrained: Record<ImageViewport, ImageGridConstrainPercent>,
): string {
  return VIEWPORTS
    .map((viewport) => {
      const value = constrained[viewport];
      if (value === 100) {
        return `--project-image-grid-width-${viewport}:var(--project-full-media-width, 100%)`;
      }
      if (value === 'text') {
        return `--project-image-grid-width-${viewport}:min(100%, var(--page-text-max-width))`;
      }
      return `--project-image-grid-width-${viewport}:min(100%, calc(var(--page-media-max-width) * ${value} / 100))`;
    })
    .join(';');
}

export function imageHasWidthConstraint(
  constrained: Record<ImageViewport, ImageGridConstrainPercent>,
): boolean {
  return VIEWPORTS.some((viewport) => constrained[viewport] !== 100);
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
    w: variant?.w ?? fallback.w,
  };
};

export function normalizeImageVariants(
  variants: ImageVariants | undefined,
  fallbackAspect: string | Record<ImageViewport, string>,
  srcDims?: ImageSourceDims | null,
): Record<ImageViewport, ImageVariant> {
  const srcAspect = srcDims && srcDims.width > 0 && srcDims.height > 0
    ? srcDims.width / srcDims.height
    : null;

  const aspectFor = (viewport: ImageViewport, inherited: ImageVariant): string => (
    typeof fallbackAspect === 'string'
      ? fallbackAspect
      : (fallbackAspect[viewport] ?? inherited.aspect)
  );

  const normalized = {} as Record<ImageViewport, ImageVariant>;
  let fallback: ImageVariant = {
    aspect: typeof fallbackAspect === 'string' ? fallbackAspect : fallbackAspect.desktop,
    cx: 0.5,
    cy: 0.5,
    w: 1,
  };
  const inherited = { aspect: false, cx: false, cy: false, w: false };
  for (const viewport of VIEWPORTS) {
    const authored = variants?.[viewport];
    const authoredAspect = authored?.aspect ?? authored?.aspectRatio;
    const aspect = authoredAspect ?? (inherited.aspect
      ? fallback.aspect
      : aspectFor(viewport, fallback));
    const base: ImageVariant = {
      aspect,
      cx: inherited.cx ? fallback.cx : 0.5,
      cy: inherited.cy ? fallback.cy : 0.5,
      w: inherited.w ? fallback.w : coverWidthFraction(aspect, srcAspect),
    };
    normalized[viewport] = normalizeVariant(authored, base, srcAspect);
    if (authoredAspect !== undefined) inherited.aspect = true;
    if (authored?.cx !== undefined || authored?.x !== undefined) inherited.cx = true;
    if (authored?.cy !== undefined || authored?.y !== undefined) inherited.cy = true;
    if (authored?.w !== undefined || authored?.zoom !== undefined) inherited.w = true;
    fallback = normalized[viewport];
  }
  return normalized;
}

export function aspectRatioNumber(aspectRatio: string): number | null {
  if (!aspectRatio || aspectRatio === 'original') return null;
  const [widthRaw, heightRaw] = aspectRatio.split(':').map(Number);
  if (!widthRaw || !heightRaw) return null;
  return widthRaw / heightRaw;
}

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

export function hoverCropStyle(
  variants: Record<ImageViewport, ImageVariant>,
): string {
  return VIEWPORTS.flatMap((viewport) => {
    const variant = variants[viewport];
    return [
      `--project-hover-content-w-${viewport}:${variant.w}`,
      `--project-hover-content-cx-${viewport}:${variant.cx}`,
      `--project-hover-content-cy-${viewport}:${variant.cy}`,
    ];
  }).join(';');
}
