/** Shared helpers for dev-mode section block paths and ordering. */

export const DEV_PATH_ATTRS = [
  'data-dev-spacing-path',
  'data-dev-intro-height-path',
  'data-dev-text-path',
  'data-dev-image-path',
  'data-dev-grid-path',
] as const;

export const SECTION_ORDER_ID_ATTR = 'data-dev-section-order-id';

export function sectionIndexFromPath(raw: string | undefined | null): number | null {
  if (!raw) return null;
  try {
    const path = JSON.parse(raw) as Array<string | number>;
    if (path[0] === 'sections' && typeof path[1] === 'number') return path[1];
  } catch {
    // Ignore malformed paths.
  }
  return null;
}

export function sectionIndexFromElement(el: HTMLElement): number | null {
  return sectionIndexFromPath(el.dataset.devSpacingPath);
}

export function getDropZone(): HTMLElement | null {
  return document.querySelector('[data-dev-project-drop-zone]');
}

/** One outermost root element per section index in the drop zone. */
export function getSectionRoots(dropZone?: HTMLElement | null): HTMLElement[] {
  const zone = dropZone ?? getDropZone();
  if (!zone) return [];

  const byIndex = new Map<number, HTMLElement>();

  zone.querySelectorAll<HTMLElement>('[data-dev-spacing-document][data-dev-spacing-path]').forEach((el) => {
    const idx = sectionIndexFromElement(el);
    if (idx === null) return;
    const existing = byIndex.get(idx);
    if (!existing) {
      byIndex.set(idx, el);
      return;
    }
    if (existing.contains(el)) return;
    if (el.contains(existing)) byIndex.set(idx, el);
  });

  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, el]) => el);
}

export function getSectionRootsInDomOrder(dropZone?: HTMLElement | null): HTMLElement[] {
  const roots = getSectionRoots(dropZone);
  return [...roots].sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

/** Stable identity for each block across in-session reorders (original JSON index). */
export function ensureSectionOrderIds(dropZone?: HTMLElement | null) {
  getSectionRoots(dropZone).forEach((root) => {
    if (root.hasAttribute(SECTION_ORDER_ID_ATTR)) return;
    const idx = sectionIndexFromElement(root);
    if (idx !== null) root.setAttribute(SECTION_ORDER_ID_ATTR, String(idx));
  });
}

/**
 * Shift stamped order ids the same way an insert/delete shifts section paths.
 * Order ids track the JSON index, so a structural edit has to move both or the
 * pending reorder payload stops describing the document — wrong length, or a
 * duplicate id where the new block lands on an index still claimed by its
 * neighbour. Mirrors `bumpSectionPath`: an insert moves ids at or after the
 * index, a delete moves only those strictly after it.
 */
export function shiftSectionOrderIds(
  fromIndex: number,
  delta: number,
  dropZone?: HTMLElement | null,
) {
  const zone = dropZone ?? getDropZone();
  if (!zone) return;

  zone.querySelectorAll<HTMLElement>(`[${SECTION_ORDER_ID_ATTR}]`).forEach((root) => {
    const current = Number(root.getAttribute(SECTION_ORDER_ID_ATTR));
    if (!Number.isInteger(current)) return;
    if (delta > 0 ? current < fromIndex : current <= fromIndex) return;
    root.setAttribute(SECTION_ORDER_ID_ATTR, String(current + delta));
  });
}

export function sectionOrderId(root: HTMLElement): number | null {
  const raw = root.getAttribute(SECTION_ORDER_ID_ATTR);
  if (raw == null || raw === '') return sectionIndexFromElement(root);
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

export function captureSectionOrder(dropZone?: HTMLElement | null): number[] {
  ensureSectionOrderIds(dropZone);
  return getSectionRootsInDomOrder(dropZone)
    .map(sectionOrderId)
    .filter((index): index is number => index !== null);
}

export function buildIndexMapFromOrder(order: number[]): Record<number, number> {
  const map: Record<number, number> = {};
  order.forEach((oldIndex, newIndex) => {
    map[oldIndex] = newIndex;
  });
  return map;
}

export function remapSectionPaths(indexMap: Record<number, number>) {
  document.querySelectorAll<HTMLElement>(
    DEV_PATH_ATTRS.map((attr) => `[${attr}]`).join(','),
  ).forEach((el) => {
    DEV_PATH_ATTRS.forEach((attr) => {
      const raw = el.getAttribute(attr);
      if (!raw) return;
      try {
        const path = JSON.parse(raw) as Array<string | number>;
        if (!Array.isArray(path)) return;
        if (path[0] === 'sections' && typeof path[1] === 'number') {
          const newIdx = indexMap[path[1]];
          if (newIdx !== undefined) {
            path[1] = newIdx;
            el.setAttribute(attr, JSON.stringify(path));
          }
        }
      } catch {
        // Ignore malformed paths.
      }
    });
  });
}

export function resetSectionOrderIds(dropZone?: HTMLElement | null) {
  getSectionRootsInDomOrder(dropZone).forEach((root, index) => {
    root.setAttribute(SECTION_ORDER_ID_ATTR, String(index));
  });
}
