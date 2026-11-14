import { isVideoSrc } from './imageUpload.mjs';

export function isDerivativeToken(token) {
  if (token.endsWith('.thumb.webp') || token.endsWith('.preview.webp')) return true;
  return token.endsWith('.poster.webp') && isVideoSrc(token.slice(0, -'.poster.webp'.length));
}

/**
 * Collapse every legacy ref form onto one: decoded, relative to `media/`, no
 * prefix, no leading slash. Legacy input branches (`draft:`, `/draft-media/`)
 * are kept so a stale client (or old JSON that hasn't gone through the
 * one-shot migration) still resolves.
 * @param {string} value
 */
export function normalizeAssetSrc(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'placeholder.svg' || raw.endsWith('/placeholder.svg')) return '';
  if (raw.startsWith('draft:')) return decodeURIComponent(raw.slice('draft:'.length));
  if (raw.startsWith('/draft-media/')) {
    return decodeURIComponent(raw.slice('/draft-media/'.length));
  }
  if (raw.startsWith('/images/')) {
    return decodeURIComponent(raw.slice('/images/'.length));
  }
  if (raw.startsWith('/')) return '';
  return raw;
}

export const PLACEHOLDER_IMAGE_VARIANTS = {
  desktop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
};

export const buildPlaceholderItem = (id) => ({
  id,
  src: 'placeholder.svg',
  alt: 'Placeholder',
  variants: structuredClone(PLACEHOLDER_IMAGE_VARIANTS),
});

export function buildPlaceholderImageSection() {
  const id = `placeholder-${Date.now().toString(36)}`;
  return { type: 'image', id, spacing: 'group', ...buildPlaceholderItem(id) };
}

export function buildPlaceholderImageGridSection() {
  const id = `placeholder-grid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const items = [
    buildPlaceholderItem(`grid-item-1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    buildPlaceholderItem(`grid-item-2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
  ];
  const visible = items.map((item) => item.id);
  return {
    type: 'imageGrid', id, columns: 2, defaultAspectRatio: '4:3', spacing: 'group', items,
    layouts: { desktop: { visible: [...visible] }, mobile: { visible: [...visible] } },
  };
}

export function buildPlaceholderImageCarouselSection() {
  const id = `placeholder-carousel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const items = [
    buildPlaceholderItem(`carousel-item-1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    buildPlaceholderItem(`carousel-item-2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
  ];
  return {
    type: 'imageCarousel', id, orientation: 'horizontal', heightMode: 'dynamic', dotsPlacement: 'outside',
    defaultAspectRatio: 'original', spacing: 'group', items, visible: items.map((item) => item.id),
  };
}

export function isPlaceholderImageSrc(src) {
  const value = String(src || '');
  return value === 'placeholder.svg' || value.endsWith('/placeholder.svg');
}

export function markAutomaticImageAltIntent(section) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.src === 'string' && /\.(?:jpe?g|png|webp|avif|gif|bmp|tiff?)$/i.test(node.src.split(/[?#]/, 1)[0]) && !String(node.alt || '').trim() && (!node.altIntent || node.altIntent === 'auto')) node.altIntent = 'auto';
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
  };
  visit(section);
  return section;
}

/**
 * Remove media from a section by capability, not by type allowlist.
 * New media shapes inherit this without registering.
 * - Multi-item blocks (`items[]`): drop the matching item (refuse if last).
 * - Single-src blocks (`src`): drop the whole section from `sections[]`.
 *
 * @param {Record<string, unknown>} data
 * @param {Array<string | number>} fieldPath
 * @param {string} itemId
 */
export function removeMediaItemFromDocument(data, fieldPath, itemId) {
  const id = String(itemId || '');
  if (!Array.isArray(fieldPath) || !fieldPath.length) {
    throw new Error('That media block path is invalid.');
  }

  let cursor = /** @type {unknown} */ (data);
  for (const part of fieldPath) {
    if (cursor == null || typeof cursor !== 'object') {
      throw new Error('That media block path no longer exists.');
    }
    cursor = /** @type {Record<string | number, unknown>} */ (cursor)[part];
  }
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new Error('That media block path no longer exists.');
  }

  const node = /** @type {Record<string, unknown>} */ (cursor);

  // Multi-item media (grid, carousel, future): remove one item by id.
  if (Array.isArray(node.items)) {
    if (!id) throw new Error('An item id is required.');
    const index = node.items.findIndex((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      return String(/** @type {Record<string, unknown>} */ (item).id || '') === id;
    });
    if (index < 0) throw new Error('That image is no longer in this block.');
    if (node.items.length <= 1) {
      throw new Error('Keep at least one image, or delete the whole section.');
    }

    node.items.splice(index, 1);

    if (Array.isArray(node.visible)) {
      node.visible = node.visible.filter((entry) => String(entry) !== id);
      if (!node.visible.length) delete node.visible;
    }
    if (node.layouts && typeof node.layouts === 'object' && !Array.isArray(node.layouts)) {
      for (const layout of Object.values(/** @type {Record<string, unknown>} */ (node.layouts))) {
        if (!layout || typeof layout !== 'object' || Array.isArray(layout)) continue;
        const visible = /** @type {Record<string, unknown>} */ (layout).visible;
        if (!Array.isArray(visible)) continue;
        /** @type {Record<string, unknown>} */ (layout).visible = visible.filter(
          (entry) => String(entry) !== id,
        );
      }
    }
    if (node.breakpoints && typeof node.breakpoints === 'object' && !Array.isArray(node.breakpoints)) {
      for (const bp of Object.values(/** @type {Record<string, unknown>} */ (node.breakpoints))) {
        if (!bp || typeof bp !== 'object' || Array.isArray(bp)) continue;
        const visible = /** @type {Record<string, unknown>} */ (bp).visible;
        if (!Array.isArray(visible)) continue;
        /** @type {Record<string, unknown>} */ (bp).visible = visible.filter(
          (entry) => String(entry) !== id,
        );
      }
    }

    return node;
  }

  // Single-src media (image, future video, …): remove the whole section.
  if (
    fieldPath[0] === 'sections'
    && typeof fieldPath[1] === 'number'
    && typeof node.src === 'string'
  ) {
    const sectionIndex = fieldPath[1];
    const sections = data.sections;
    if (!Array.isArray(sections) || sectionIndex < 0 || sectionIndex >= sections.length) {
      throw new Error('That media block path no longer exists.');
    }
    if (sections[sectionIndex] !== node) {
      throw new Error('That media block path no longer exists.');
    }
    const [removed] = sections.splice(sectionIndex, 1);
    return removed;
  }

  throw new Error('That block does not hold removable media.');
}


function isValidOutlineEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (
    typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 80
    || typeof entry.label !== 'string' || entry.label.length === 0 || entry.label.length > 120
    || (entry.anchor !== undefined && (typeof entry.anchor !== 'string' || entry.anchor.length === 0 || entry.anchor.length > 80))
  ) return false;
  if (entry.kind === 'group') return entry.defaultOpen === undefined || typeof entry.defaultOpen === 'boolean';
  if (entry.kind === 'section') {
    return entry.defaultOpen === undefined || typeof entry.defaultOpen === 'boolean';
  }
  return entry.kind === 'subsection' && entry.defaultOpen === undefined;
}

export function validateProjectOutline(outline) {
  if (!Array.isArray(outline) || outline.length > 120 || !outline.every(isValidOutlineEntry)) return false;
  const identities = new Set();
  for (const entry of outline) {
    const normalizedKind = entry.kind === 'group'
      || (entry.kind === 'section' && Object.prototype.hasOwnProperty.call(entry, 'defaultOpen'))
      ? 'group'
      : 'section';
    const identity = `${normalizedKind}:${entry.id}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

export function validateProjectOutlineTargets(outline, sections) {
  if (!Array.isArray(outline) || !Array.isArray(sections)) return false;
  const targets = new Set(
    sections
      .filter((section) => section && typeof section === 'object' && !Array.isArray(section))
      .map((section) => String(section.sectionId || section.id || '').trim())
      .filter(Boolean),
  );
  return outline.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    return targets.has(String(entry.anchor || entry.id || '').trim());
  });
}

/**
 * Strip JSON references to an asset src. Mutates `data`.
 * @param {Record<string, unknown>} data
 * @param {string} targetSrc
 * @returns {number} number of removals
 */
export function stripAssetRefsFromDocument(data, targetSrc) {
  const target = normalizeAssetSrc(targetSrc);
  if (!target) return 0;
  let removed = 0;

  const matches = (value) => normalizeAssetSrc(String(value || '')) === target;

  const stripItems = (node) => {
    if (!Array.isArray(node.items)) return;
    const removedIds = new Set();
    node.items = node.items.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
      if (item.type === 'imageCarousel' && Array.isArray(item.items)) {
        const before = removed;
        stripItems(item);
        if (removed === before || item.items.length) return true;
      } else if (matches(item.src)) {
        removed += 1;
      } else {
        return true;
      }
      removedIds.add(String(item.id || ''));
      return false;
    });
    if (!removedIds.size) return;
    if (Array.isArray(node.visible)) {
      node.visible = node.visible.filter((id) => !removedIds.has(String(id)));
      if (!node.visible.length) delete node.visible;
    }
    for (const settings of [node.layouts, node.breakpoints]) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
      for (const override of Object.values(settings)) {
        if (!override || typeof override !== 'object' || !Array.isArray(override.visible)) continue;
        override.visible = override.visible.filter((id) => !removedIds.has(String(id)));
      }
    }
  };

  if (Array.isArray(data.sections)) {
    data.sections = data.sections.filter((node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return true;
      if ((node.type === 'image' || node.type === 'placeholder') && matches(node.src)) {
        removed += 1;
        return false;
      }
      if (node.type === 'imageGrid' || node.type === 'imageCarousel') stripItems(node);
      return true;
    });
  }

  if (data.listings && typeof data.listings === 'object' && !Array.isArray(data.listings)) {
    for (const listing of Object.values(/** @type {Record<string, unknown>} */ (data.listings))) {
      if (!listing || typeof listing !== 'object' || Array.isArray(listing)) continue;
      const card = /** @type {Record<string, unknown>} */ (listing);
      if (matches(card.image)) {
        card.image = 'black-token.svg';
        removed += 1;
      }
      // Hover covers are a second image slot on the same card; clear rather than
      // default, since an empty hover slot is a valid state and a default is not.
      if (matches(card.hoverImage)) {
        delete card.hoverImage;
        removed += 1;
      }
    }
  }

  if (data.teaser && typeof data.teaser === 'object' && !Array.isArray(data.teaser)) {
    const teaser = /** @type {Record<string, unknown>} */ (data.teaser);
    if (matches(teaser.coverImage)) {
      teaser.coverImage = '';
      removed += 1;
    }
  }

  return removed;
}
