type FieldChange = { document?: unknown; path?: unknown; target?: unknown };

export function sectionEditTarget(element?: HTMLElement | null): { sectionId: string } | undefined {
  const id = element?.closest<HTMLElement>('[data-dev-content-id]')?.dataset.devContentId;
  return id ? { sectionId: id } : undefined;
}

export function editsRemovedMedia(edit: FieldChange, removal: FieldChange & { itemId?: unknown }): boolean {
  const edited = edit.target as { sectionId?: string; itemId?: string; itemIds?: string[] } | undefined;
  const removed = removal.target as { sectionId?: string; itemId?: string; itemIds?: string[] } | undefined;
  const editedIds = edited?.itemIds ?? (edited?.itemId ? [edited.itemId] : []);
  const removedIds = [...(removed?.itemIds ?? (removed?.itemId ? [removed.itemId] : [])), removal.itemId];
  return Boolean(edit.document === removal.document && edited?.sectionId
    && edited.sectionId === removed?.sectionId && typeof removal.itemId === 'string'
    && editedIds.length >= removedIds.length
    && removedIds.every((id, index) => editedIds[index] === id));
}

export function devEditPendingId(kind: 'crop' | 'caption' | 'grid' | 'carousel', element: HTMLElement): string {
  const documentKey = element.dataset.devDocument || '';
  const rawPath = (kind === 'grid' ? element.dataset.devGridPath
    : kind === 'carousel' ? element.dataset.devCarouselPath : element.dataset.devImagePath) || '[]';
  const change = withDevEditTarget<FieldChange>({ document: documentKey, path: JSON.parse(rawPath) }, element);
  return `${kind}:${documentKey}:${change.target ? `id:${JSON.stringify(change.target)}` : rawPath}`;
}

export function withDevEditTarget<T extends FieldChange>(change: T, element?: HTMLElement | null): T {
  const path = change.path;
  if (change.target !== undefined || !Array.isArray(path) || path[0] !== 'sections') return change;
  const documentKey = String(change.document || '');
  const matchesSection = (root: HTMLElement) => {
    if (root.dataset.devSpacingDocument !== documentKey) return false;
    const rootPath = JSON.parse(root.dataset.devSpacingPath || '[]');
    return rootPath[0] === 'sections' && rootPath[1] === path[1];
  };
  const ancestor = element?.closest<HTMLElement>('[data-dev-content-id]');
  const root = ancestor && ancestor.dataset.devSpacingDocument === documentKey
    ? ancestor
    : [...document.querySelectorAll<HTMLElement>('[data-dev-content-id]')].find(matchesSection);
  // Legacy renderers remain positional until they expose canonical content IDs.
  if (!root?.dataset.devContentId) return change;
  const target: { sectionId: string; itemId?: string; itemIds?: string[] } = { sectionId: root.dataset.devContentId };
  if (path[2] === 'items' && typeof path[3] === 'number') {
    let mediaPathLength = 2;
    while (path[mediaPathLength] === 'items' && typeof path[mediaPathLength + 1] === 'number') mediaPathLength += 2;
    const item = element?.closest<HTMLElement>('[data-grid-item-id]')
      ?? [...root.querySelectorAll<HTMLElement>('[data-grid-item-id]')].find((candidate) => {
        const itemPath = JSON.parse(candidate.dataset.devImagePath || candidate.dataset.devItemPath || '[]');
        return itemPath.length === mediaPathLength && itemPath.every((part, index) => part === path[index]);
      });
    if (item && root.contains(item)) {
      const ids: string[] = [];
      let current: HTMLElement | null = item;
      while (current && current !== root) {
        const id = current.dataset.gridItemId;
        if (id) ids.unshift(id);
        current = current.parentElement?.closest<HTMLElement>('[data-grid-item-id]') ?? null;
      }
      const expectedDepth = path.filter((part, index) => index >= 2 && part === 'items').length;
      const scopedIds = ids.slice(0, expectedDepth);
      if (scopedIds.length > 1) target.itemIds = scopedIds;
      else target.itemId = scopedIds[0];
    }
  }
  return { ...change, target };
}
