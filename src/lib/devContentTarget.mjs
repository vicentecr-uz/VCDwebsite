const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const isSafeContentPath = (path) => (
  Array.isArray(path) && path.length <= 8 && path.every((part) => (
    (typeof part === 'string' && !FORBIDDEN_PATH_KEYS.has(part))
    || (Number.isSafeInteger(part) && part >= 0)
  ))
);

const findUniqueId = (list, id, label) => {
  const matches = list.filter((entry) => entry && typeof entry === 'object' && entry.id === id);
  if (matches.length === 0) throw new Error(`The edited ${label} was deleted.`);
  if (matches.length > 1) throw new Error(`This ${label} ID is duplicated.`);
  return matches[0];
};

/** Resolve a save path by stable section/item IDs when supplied. */
export function resolveContentTarget(data, path, target) {
  if (!isSafeContentPath(path) || (path.length === 0 && target !== undefined)) throw new Error('Invalid content path.');
  // Compatibility ceiling: retain positional paths until legacy renderers migrate.
  if (target === undefined) return [...path];
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('Invalid content target.');
  if (Object.keys(target).some((key) => !['sectionId', 'itemId', 'itemIds'].includes(key))) throw new Error('Invalid content target.');
  if (Object.prototype.hasOwnProperty.call(target, 'itemIds') && !Array.isArray(target.itemIds)) throw new Error('Invalid item IDs.');
  if (Object.prototype.hasOwnProperty.call(target, 'itemId') && Object.prototype.hasOwnProperty.call(target, 'itemIds')) throw new Error('Specify one item ID format.');
  if (!Array.isArray(data?.sections)) throw new Error('The sections list no longer exists.');
  if (path[0] !== 'sections' || !Number.isSafeInteger(path[1]) || path[1] < 0) {
    throw new Error('Stable content targets require a sections path.');
  }
  if (typeof target.sectionId !== 'string' || !target.sectionId) throw new Error('Invalid section ID.');
  const section = findUniqueId(data.sections, target.sectionId, 'section');
  if (Object.prototype.hasOwnProperty.call(target, 'itemId') && (
    typeof target.itemId !== 'string' || !target.itemId
    || path[2] !== 'items' || !Number.isSafeInteger(path[3]) || path[3] < 0
  )) throw new Error('Item IDs require an items path.');
  if (path[2] === 'items' && (!Number.isSafeInteger(path[3]) || path[3] < 0)) {
    throw new Error('An items path requires an item position.');
  }
  const resolved = ['sections', data.sections.indexOf(section), ...path.slice(2)];
  const itemIds = Array.isArray(target.itemIds)
    ? target.itemIds
    : (typeof target.itemId === 'string' && target.itemId ? [target.itemId] : undefined);
  if (itemIds && (itemIds.length === 0 || itemIds.length > 4
    || itemIds.some((id) => typeof id !== 'string' || !id))) throw new Error('Invalid item IDs.');
  if (itemIds && path[2] !== 'items') throw new Error('Item IDs require an items path.');
  if (path[2] === 'items') {
    let cursor = section;
    let pathOffset = 2;
    let idOffset = 0;
    while (pathOffset < path.length && path[pathOffset] === 'items') {
      const position = path[pathOffset + 1];
      if (!Number.isSafeInteger(position) || position < 0) throw new Error('An items path requires an item position.');
      if (!Array.isArray(cursor.items)) throw new Error('The items list no longer exists.');
      const id = itemIds?.[idOffset];
      if ((cursor.type === 'imageGrid' || cursor.type === 'imageCarousel') && !id) {
        throw new Error('An item ID is required for a media items path.');
      }
      if (id) {
        const item = findUniqueId(cursor.items, id, 'item');
        resolved[pathOffset + 1] = cursor.items.indexOf(item);
        cursor = item;
      } else {
        cursor = cursor.items[position];
      }
      pathOffset += 2;
      idOffset += 1;
    }
    if (itemIds && idOffset !== itemIds.length) throw new Error('Item IDs do not match the edited path.');
  }
  return resolved;
}
