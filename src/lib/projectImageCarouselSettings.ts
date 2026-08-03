import { IMAGE_VIEWPORTS, type ImageViewport } from './responsiveImage';

export type CarouselOrientation = 'horizontal' | 'vertical';
export type CarouselHeightMode = 'dynamic' | 'tallest';
export type CarouselDotsPlacement = 'outside' | 'over' | 'hidden';

const HEIGHT_MODES = new Set<CarouselHeightMode>(['dynamic', 'tallest']);
const DOTS = new Set<CarouselDotsPlacement>(['outside', 'over', 'hidden']);
const MAX_VH_STEPS = new Set([90, 80, 70, 60, 50, 40, 30]);

/** Sparse per-breakpoint overrides (tablet/mobile). Desktop uses top-level fields. */
export interface CarouselBreakpointOverride {
  heightMode?: CarouselHeightMode;
  /** `null` / `0` = explicit off. Omit to inherit. */
  maxHeightVh?: number | null;
  scrollPinned?: boolean;
  dotsPlacement?: CarouselDotsPlacement;
  visible?: string[];
}

/** Shape stored on the content section (legacy scalars + optional overrides). */
export interface CarouselSettingsSource {
  orientation?: CarouselOrientation;
  heightMode?: CarouselHeightMode;
  maxHeightVh?: number;
  scrollPinned?: boolean;
  dotsPlacement?: CarouselDotsPlacement;
  visible?: string[];
  breakpoints?: Partial<Record<'tablet' | 'mobile', CarouselBreakpointOverride>>;
}

export interface ResolvedCarouselBreakpoint {
  heightMode: CarouselHeightMode;
  maxHeightVh: number | null;
  scrollPinned: boolean;
  dotsPlacement: CarouselDotsPlacement;
  visible: string[];
  /** True when this viewport has a saved override (not pure inheritance). */
  overridden: boolean;
}

export interface ResolvedCarouselSettings {
  orientation: CarouselOrientation;
  byViewport: Record<ImageViewport, ResolvedCarouselBreakpoint>;
}

export function matchCarouselViewport(
  width = typeof window !== 'undefined' ? window.innerWidth : 1200,
): ImageViewport {
  if (width <= 767) return 'mobile';
  if (width <= 991) return 'tablet';
  return 'desktop';
}

export function sanitizeCarouselVisible(itemIds: string[], raw: unknown): string[] {
  const known = new Set(itemIds);
  if (!Array.isArray(raw)) return [...itemIds];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of raw) {
    const id = String(entry || '');
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next.length ? next : [...itemIds];
}

const asHeightMode = (value: unknown, fallback: CarouselHeightMode): CarouselHeightMode => (
  HEIGHT_MODES.has(value as CarouselHeightMode) ? (value as CarouselHeightMode) : fallback
);

const asDots = (value: unknown, fallback: CarouselDotsPlacement): CarouselDotsPlacement => (
  DOTS.has(value as CarouselDotsPlacement) ? (value as CarouselDotsPlacement) : fallback
);

const asMaxVh = (value: unknown): number | null => {
  if (value === null || value === '' || value === undefined) return null;
  const n = Math.round(Number(value));
  if (n === 0) return null;
  return MAX_VH_STEPS.has(n) ? n : null;
};

const visibleEqual = (a: string[], b: string[]) => (
  a.length === b.length && a.every((id, index) => id === b[index])
);

function applyOverride(
  base: ResolvedCarouselBreakpoint,
  override: CarouselBreakpointOverride | undefined,
  itemIds: string[],
): ResolvedCarouselBreakpoint {
  if (!override || typeof override !== 'object') {
    return { ...base, visible: [...base.visible], overridden: false };
  }
  const next: ResolvedCarouselBreakpoint = {
    heightMode: base.heightMode,
    maxHeightVh: base.maxHeightVh,
    scrollPinned: base.scrollPinned,
    dotsPlacement: base.dotsPlacement,
    visible: [...base.visible],
    overridden: true,
  };
  if (override.heightMode !== undefined) {
    next.heightMode = asHeightMode(override.heightMode, base.heightMode);
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxHeightVh')) {
    next.maxHeightVh = asMaxVh(override.maxHeightVh);
  }
  if (override.scrollPinned !== undefined) {
    next.scrollPinned = override.scrollPinned === true;
  }
  if (override.dotsPlacement !== undefined) {
    next.dotsPlacement = asDots(override.dotsPlacement, base.dotsPlacement);
  }
  if (Array.isArray(override.visible)) {
    next.visible = sanitizeCarouselVisible(itemIds, override.visible);
  }
  return next;
}

/** Resolve legacy top-level fields + sparse breakpoint overrides (waterfall). */
export function resolveCarouselSettings(
  source: CarouselSettingsSource | null | undefined,
  itemIds: string[],
): ResolvedCarouselSettings {
  const orientation = source?.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const desktop: ResolvedCarouselBreakpoint = {
    heightMode: asHeightMode(source?.heightMode, 'dynamic'),
    maxHeightVh: asMaxVh(source?.maxHeightVh),
    scrollPinned: source?.scrollPinned === true,
    dotsPlacement: asDots(source?.dotsPlacement, 'outside'),
    visible: sanitizeCarouselVisible(itemIds, source?.visible),
    // Desktop is the root — always "owned", never shows the inherit banner.
    overridden: true,
  };

  const tablet = applyOverride(desktop, source?.breakpoints?.tablet, itemIds);
  const mobile = applyOverride(tablet, source?.breakpoints?.mobile, itemIds);

  return {
    orientation,
    byViewport: { desktop, tablet, mobile },
  };
}

/** Diff a child viewport against its parent into a sparse override (or null). */
function diffBreakpoint(
  parent: ResolvedCarouselBreakpoint,
  child: ResolvedCarouselBreakpoint,
  itemIds: string[],
): CarouselBreakpointOverride | null {
  if (!child.overridden) return null;
  const out: CarouselBreakpointOverride = {};
  if (child.heightMode !== parent.heightMode) out.heightMode = child.heightMode;
  if (child.maxHeightVh !== parent.maxHeightVh) out.maxHeightVh = child.maxHeightVh;
  if (child.scrollPinned !== parent.scrollPinned) out.scrollPinned = child.scrollPinned;
  if (child.dotsPlacement !== parent.dotsPlacement) out.dotsPlacement = child.dotsPlacement;
  if (!visibleEqual(child.visible, parent.visible)) {
    out.visible = sanitizeCarouselVisible(itemIds, child.visible);
  }
  return Object.keys(out).length ? out : null;
}

/** Compress a resolved draft back into the content JSON shape. */
export function serializeCarouselSettings(
  orientation: CarouselOrientation,
  byViewport: Record<ImageViewport, ResolvedCarouselBreakpoint>,
  itemIds: string[],
): CarouselSettingsSource {
  const desktop = byViewport.desktop;
  const out: CarouselSettingsSource = {
    orientation: orientation === 'vertical' ? 'vertical' : 'horizontal',
  };

  // Prefer quiet JSON: omit defaults.
  if (desktop.heightMode !== 'dynamic') out.heightMode = desktop.heightMode;

  if (desktop.maxHeightVh) out.maxHeightVh = desktop.maxHeightVh;
  if (desktop.scrollPinned) out.scrollPinned = true;
  if (desktop.dotsPlacement !== 'outside') out.dotsPlacement = desktop.dotsPlacement;

  const defaultVisible = [...itemIds];
  if (!visibleEqual(desktop.visible, defaultVisible)) {
    out.visible = sanitizeCarouselVisible(itemIds, desktop.visible);
  }

  const breakpoints: NonNullable<CarouselSettingsSource['breakpoints']> = {};
  const tabletDiff = diffBreakpoint(desktop, byViewport.tablet, itemIds);
  const mobileDiff = diffBreakpoint(byViewport.tablet, byViewport.mobile, itemIds);
  if (tabletDiff) breakpoints.tablet = tabletDiff;
  if (mobileDiff) breakpoints.mobile = mobileDiff;
  if (breakpoints.tablet || breakpoints.mobile) out.breakpoints = breakpoints;

  return out;
}

export { IMAGE_VIEWPORTS };
export type { ImageViewport };
