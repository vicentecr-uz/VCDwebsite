import {
  imageGridItemLayoutStyle,
  normalizeImageVariants,
  responsiveImageStyle,
  resolveImageGridConstrained,
  resolveImageGridLayouts,
  type ImageGridConstrained,
  type ImageGridLayouts,
  type ImageSourceDims,
  type ImageVariant,
  type ImageVariants,
  type ImageViewport,
  IMAGE_VIEWPORTS,
} from './responsiveImage';
import {
  resolveImageCaptionPosition,
  resolveImageCaptionReveals,
  resolveImageCaptionStyle,
  resolveImageCaptions,
  type ImageCaptionPositionId,
  type ImageCaptionReveal,
  type ImageCaptionReveals,
  type ImageCaptionStyleId,
  type ImageCaptions,
} from './imageCaptions';
import { PLACEHOLDER_IMAGE_VARIANTS } from './projectImageDefaults';
import { normalizeImageBackground } from './imageBackground.mjs';

export function isPlaceholderSrc(src: string): boolean {
  return src === 'placeholder.svg' || src.endsWith('/placeholder.svg');
}

/** Keep live media chrome in sync when an editor changes the source in place. */
export function syncPlaceholderState(
  target: HTMLElement,
  src: string,
  slot: 'cover' | 'hover' = 'cover',
): boolean {
  if (slot === 'hover') return false;
  const placeholder = isPlaceholderSrc(src);
  if (
    target.classList.contains('project-media')
    || target.classList.contains('project-image')
    || target.classList.contains('project-image-grid__item')
    || target.classList.contains('project-image-carousel__slide')
  ) {
    target.classList.toggle('project-media--placeholder', placeholder);
  }

  target.querySelectorAll<HTMLElement>('.project-media__placeholder-label').forEach((label) => {
    label.hidden = !placeholder;
    label.style.display = placeholder ? '' : 'none';
  });
  return placeholder;
}

/** Replace source dimensions without allowing metadata from the previous image to linger. */
export function syncImageSourceDims(
  target: HTMLElement,
  dims?: { srcWidth?: number; srcHeight?: number },
): void {
  const frame = target.querySelector<HTMLElement>(':scope > .project-image-grid__frame');
  for (const element of frame ? [target, frame] : [target]) {
    delete element.dataset.originalRatioLocked;
    if (dims?.srcWidth && dims?.srcHeight) {
      element.style.setProperty('--project-image-original-ratio', `${dims.srcWidth} / ${dims.srcHeight}`);
      element.style.setProperty('--project-image-original-ratio-num', String(dims.srcWidth / dims.srcHeight));
    } else {
      element.style.removeProperty('--project-image-original-ratio');
      element.style.removeProperty('--project-image-original-ratio-num');
    }
  }
  if (dims?.srcWidth && dims?.srcHeight) {
    target.dataset.devImageSrcWidth = String(dims.srcWidth);
    target.dataset.devImageSrcHeight = String(dims.srcHeight);
  } else {
    delete target.dataset.devImageSrcWidth;
    delete target.dataset.devImageSrcHeight;
  }
}

const VARIANT_FIELDS = ['aspect', 'cx', 'cy', 'w', 'aspectRatio', 'x', 'y', 'zoom'] as const;

export function hasCropVariants(variants: ImageVariants | undefined): boolean {
  return !!variants && Object.values(variants).some(
    (variant) => !!variant && VARIANT_FIELDS.some((field) => variant[field] !== undefined),
  );
}

export function suppliedImageVariants(
  src: string,
  variants: ImageVariants | undefined,
): ImageVariants | undefined {
  if (variants) return variants;
  if (isPlaceholderSrc(src)) return PLACEHOLDER_IMAGE_VARIANTS;
  return undefined;
}

/** Read `srcWidth`/`srcHeight` off an image node, if the migration stamped them. */
export function imageSourceDims(node: {
  srcWidth?: unknown;
  srcHeight?: unknown;
} | null | undefined): ImageSourceDims | null {
  const width = Number(node?.srcWidth);
  const height = Number(node?.srcHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function resolveInlineImageCrop(
  src: string,
  variants: ImageVariants | undefined,
  options?: {
    lead?: boolean;
    defaultAspectRatio?: string;
    srcDims?: ImageSourceDims | null;
  },
): { hasCrop: boolean; normalized: Record<ImageViewport, ImageVariant> | undefined } {
  const effective = suppliedImageVariants(src, variants);
  const hasCrop = hasCropVariants(effective);
  const normalized = hasCrop
    ? normalizeImageVariants(
      effective,
      options?.lead ? '16:10' : (options?.defaultAspectRatio ?? '1:1'),
      options?.srcDims,
    )
    : undefined;
  return { hasCrop, normalized };
}

export function resolveGridItemCrop(
  item: {
    src: string;
    variants?: ImageVariants;
    srcWidth?: unknown;
    srcHeight?: unknown;
  },
  defaultAspectRatio: string,
): {
  hasOwnVariants: boolean;
  variants: Record<ImageViewport, ImageVariant>;
  style: string;
} {
  const hasOwnVariants = !!item.variants;
  const srcDims = imageSourceDims(item);
  const variants = normalizeImageVariants(
    hasOwnVariants ? item.variants : undefined,
    defaultAspectRatio,
    srcDims,
  );
  return {
    hasOwnVariants,
    variants,
    style: responsiveImageStyle(variants, srcDims),
  };
}

/** Allowed max view-height caps (% of `--vh-safe`). Matches grid width steps. */
export const MAX_VH_PERCENTS = [90, 80, 70, 60, 50, 40, 30] as const;
export type MaxVhPercent = (typeof MAX_VH_PERCENTS)[number];

const MAX_VH_SET = new Set<number>(MAX_VH_PERCENTS);

/** Resolve `maxVh` from content; `max80: true` still maps to 80. */
export function resolveMaxVh(source: {
  maxVh?: unknown;
  max80?: unknown;
} | null | undefined): MaxVhPercent | undefined {
  if (!source) return undefined;
  const raw = source.maxVh;
  if (raw === false || raw === null || raw === '' || raw === 0) return undefined;
  if (typeof raw === 'number' || typeof raw === 'string') {
    const n = Math.round(Number(raw));
    if (MAX_VH_SET.has(n)) return n as MaxVhPercent;
  }
  if (source.max80 === true) return 80;
  return undefined;
}

export function maxVhStyle(maxVh: MaxVhPercent | undefined): string | undefined {
  return maxVh ? `--project-max-vh:${maxVh}` : undefined;
}

export function joinMediaStyles(...parts: Array<string | undefined | false | null>): string | undefined {
  const joined = parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(';');
  return joined || undefined;
}

export interface ImageDevEditContext {
  documentKey: string;
  path: Array<string | number>;
  cropId: string;
  variants: ImageVariants | undefined;
  /** Sparse authored variants, kept separate from the resolved render map. */
  authoredVariants?: ImageVariants;
  src?: string;
  srcWidth?: number;
  srcHeight?: number;
  captions?: Partial<ImageCaptions> | string;
  caption?: string;
  captionStyle?: ImageCaptionStyleId;
  captionPosition?: ImageCaptionPositionId;
  captionReveal?: ImageCaptionReveal | Partial<ImageCaptionReveals>;
  gridDefaultAspect?: string;
  hasOwnVariants?: boolean;
  /** Standalone image block width constraint (per-breakpoint % or legacy boolean). */
  constrained?: ImageGridConstrained;
  /** Original sparse width constraint authoring, separate from resolved CSS values. */
  authoredConstrained?: ImageGridConstrained;
  /** Centre the constrained block in its stack column. */
  centered?: boolean;
  /** Cap rendered height at N% of the viewport (`maxVh`). */
  maxVh?: MaxVhPercent;
  /** Opt a full-width mobile image back into the page gutter. */
  mobileInset?: boolean;
  background?: string;
}

/** Per-viewport default frame aspects for gallery listing covers (seed only). */
export function listingCoverDefaultAspects(
  grid: 'home' | 'work' | 'play',
  full: boolean,
): Record<ImageViewport, string> {
  const desktopTablet = grid === 'work' && full ? '16:9' : '4:3';
  const mobile = grid === 'home' ? '4:3' : '1:1';
  return { desktop: desktopTablet, tablet: desktopTablet, mobile };
}

function seedHoverVariants(
  coverVariants: Record<ImageViewport, ImageVariant>,
  hoverVariants: ImageVariants | undefined,
  hoverSrcAspect: number | null,
): Record<ImageViewport, ImageVariant> {
  const fallbackAspects = IMAGE_VIEWPORTS.reduce((result, viewport) => {
    result[viewport] = coverVariants[viewport].aspect;
    return result;
  }, {} as Record<ImageViewport, string>);
  const resolved = normalizeImageVariants(
    hoverVariants,
    fallbackAspects,
    hoverSrcAspect ? { width: hoverSrcAspect, height: 1 } : undefined,
  );
  return IMAGE_VIEWPORTS.reduce((result, viewport) => {
    result[viewport] = { ...resolved[viewport], aspect: coverVariants[viewport].aspect };
    return result;
  }, {} as Record<ImageViewport, ImageVariant>);
}

/** Listing-cover crop attrs — shared by ProjectGrid SSR and Gallery Manager fill. */
export function listingCoverDevEditAttrs(
  slug: string,
  grid: 'home' | 'work' | 'play',
  item: {
    image?: string;
    hoverImage?: string;
    variants?: ImageVariants;
    hoverVariants?: ImageVariants;
    srcWidth?: unknown;
    srcHeight?: unknown;
    mobileInset?: boolean;
  },
  full: boolean,
): Record<string, string> {
  const defaultAspects = listingCoverDefaultAspects(grid, full);
  const srcDims = imageSourceDims(item);
  const seedCoverVariants = normalizeImageVariants(item.variants, defaultAspects, srcDims);
  const seededHoverVariants = seedHoverVariants(seedCoverVariants, item.hoverVariants, null);
  const attrs = imageDevEditAttrs(true, {
    documentKey: slug,
    path: ['listings', grid],
    cropId: `listing-${grid}`,
    variants: seedCoverVariants,
    authoredVariants: item.variants ?? {},
    src: item.image,
    srcWidth: Number(item.srcWidth),
    srcHeight: Number(item.srcHeight),
    hasOwnVariants: hasCropVariants(item.variants),
    mobileInset: item.mobileInset,
  }) ?? {};
  if (item.hoverImage) attrs['data-dev-hover-image-src'] = item.hoverImage;
  attrs['data-dev-listing-default-aspects'] = JSON.stringify(defaultAspects);
  attrs['data-dev-hover-variants'] = JSON.stringify(seededHoverVariants);
  attrs['data-dev-hover-variants-authored'] = JSON.stringify(item.hoverVariants ?? {});
  return attrs;
}

export function imageDevEditAttrs(
  editable: boolean,
  context: ImageDevEditContext,
): Record<string, string> | undefined {
  if (!editable) return undefined;

  const captions = resolveImageCaptions({
    caption: context.caption,
    captions: context.captions,
  });
  const captionStyle = resolveImageCaptionStyle(context.captionStyle);
  const captionPosition = resolveImageCaptionPosition(context.captionPosition, captionStyle);
  const captionReveals = resolveImageCaptionReveals(context.captionReveal);

  const attrs: Record<string, string> = {
    'data-dev-image-target': 'image',
    'data-dev-document': context.documentKey,
    'data-dev-image-path': JSON.stringify(context.path),
    'data-dev-crop-id': context.cropId,
    'data-dev-image-variants': JSON.stringify(context.variants ?? {}),
    'data-dev-image-variants-authored': JSON.stringify(context.authoredVariants ?? context.variants ?? {}),
    'data-dev-captions': JSON.stringify(captions),
    'data-dev-caption-style': captionStyle,
    'data-dev-caption-position': captionPosition,
    'data-dev-caption-reveals': JSON.stringify(captionReveals),
    'data-dev-image-background': normalizeImageBackground(context.background) ?? 'transparent',
  };
  const authoredConstrained = Object.prototype.hasOwnProperty.call(context, 'authoredConstrained')
    ? (context.authoredConstrained === undefined
      ? {}
      : (context.authoredConstrained && typeof context.authoredConstrained === 'object' && !Array.isArray(context.authoredConstrained)
        ? structuredClone(context.authoredConstrained)
        : { desktop: resolveImageGridConstrained(context.authoredConstrained).desktop }))
    : {};
  attrs['data-dev-image-constrained-authored'] = JSON.stringify(authoredConstrained);
  if (context.src) attrs['data-dev-image-src'] = context.src;
  if (context.srcWidth) attrs['data-dev-image-src-width'] = String(context.srcWidth);
  if (context.srcHeight) attrs['data-dev-image-src-height'] = String(context.srcHeight);

  if (context.gridDefaultAspect) {
    attrs['data-dev-grid-default-aspect'] = context.gridDefaultAspect;
  }
  if (context.hasOwnVariants) {
    attrs['data-dev-has-own-variants'] = 'true';
  }
  if (context.constrained !== undefined && context.constrained !== false) {
    const resolved = resolveImageGridConstrained(context.constrained);
    attrs['data-dev-constrained'] = JSON.stringify(resolved);
  } else if (context.constrained === false) {
    attrs['data-dev-constrained'] = JSON.stringify(resolveImageGridConstrained(false));
  }
  if (typeof context.centered === 'boolean') {
    attrs['data-dev-centered'] = context.centered ? 'true' : 'false';
  }
  if (context.maxVh) {
    attrs['data-dev-max-vh'] = String(context.maxVh);
  } else {
    attrs['data-dev-max-vh'] = '';
  }
  attrs['data-mobile-inset'] = context.mobileInset === true ? 'true' : 'false';

  return attrs;
}

export function resolveGridItemLayout(
  itemIds: string[],
  layouts: ImageGridLayouts | undefined,
) {
  return resolveImageGridLayouts(itemIds, layouts ?? {});
}

export function gridItemLayoutStyle(
  itemId: string,
  resolvedLayouts: ReturnType<typeof resolveImageGridLayouts>,
): string {
  return imageGridItemLayoutStyle(itemId, resolvedLayouts);
}
