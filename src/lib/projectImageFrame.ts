import {
  imageGridItemLayoutStyle,
  normalizeImageVariants,
  responsiveImageStyle,
  resolveImageGridLayouts,
  type ImageGridLayouts,
  type ImageVariants,
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

export function isPlaceholderSrc(src: string): boolean {
  return src === 'placeholder.svg' || src.endsWith('/placeholder.svg');
}

export function hasCropVariants(variants: ImageVariants | undefined): boolean {
  return !!variants && Object.values(variants).some(
    (variant) => variant && (variant.aspectRatio || variant.x || variant.y || variant.zoom),
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

export function resolveInlineImageCrop(
  src: string,
  variants: ImageVariants | undefined,
  options?: {
    lead?: boolean;
    defaultAspectRatio?: string;
    crop?: { x?: number; y?: number; zoom?: number };
  },
): { hasCrop: boolean; normalized: ImageVariants | undefined } {
  const effective = suppliedImageVariants(src, variants);
  const hasCrop = hasCropVariants(effective);
  const normalized = hasCrop
    ? normalizeImageVariants(
      effective,
      options?.lead ? '16:10' : (options?.defaultAspectRatio ?? '1:1'),
      options?.crop,
    )
    : undefined;
  return { hasCrop, normalized };
}

export function resolveGridItemCrop(
  item: {
    src: string;
    variants?: ImageVariants;
    crop?: { x?: number; y?: number; zoom?: number };
  },
  defaultAspectRatio: string,
): {
  hasOwnVariants: boolean;
  variants: ImageVariants;
  style: string;
} {
  const hasOwnVariants = !!item.variants;
  const variants = normalizeImageVariants(
    hasOwnVariants ? item.variants : undefined,
    defaultAspectRatio,
    item.crop,
  );
  return {
    hasOwnVariants,
    variants,
    style: responsiveImageStyle(variants),
  };
}

export interface ImageDevEditContext {
  documentKey: string;
  path: Array<string | number>;
  cropId: string;
  variants: ImageVariants | undefined;
  captions?: Partial<ImageCaptions> | string;
  caption?: string;
  captionStyle?: ImageCaptionStyleId;
  captionPosition?: ImageCaptionPositionId;
  captionReveal?: ImageCaptionReveal | Partial<ImageCaptionReveals>;
  gridDefaultAspect?: string;
  hasOwnVariants?: boolean;
  /** Standalone image block width constraint (80% desktop). */
  constrained?: boolean;
  /** Centre the constrained block in its stack column. */
  centered?: boolean;
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
  const captionPosition = resolveImageCaptionPosition(context.captionPosition);
  const captionReveals = resolveImageCaptionReveals(context.captionReveal);

  const attrs: Record<string, string> = {
    'data-dev-image-target': 'image',
    'data-dev-document': context.documentKey,
    'data-dev-image-path': JSON.stringify(context.path),
    'data-dev-crop-id': context.cropId,
    'data-dev-image-variants': JSON.stringify(context.variants ?? {}),
    'data-dev-captions': JSON.stringify(captions),
    'data-dev-caption-style': captionStyle,
    'data-dev-caption-position': captionPosition,
    'data-dev-caption-reveals': JSON.stringify(captionReveals),
  };

  if (context.gridDefaultAspect) {
    attrs['data-dev-grid-default-aspect'] = context.gridDefaultAspect;
  }
  if (context.hasOwnVariants) {
    attrs['data-dev-has-own-variants'] = 'true';
  }
  if (typeof context.constrained === 'boolean') {
    attrs['data-dev-constrained'] = context.constrained ? 'true' : 'false';
  }
  if (typeof context.centered === 'boolean') {
    attrs['data-dev-centered'] = context.centered ? 'true' : 'false';
  }

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
