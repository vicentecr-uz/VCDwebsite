import { projectImage } from '../lib/images';
import {
  imageGridColumnsStyle,
  imageGridConstrainedStyle,
  imageHasWidthConstraint,
  responsiveImageStyle,
  resolveImageGridColumns,
  resolveImageGridConstrained,
  type ImageVariants,
} from '../lib/responsiveImage';
import {
  gridItemLayoutStyle,
  imageDevEditAttrs,
  imageSourceDims,
  isPlaceholderSrc,
  joinMediaStyles,
  maxVhStyle,
  resolveGridItemCrop,
  resolveGridItemLayout,
  resolveInlineImageCrop,
  resolveMaxVh,
} from '../lib/projectImageFrame';
import { bindProjectCropCovers } from '../lib/projectCropCover';
import {
  appendPlaceholderLabel,
  bindAllPlaceholderLabels,
} from '../lib/placeholderLabel';
import {
  bindProjectImageCarousels,
  carouselDotAppearance,
  carouselDotGeometry,
} from '../lib/projectImageCarousel';
import {
  resolveCarouselSettings,
  serializeCarouselSettings,
  type CarouselSettingsSource,
} from '../lib/projectImageCarouselSettings';
import { projectStackClass, spacingDevAttrs, type ProjectStackSpacing } from '../lib/projectStack';
import { imageBackgroundStyle, normalizeImageBackground } from '../lib/imageBackground.mjs';
import { isVideoSrc } from '../lib/imageUpload.mjs';
import { createInlineVideo } from '../lib/inlineVideo';

export type MountedSection = Record<string, unknown>;

const appendEditTriggers = (target: HTMLElement) => {
  const caption = document.createElement('button');
  caption.type = 'button';
  caption.className = 'dev-caption-add-trigger';
  caption.setAttribute('data-dev-edit-trigger', 'caption');
  caption.setAttribute('data-caption-action', 'add');
  caption.setAttribute('data-dev-mode-only', '');
  caption.hidden = true;
  caption.textContent = 'Add caption';

  const image = document.createElement('button');
  image.type = 'button';
  image.className = 'dev-image-edit-trigger';
  image.setAttribute('data-dev-edit-trigger', 'image');
  image.setAttribute('data-dev-mode-only', '');
  image.hidden = true;
  image.textContent = 'Edit image';

  target.append(caption);
  target.append(image);
};

const applyDataAttrs = (element: HTMLElement, attrs: Record<string, string> | undefined) => {
  if (!attrs) return;
  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
};

const buildInlineImageFigure = (
  section: MountedSection,
  documentKey: string,
  sectionPath: Array<string | number>,
) => {
  const src = String(section.src ?? '');
  const variants = section.variants as ImageVariants | undefined;
  const srcDims = imageSourceDims(section);
  const { hasCrop, normalized } = resolveInlineImageCrop(src, variants, { srcDims });
  const cropId = String(section.id ?? 'image');
  const placeholder = isPlaceholderSrc(src);
  const video = isVideoSrc(src);
  const resolvedConstrained = resolveImageGridConstrained(section.constrained as never);
  const hasWidthConstraint = imageHasWidthConstraint(resolvedConstrained);
  const centered = section.centered === true || hasWidthConstraint;
  const maxVh = resolveMaxVh(section);
  const mobileInset = section.mobileInset === true;
  const background = normalizeImageBackground(section.background) ?? 'transparent';
  const editAttrs = imageDevEditAttrs(true, {
    documentKey,
    path: sectionPath,
    cropId,
    variants: normalized,
    authoredVariants: variants ?? {},
    src,
    srcWidth: Number(section.srcWidth),
    srcHeight: Number(section.srcHeight),
    constrained: section.constrained as never,
    authoredConstrained: section.constrained as never,
    centered,
    maxVh,
    mobileInset,
    background,
  });

  const figure = document.createElement('figure');
  figure.className = [
    'project-media',
    hasWidthConstraint && 'project-media--constrained',
    maxVh && 'project-media--max-vh',
    hasCrop && 'project-cropped project-responsive-image',
    'dev-image-edit-target',
    placeholder && 'project-media--placeholder',
  ].filter(Boolean).join(' ');
  figure.style.cssText = joinMediaStyles(
    normalized ? responsiveImageStyle(normalized, srcDims) : undefined,
    maxVhStyle(maxVh),
    imageGridConstrainedStyle(resolvedConstrained),
    imageBackgroundStyle(background),
  ) ?? '';
  applyDataAttrs(figure, editAttrs);
  figure.dataset.mobileInset = mobileInset ? 'true' : 'false';
  figure.dataset.mobileBleedEligible = !maxVh && resolvedConstrained.mobile === 100 ? 'true' : 'false';

  const img = video
    ? createInlineVideo(projectImage(src), String(section.alt ?? ''))
    : document.createElement('img');
  if (!video) img.src = projectImage(src);
  img.className = [
    'project-media__img',
    // Cropped frames size the bitmap via the crop CSS; the img-level max-vh
    // class would clamp and letterbox it (uncropped images still need it).
    maxVh && !hasCrop && 'project-media__img--max-vh',
  ].filter(Boolean).join(' ');
  if (video) {
    img.classList.add('project-inline-video');
  } else {
    (img as HTMLImageElement).alt = String(section.alt ?? '');
    (img as HTMLImageElement).loading = 'lazy';
  }
  if (hasCrop) {
    const clip = document.createElement('div');
    clip.className = 'project-crop-clip';
    clip.append(img);
    if (placeholder) {
      appendPlaceholderLabel(clip, {
        alt: String(section.alt ?? ''),
        documentKey,
        path: sectionPath,
      });
    }
    figure.append(clip);
  } else {
    figure.append(img);
    if (placeholder) {
      appendPlaceholderLabel(figure, {
        alt: String(section.alt ?? ''),
        documentKey,
        path: sectionPath,
      });
    }
  }
  appendEditTriggers(figure);
  return figure;
};

export function mountImageSection(
  section: MountedSection,
  documentKey: string,
  index: number,
): HTMLElement {
  const spacing = (section.spacing ?? 'group') as ProjectStackSpacing;
  const sectionPath = ['sections', index];
  const resolvedConstrained = resolveImageGridConstrained(section.constrained as never);
  const hasWidthConstraint = imageHasWidthConstraint(resolvedConstrained);
  const maxVh = resolveMaxVh(section);
  const block = document.createElement('div');
  block.className = [
    'project-block',
    projectStackClass(spacing),
    (hasWidthConstraint || maxVh || section.centered === true) && 'project-block--centered',
  ].filter(Boolean).join(' ');
  applyDataAttrs(block, spacingDevAttrs(documentKey, sectionPath, spacing, { contentId: String(section.id ?? '') }));
  block.setAttribute('data-dev-section-deletable', 'image');
  block.append(buildInlineImageFigure(section, documentKey, sectionPath));
  return block;
}

export function mountImageGridSection(
  section: MountedSection,
  documentKey: string,
  index: number,
): HTMLElement {
  const spacing = (section.spacing ?? 'group') as ProjectStackSpacing;
  const sectionPath = ['sections', index];
  const items = Array.isArray(section.items) ? section.items as MountedSection[] : [];
  const columns = resolveImageGridColumns(section.columns as never);
  const constrained = resolveImageGridConstrained(section.constrained as never);
  const defaultAspectRatio = String(section.defaultAspectRatio ?? '4:3');
  const matchHeight = section.matchHeight === true;
  const layouts = (section.layouts && typeof section.layouts === 'object')
    ? section.layouts as Record<string, { visible?: string[] }>
    : {};
  const itemIds = items.map((item, itemIndex) => String(item.id ?? `item-${itemIndex}`));
  const resolvedLayouts = resolveGridItemLayout(itemIds, layouts);
  const editorItems = items.map((item, itemIndex) => ({
    id: itemIds[itemIndex],
    src: projectImage(String(item.src ?? '')),
    alt: String(item.alt ?? ''),
    background: normalizeImageBackground(item.background) ?? 'transparent',
  }));

  const grid = document.createElement('div');
  grid.className = [
    'project-image-grid',
    matchHeight && 'project-image-grid--match-height',
    projectStackClass(spacing),
    'dev-grid-edit-target',
  ].filter(Boolean).join(' ');
  grid.style.cssText = `${imageGridColumnsStyle(columns)};${imageGridConstrainedStyle(constrained)};`;
  grid.setAttribute('data-match-height', matchHeight ? 'true' : 'false');
  grid.setAttribute('data-dev-grid-target', 'grid');
  grid.setAttribute('data-dev-document', documentKey);
  grid.setAttribute('data-dev-grid-path', JSON.stringify(sectionPath));
  grid.setAttribute('data-dev-grid-columns', JSON.stringify(columns));
  grid.setAttribute('data-dev-grid-constrained', JSON.stringify(constrained));
  grid.setAttribute('data-dev-grid-default-aspect', defaultAspectRatio);
  grid.setAttribute('data-dev-grid-match-height', matchHeight ? 'true' : 'false');
  grid.setAttribute('data-dev-grid-layouts', JSON.stringify(layouts));
  grid.setAttribute('data-dev-grid-items', JSON.stringify(editorItems));
  applyDataAttrs(grid, spacingDevAttrs(documentKey, sectionPath, spacing, { contentId: String(section.id ?? '') }));
  grid.setAttribute('data-dev-section-deletable', 'imageGrid');

  const gridEdit = document.createElement('button');
  gridEdit.type = 'button';
  gridEdit.className = 'dev-grid-edit-trigger';
  gridEdit.setAttribute('data-dev-edit-trigger', 'grid');
  gridEdit.setAttribute('data-dev-corner', 'top-left');
  gridEdit.setAttribute('data-dev-mode-only', '');
  gridEdit.hidden = true;
  gridEdit.textContent = 'Edit grid';
  grid.append(gridEdit);

  items.forEach((item, itemIndex) => {
    const itemId = itemIds[itemIndex];
    const mobileVisibleIndex = resolvedLayouts.mobile.visible.indexOf(itemId);
    const mobileBleedEligible = constrained.mobile === 100 && (
      columns.mobile === 1
      || (matchHeight && columns.mobile > 1
        && resolvedLayouts.mobile.visible.length % columns.mobile === 1
        && mobileVisibleIndex === resolvedLayouts.mobile.visible.length - 1)
    );
    if (item.type === 'imageCarousel' && Array.isArray(item.items)) {
      const cell = document.createElement('div');
      cell.className = 'project-image-grid__item';
      cell.style.cssText = gridItemLayoutStyle(itemId, resolvedLayouts);
      cell.setAttribute('data-grid-item-id', itemId);
      cell.setAttribute('data-grid-hidden-desktop', resolvedLayouts.desktop.hidden.includes(itemId) ? 'true' : 'false');
      cell.setAttribute('data-grid-hidden-tablet', resolvedLayouts.tablet.hidden.includes(itemId) ? 'true' : 'false');
      cell.setAttribute('data-grid-hidden-mobile', resolvedLayouts.mobile.hidden.includes(itemId) ? 'true' : 'false');
      cell.dataset.mobileBleedEligible = mobileBleedEligible ? 'true' : 'false';
      cell.append(mountImageCarouselSection(item, documentKey, [...sectionPath, 'items', itemIndex], true));
      grid.append(cell);
      return;
    }
    const { hasOwnVariants, variants, style: variantStyle } = resolveGridItemCrop(
      {
        src: String(item.src ?? ''),
        variants: item.variants as ImageVariants | undefined,
        srcWidth: item.srcWidth,
        srcHeight: item.srcHeight,
      },
      defaultAspectRatio,
    );
    const layoutStyle = gridItemLayoutStyle(itemId, resolvedLayouts);
    const placeholder = isPlaceholderSrc(String(item.src ?? ''));
    const video = isVideoSrc(String(item.src ?? ''));
    const editAttrs = imageDevEditAttrs(true, {
      documentKey,
      path: [...sectionPath, 'items', itemIndex],
      cropId: itemId,
      variants,
      authoredVariants: item.variants as ImageVariants ?? {},
      src: String(item.src ?? ''),
      srcWidth: Number(item.srcWidth),
      srcHeight: Number(item.srcHeight),
      gridDefaultAspect: defaultAspectRatio,
      hasOwnVariants,
      mobileInset: item.mobileInset === true,
      background: normalizeImageBackground(item.background) ?? 'transparent',
    });

    const figure = document.createElement('figure');
    figure.className = [
      'project-image-grid__item',
      'project-responsive-image',
      'dev-image-edit-target',
      placeholder && 'project-media--placeholder',
    ].filter(Boolean).join(' ');
    figure.style.cssText = joinMediaStyles(variantStyle, layoutStyle, imageBackgroundStyle(item.background)) ?? '';
    figure.setAttribute('data-grid-item-id', itemId);
    figure.setAttribute('data-grid-hidden-desktop', resolvedLayouts.desktop.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-grid-hidden-tablet', resolvedLayouts.tablet.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-grid-hidden-mobile', resolvedLayouts.mobile.hidden.includes(itemId) ? 'true' : 'false');
    applyDataAttrs(figure, editAttrs);
    figure.dataset.mobileInset = item.mobileInset === true ? 'true' : 'false';
    figure.dataset.mobileBleedEligible = mobileBleedEligible ? 'true' : 'false';

    const img = video
      ? createInlineVideo(projectImage(String(item.src ?? '')), String(item.alt ?? ''))
      : document.createElement('img');
    if (!video) img.src = projectImage(String(item.src ?? ''));
    img.className = 'project-image-grid__image';
    if (video) {
      img.classList.add('project-inline-video');
    } else {
      (img as HTMLImageElement).alt = String(item.alt ?? '');
      (img as HTMLImageElement).loading = 'lazy';
    }

    const frame = document.createElement('div');
    frame.className = 'project-image-grid__frame';
    frame.append(img);
    if (placeholder) {
      appendPlaceholderLabel(frame, {
        alt: String(item.alt ?? ''),
        documentKey,
        path: [...sectionPath, 'items', itemIndex],
      });
    }

    const belowSlot = document.createElement('div');
    belowSlot.className = 'project-image-grid__below-slot';

    figure.append(frame, belowSlot);
    appendEditTriggers(figure);
    grid.append(figure);
  });

  return grid;
}

function mountImageCarouselSection(
  section: MountedSection,
  documentKey: string,
  indexOrPath: number | Array<string | number>,
  nested = false,
): HTMLElement {
  const spacing = (section.spacing ?? 'group') as ProjectStackSpacing;
  const sectionPath = Array.isArray(indexOrPath) ? indexOrPath : ['sections', indexOrPath];
  const items = Array.isArray(section.items) ? section.items as MountedSection[] : [];
  const constrained = resolveImageGridConstrained(section.constrained as never);
  const defaultAspectRatio = String(section.defaultAspectRatio ?? 'original');
  const itemIds = items.map((item, itemIndex) => String(item.id ?? `item-${itemIndex}`));
  const settingsSource: CarouselSettingsSource = {
    orientation: section.orientation === 'vertical' ? 'vertical' : 'horizontal',
    heightMode: section.heightMode === 'tallest' ? 'tallest' : 'dynamic',
    maxHeightVh: typeof section.maxHeightVh === 'number' ? section.maxHeightVh : undefined,
    scrollPinned: section.scrollPinned === true,
    dotsPlacement: (
      section.dotsPlacement === 'over' || section.dotsPlacement === 'hidden'
        ? section.dotsPlacement
        : 'outside'
    ),
    visible: Array.isArray(section.visible)
      ? section.visible.map((value) => String(value))
      : undefined,
    breakpoints: (
      section.breakpoints
      && typeof section.breakpoints === 'object'
      && !Array.isArray(section.breakpoints)
    )
      ? section.breakpoints as CarouselSettingsSource['breakpoints']
      : undefined,
  };
  const resolved = resolveCarouselSettings(settingsSource, itemIds);
  const live = resolved.byViewport.desktop;
  const settingsJson = serializeCarouselSettings(
    resolved.orientation,
    resolved.byViewport,
    itemIds,
  );
  const visibleIds = live.visible;
  const parkedIds = itemIds.filter((id) => !visibleIds.includes(id));
  const orderedIds = [...visibleIds, ...parkedIds];
  const visibleCount = visibleIds.length;
  const dotGeometry = carouselDotGeometry(0, visibleCount);

  const editorItems = items.map((item, itemIndex) => ({
    id: itemIds[itemIndex],
    src: projectImage(String(item.src ?? '')),
    alt: String(item.alt ?? ''),
  }));

  const block = document.createElement('div');
  block.className = [
    'project-image-carousel',
    !nested && projectStackClass(spacing),
    'dev-carousel-edit-target',
  ].filter(Boolean).join(' ');
  block.style.cssText = [
    imageGridConstrainedStyle(constrained),
    live.maxHeightVh ? `--project-carousel-max-vh:${live.maxHeightVh}` : '',
  ].filter(Boolean).join(';');
  block.setAttribute('data-project-image-carousel', '');
  block.setAttribute('data-carousel-settings', JSON.stringify(settingsJson));
  block.setAttribute('data-orientation', resolved.orientation);
  block.setAttribute('data-height-mode', live.heightMode);
  block.setAttribute('data-scroll-pinned', live.scrollPinned ? 'true' : 'false');
  block.setAttribute('data-dots-placement', live.dotsPlacement);
  block.setAttribute('data-dev-carousel-target', 'carousel');
  block.setAttribute('data-dev-document', documentKey);
  block.setAttribute('data-dev-carousel-path', JSON.stringify(sectionPath));
  block.setAttribute('data-dev-carousel-orientation', resolved.orientation);
  block.setAttribute('data-dev-carousel-height-mode', live.heightMode);
  block.setAttribute('data-dev-carousel-max-vh', String(live.maxHeightVh ?? ''));
  block.setAttribute('data-dev-carousel-scroll-pinned', live.scrollPinned ? 'true' : 'false');
  block.setAttribute('data-dev-carousel-dots-placement', live.dotsPlacement);
  block.setAttribute('data-dev-carousel-constrained', JSON.stringify(constrained));
  block.setAttribute('data-dev-carousel-default-aspect', defaultAspectRatio);
  block.setAttribute('data-dev-carousel-items', JSON.stringify(editorItems));
  block.setAttribute('data-dev-carousel-visible', JSON.stringify(visibleIds));
  block.setAttribute('data-dev-carousel-settings', JSON.stringify(settingsJson));
  if (!nested) {
    applyDataAttrs(block, spacingDevAttrs(documentKey, sectionPath, spacing, { contentId: String(section.id ?? '') }));
    block.setAttribute('data-dev-section-deletable', 'imageCarousel');
  }

  const editTrigger = document.createElement('button');
  editTrigger.type = 'button';
  editTrigger.className = 'dev-grid-edit-trigger';
  editTrigger.setAttribute('data-dev-edit-trigger', 'carousel');
  editTrigger.setAttribute('data-dev-corner', 'top-left');
  editTrigger.setAttribute('data-dev-mode-only', '');
  editTrigger.hidden = true;
  editTrigger.textContent = 'Edit carousel';
  block.append(editTrigger);

  const media = document.createElement('div');
  media.className = 'project-image-carousel__media';

  const clip = document.createElement('div');
  clip.className = 'project-image-carousel__clip';
  clip.setAttribute('data-carousel-clip', '');

  const track = document.createElement('div');
  track.className = 'project-image-carousel__track';
  track.setAttribute('data-carousel-track', '');
  track.tabIndex = 0;
  track.setAttribute('role', 'group');
  track.setAttribute('aria-roledescription', 'carousel');
  track.setAttribute('aria-label', `Image carousel, ${visibleCount} images`);

  const itemById = new Map(items.map((item, itemIndex) => [itemIds[itemIndex], { item, itemIndex }]));

  orderedIds.forEach((id) => {
    const entry = itemById.get(id);
    if (!entry) return;
    const { item, itemIndex } = entry;
    const parked = !visibleIds.includes(id);
    const displayIndex = visibleIds.indexOf(id);
    const { hasOwnVariants, variants, style: variantStyle } = resolveGridItemCrop(
      {
        src: String(item.src ?? ''),
        variants: item.variants as ImageVariants | undefined,
        srcWidth: item.srcWidth,
        srcHeight: item.srcHeight,
      },
      defaultAspectRatio,
    );
    const maxVh = resolveMaxVh(item);
    const mobileInset = item.mobileInset === true;
    const placeholder = isPlaceholderSrc(String(item.src ?? ''));
    const video = isVideoSrc(String(item.src ?? ''));
    const editAttrs = imageDevEditAttrs(true, {
      documentKey,
      path: [...sectionPath, 'items', itemIndex],
      cropId: id,
      variants,
      authoredVariants: item.variants as ImageVariants ?? {},
      src: String(item.src ?? ''),
      srcWidth: Number(item.srcWidth),
      srcHeight: Number(item.srcHeight),
      gridDefaultAspect: defaultAspectRatio,
      hasOwnVariants,
      maxVh,
      mobileInset,
      background: normalizeImageBackground(item.background) ?? 'transparent',
    });

    const figure = document.createElement('figure');
    figure.className = [
      'project-image-carousel__slide',
      'project-image-grid__item',
      'project-responsive-image',
      placeholder && 'project-media--placeholder',
      'dev-image-edit-target',
    ].filter(Boolean).join(' ');
    figure.style.cssText = joinMediaStyles(variantStyle, maxVhStyle(maxVh), imageBackgroundStyle(item.background)) ?? '';
    figure.setAttribute('data-carousel-slide', '');
    if (!parked) figure.setAttribute('data-carousel-index', String(displayIndex));
    if (parked) figure.setAttribute('data-carousel-parked', 'true');
    if (maxVh) figure.setAttribute('data-max-vh', String(maxVh));
    figure.setAttribute('data-grid-item-id', id);
    figure.setAttribute('aria-roledescription', 'slide');
    if (!parked) figure.setAttribute('aria-label', `${displayIndex + 1} of ${visibleCount}`);
    if (parked) figure.setAttribute('aria-hidden', 'true');
    applyDataAttrs(figure, editAttrs);
    figure.dataset.mobileInset = mobileInset ? 'true' : 'false';
    figure.dataset.mobileBleedEligible = constrained.mobile === 100 && !maxVh ? 'true' : 'false';

    const surface = document.createElement('div');
    surface.className = 'project-image-carousel__surface';

    const frame = document.createElement('div');
    frame.className = 'project-image-grid__frame';
    frame.setAttribute('data-carousel-frame', '');

    const img = video
      ? createInlineVideo(projectImage(String(item.src ?? '')), String(item.alt ?? ''))
      : document.createElement('img');
    if (!video) img.src = projectImage(String(item.src ?? ''));
    img.className = 'project-image-grid__image';
    if (video) {
      img.classList.add('project-inline-video');
    } else {
      (img as HTMLImageElement).alt = String(item.alt ?? '');
      (img as HTMLImageElement).loading = displayIndex === 0 ? 'eager' : 'lazy';
    }
    frame.append(img);
    if (placeholder) {
      appendPlaceholderLabel(frame, {
        alt: String(item.alt ?? ''),
        documentKey,
        path: [...sectionPath, 'items', itemIndex],
      });
    }
    surface.append(frame);

    const captionAdd = document.createElement('button');
    captionAdd.type = 'button';
    captionAdd.className = 'dev-caption-add-trigger';
    captionAdd.setAttribute('data-dev-edit-trigger', 'caption');
    captionAdd.setAttribute('data-caption-action', 'add');
    captionAdd.setAttribute('data-dev-mode-only', '');
    captionAdd.hidden = true;
    captionAdd.textContent = 'Add caption';

    const imageEdit = document.createElement('button');
    imageEdit.type = 'button';
    imageEdit.className = 'dev-image-edit-trigger';
    imageEdit.setAttribute('data-dev-edit-trigger', 'image');
    imageEdit.setAttribute('data-dev-mode-only', '');
    imageEdit.hidden = true;
    imageEdit.textContent = 'Edit image';

    surface.append(captionAdd, imageEdit);
    figure.append(surface);
    track.append(figure);
  });

  clip.append(track);
  media.append(clip);

  const dots = document.createElement('div');
  dots.className = 'project-image-carousel__dots';
  dots.setAttribute('data-carousel-dots', '');
  dots.hidden = visibleCount < 2;

  const dotWindow = document.createElement('div');
  dotWindow.className = 'project-image-carousel__dot-window';
  dotWindow.setAttribute('data-carousel-dot-window', '');
  dotWindow.style.setProperty('--project-carousel-dot-count', String(dotGeometry.span));

  const dotStrip = document.createElement('div');
  dotStrip.className = 'project-image-carousel__dot-strip';
  dotStrip.setAttribute('data-carousel-dot-strip', '');
  dotStrip.style.setProperty('--project-carousel-dot-offset', String(dotGeometry.first));

  orderedIds.forEach((id) => {
    const parked = !visibleIds.includes(id);
    const displayIndex = visibleIds.indexOf(id);
    const { activeness, scale } = parked
      ? { activeness: 0, scale: 0 }
      : carouselDotAppearance(displayIndex, 0, dotGeometry.centre);
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'project-image-carousel__dot';
    dot.setAttribute('data-carousel-dot', '');
    if (!parked) dot.setAttribute('data-carousel-index', String(displayIndex));
    dot.setAttribute('data-carousel-item-id', id);
    if (parked) dot.setAttribute('data-carousel-parked', 'true');
    dot.style.setProperty('--project-carousel-dot-activeness', String(activeness));
    dot.style.setProperty('--project-carousel-dot-scale', String(scale));
    dot.setAttribute('aria-current', !parked && displayIndex === 0 ? 'true' : 'false');
    if (!parked) dot.setAttribute('aria-label', `Go to image ${displayIndex + 1}`);
    if (parked) {
      dot.setAttribute('aria-hidden', 'true');
      dot.tabIndex = -1;
    }
    const mark = document.createElement('span');
    mark.className = 'project-image-carousel__dot-mark';
    dot.append(mark);
    dotStrip.append(dot);
  });

  dotWindow.append(dotStrip);
  dots.append(dotWindow);
  media.append(dots);
  block.append(media);

  const captionSlot = document.createElement('div');
  captionSlot.className = 'project-image-carousel__caption-slot';
  captionSlot.setAttribute('data-carousel-caption-slot', '');
  captionSlot.hidden = true;
  block.append(captionSlot);

  return block;
}

export function mountInsertedSection(
  section: MountedSection,
  documentKey: string,
  index: number,
): HTMLElement {
  const type = String(section.type ?? '');
  if (type === 'imageGrid') return mountImageGridSection(section, documentKey, index);
  if (type === 'imageCarousel') return mountImageCarouselSection(section, documentKey, index);
  return mountImageSection(section, documentKey, index);
}

export function isDevContentEditing() {
  const root = document.documentElement;
  return root.classList.contains('is-dev-mode')
    && !root.classList.contains('show-section-nav-editor');
}

export function syncDevModeOnSection(root: HTMLElement, devMode: boolean) {
  const contentEditing = devMode && !document.documentElement.classList.contains('show-section-nav-editor');
  root.querySelectorAll<HTMLElement>('[data-dev-mode-only]').forEach((control) => {
    control.hidden = !contentEditing;
  });
  root.querySelectorAll<HTMLButtonElement>('[data-dev-edit-trigger]').forEach((trigger) => {
    trigger.disabled = !contentEditing;
  });
}

export function initMountedSectionCovers(root: HTMLElement) {
  bindProjectCropCovers(root);
  bindProjectImageCarousels(root);
  bindAllPlaceholderLabels(root);
}
