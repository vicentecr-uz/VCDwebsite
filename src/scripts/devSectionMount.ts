import { projectImage } from '../lib/images';
import {
  imageGridColumnsStyle,
  imageGridConstrainedStyle,
  responsiveImageStyle,
  resolveImageGridColumns,
  resolveImageGridConstrained,
  type ImageVariants,
} from '../lib/responsiveImage';
import {
  gridItemLayoutStyle,
  imageDevEditAttrs,
  isPlaceholderSrc,
  resolveGridItemCrop,
  resolveGridItemLayout,
  resolveInlineImageCrop,
} from '../lib/projectImageFrame';
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
  const { hasCrop, normalized } = resolveInlineImageCrop(src, variants);
  const cropId = String(section.id ?? 'image');
  const placeholder = isPlaceholderSrc(src);
  const editAttrs = imageDevEditAttrs(true, {
    documentKey,
    path: sectionPath,
    cropId,
    variants: normalized,
  });

  const figure = document.createElement('figure');
  figure.className = [
    'project-media',
    hasCrop && 'project-cropped project-responsive-image',
    'dev-image-edit-target',
    placeholder && 'project-media--placeholder',
  ].filter(Boolean).join(' ');
  if (normalized) figure.style.cssText = responsiveImageStyle(normalized);
  applyDataAttrs(figure, editAttrs);

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
  const resolvedLayouts = resolveGridItemLayout(itemIds, layouts);
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
    const { hasOwnVariants, variants, style: variantStyle } = resolveGridItemCrop(
      {
        src: String(item.src ?? ''),
        variants: item.variants as ImageVariants | undefined,
        crop: item.crop as { x?: number; y?: number; zoom?: number } | undefined,
      },
      defaultAspectRatio,
    );
    const layoutStyle = gridItemLayoutStyle(itemId, resolvedLayouts);
    const placeholder = isPlaceholderSrc(String(item.src ?? ''));
    const editAttrs = imageDevEditAttrs(true, {
      documentKey,
      path: [...sectionPath, 'items', itemIndex],
      cropId: itemId,
      variants,
      gridDefaultAspect: defaultAspectRatio,
      hasOwnVariants,
    });

    const figure = document.createElement('figure');
    figure.className = [
      'project-image-grid__item',
      'project-responsive-image',
      'dev-image-edit-target',
      placeholder && 'project-media--placeholder',
    ].filter(Boolean).join(' ');
    figure.style.cssText = `${variantStyle};${layoutStyle}`;
    figure.setAttribute('data-grid-item-id', itemId);
    figure.setAttribute('data-grid-hidden-desktop', resolvedLayouts.desktop.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-grid-hidden-tablet', resolvedLayouts.tablet.hidden.includes(itemId) ? 'true' : 'false');
    figure.setAttribute('data-grid-hidden-mobile', resolvedLayouts.mobile.hidden.includes(itemId) ? 'true' : 'false');
    applyDataAttrs(figure, editAttrs);

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
