import { projectImage } from '../lib/images';
import {
  imageGridColumnsStyle,
  imageGridConstrainedStyle,
  imageGridItemLayoutStyle,
  normalizeImageVariants,
  resolveImageGridColumns,
  resolveImageGridConstrained,
  resolveImageGridLayouts,
  responsiveImageStyle,
  type ImageVariants,
} from '../lib/responsiveImage';
import { bindProjectCropCovers } from '../lib/projectCropCover';

type SpacingValue = 'related' | 'group' | 'section' | 'major' | 'none';

const STACK_CLASS: Record<SpacingValue, string | null> = {
  related: 'project-stack--related',
  group: 'project-stack--group',
  section: null,
  major: 'project-stack--major',
  none: 'project-stack--none',
};

export type MountedSection = Record<string, unknown>;

const spacingClassName = (spacing: string) => {
  const stack = STACK_CLASS[spacing as SpacingValue];
  return stack ? `project-block ${stack}` : 'project-block';
};

const hasCropVariants = (variants: ImageVariants | undefined) =>
  !!variants && Object.values(variants).some(
    (variant) => variant && (variant.aspectRatio || variant.x || variant.y || variant.zoom),
  );

const isPlaceholderSrc = (src: string) =>
  src === 'placeholder.svg' || src.endsWith('/placeholder.svg');

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

  target.append(caption, image);
};

const buildInlineImageFigure = (
  section: MountedSection,
  documentKey: string,
  sectionPath: Array<string | number>,
) => {
  const src = String(section.src ?? '');
  const variants = section.variants as ImageVariants | undefined;
  const hasCrop = hasCropVariants(variants);
  const normalized = hasCrop
    ? normalizeImageVariants(variants, '1:1', undefined)
    : undefined;
  const cropId = String(section.id ?? 'image');
  const placeholder = isPlaceholderSrc(src);

  const figure = document.createElement('figure');
  figure.className = [
    'project-media',
    hasCrop && 'project-cropped project-responsive-image',
    'dev-image-edit-target',
    placeholder && 'project-media--placeholder',
  ].filter(Boolean).join(' ');
  if (normalized) figure.style.cssText = responsiveImageStyle(normalized);
  figure.setAttribute('data-dev-image-target', 'image');
  figure.setAttribute('data-dev-document', documentKey);
  figure.setAttribute('data-dev-image-path', JSON.stringify(sectionPath));
  figure.setAttribute('data-dev-crop-id', cropId);
  figure.setAttribute('data-dev-image-variants', JSON.stringify(normalized ?? {}));
  figure.setAttribute('data-dev-captions', JSON.stringify({ desktop: '', tablet: '', mobile: '' }));
  figure.setAttribute('data-dev-caption-style', 'default');
  figure.setAttribute('data-dev-caption-position', 'bottom-left');
  figure.setAttribute('data-dev-caption-reveals', JSON.stringify({
    desktop: 'hover',
    tablet: 'always',
    mobile: 'always',
  }));

  const img = document.createElement('img');
  img.src = projectImage(src);
  img.alt = String(section.alt ?? '');
  img.className = 'project-media__img';
  img.loading = 'lazy';
  figure.append(img);
  appendEditTriggers(figure);
  return figure;
};

export function mountImageSection(
  section: MountedSection,
  documentKey: string,
  index: number,
): HTMLElement {
  const spacing = String(section.spacing ?? 'section');
  const sectionPath = ['sections', index];
  const block = document.createElement('div');
  block.className = spacingClassName(spacing);
  block.setAttribute('data-dev-spacing-document', documentKey);
  block.setAttribute('data-dev-spacing-path', JSON.stringify([...sectionPath, 'spacing']));
  block.setAttribute('data-dev-spacing-value', spacing);
  block.setAttribute('data-dev-section-deletable', 'image');
  block.append(buildInlineImageFigure(section, documentKey, sectionPath));
  return block;
}

export function mountImageGridSection(
  section: MountedSection,
  documentKey: string,
  index: number,
): HTMLElement {
  const spacing = String(section.spacing ?? 'section');
  const sectionPath = ['sections', index];
  const items = Array.isArray(section.items) ? section.items as MountedSection[] : [];
  const columns = resolveImageGridColumns(section.columns as never);
  const constrained = resolveImageGridConstrained(section.constrained as never);
  const defaultAspectRatio = String(section.defaultAspectRatio ?? '4:3');
  const layouts = (section.layouts && typeof section.layouts === 'object')
    ? section.layouts as Record<string, { visible?: string[] }>
    : {};
  const itemIds = items.map((item, itemIndex) => String(item.id ?? `item-${itemIndex}`));
  const resolvedLayouts = resolveImageGridLayouts(itemIds, layouts);
  const editorItems = items.map((item, itemIndex) => ({
    id: itemIds[itemIndex],
    src: projectImage(String(item.src ?? '')),
    alt: String(item.alt ?? ''),
  }));

  const grid = document.createElement('div');
  grid.className = [
    'project-image-grid',
    STACK_CLASS[spacing as SpacingValue] ?? null,
  ].filter(Boolean).join(' ');
  grid.style.cssText = `${imageGridColumnsStyle(columns)};${imageGridConstrainedStyle(constrained)};`;
  grid.setAttribute('data-dev-grid-target', 'grid');
  grid.setAttribute('data-dev-document', documentKey);
  grid.setAttribute('data-dev-grid-path', JSON.stringify(sectionPath));
  grid.setAttribute('data-dev-grid-columns', JSON.stringify(columns));
  grid.setAttribute('data-dev-grid-constrained', JSON.stringify(constrained));
  grid.setAttribute('data-dev-grid-default-aspect', defaultAspectRatio);
  grid.setAttribute('data-dev-grid-layouts', JSON.stringify(layouts));
  grid.setAttribute('data-dev-grid-items', JSON.stringify(editorItems));
  grid.setAttribute('data-dev-spacing-document', documentKey);
  grid.setAttribute('data-dev-spacing-path', JSON.stringify([...sectionPath, 'spacing']));
  grid.setAttribute('data-dev-spacing-value', spacing);
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
    const hasOwnVariants = !!item.variants;
    const variants = normalizeImageVariants(
      hasOwnVariants ? item.variants as ImageVariants : undefined,
      defaultAspectRatio,
      item.crop as { x?: number; y?: number; zoom?: number } | undefined,
    );
    const layoutStyle = imageGridItemLayoutStyle(itemId, resolvedLayouts);
    const placeholder = isPlaceholderSrc(String(item.src ?? ''));

    const figure = document.createElement('figure');
    figure.className = [
      'project-image-grid__item',
      'project-responsive-image',
      'dev-image-edit-target',
      placeholder && 'project-media--placeholder',
    ].filter(Boolean).join(' ');
    figure.style.cssText = `${responsiveImageStyle(variants)};${layoutStyle}`;
    figure.setAttribute('data-grid-item-id', itemId);
    figure.setAttribute('data-grid-hidden-desktop', resolvedLayouts.desktop.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-grid-hidden-tablet', resolvedLayouts.tablet.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-grid-hidden-mobile', resolvedLayouts.mobile.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-dev-image-target', 'image');
    figure.setAttribute('data-dev-document', documentKey);
    figure.setAttribute('data-dev-image-path', JSON.stringify([...sectionPath, 'items', itemIndex]));
    figure.setAttribute('data-dev-crop-id', itemId);
    figure.setAttribute('data-dev-image-variants', JSON.stringify(variants));
    figure.setAttribute('data-dev-grid-default-aspect', defaultAspectRatio);
    if (hasOwnVariants) figure.setAttribute('data-dev-has-own-variants', 'true');
    figure.setAttribute('data-dev-captions', JSON.stringify({ desktop: '', tablet: '', mobile: '' }));
    figure.setAttribute('data-dev-caption-style', 'default');
    figure.setAttribute('data-dev-caption-position', 'bottom-left');
    figure.setAttribute('data-dev-caption-reveals', JSON.stringify({
      desktop: 'hover',
      tablet: 'always',
      mobile: 'always',
    }));

    const img = document.createElement('img');
    img.src = projectImage(String(item.src ?? ''));
    img.alt = String(item.alt ?? '');
    img.className = 'project-image-grid__image';
    img.loading = 'lazy';
    figure.append(img);
    appendEditTriggers(figure);
    grid.append(figure);
  });

  return grid;
}

export function mountInsertedSection(
  section: MountedSection,
  documentKey: string,
  index: number,
): HTMLElement {
  const type = String(section.type ?? '');
  if (type === 'imageGrid') return mountImageGridSection(section, documentKey, index);
  return mountImageSection(section, documentKey, index);
}

export function syncDevModeOnSection(root: HTMLElement, devMode: boolean) {
  root.querySelectorAll<HTMLElement>('[data-dev-mode-only]').forEach((control) => {
    control.hidden = !devMode;
  });
  root.querySelectorAll<HTMLButtonElement>('[data-dev-edit-trigger]').forEach((trigger) => {
    trigger.disabled = !devMode;
  });
}

export function initMountedSectionCovers(root: HTMLElement) {
  bindProjectCropCovers(root);
}
