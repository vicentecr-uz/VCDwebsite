/**
 * Project page outline — Obsidian-style flat markers.
 *
 * Naming (sidebar / outline — not page JSON `sections[]` blocks):
 * - `group`  = section group (Intro / Research / Development)
 * - `section` = section inside a group (Overview / Public Reception / …)
 *
 * A section owns the page from its start anchor until the next section or
 * group marker. Multiple page blocks can fall in one section’s range without
 * each needing its own marker.
 */

export type OutlineGroup = {
  kind: 'group';
  id: string;
  label: string;
  /** When true, group starts expanded in the sidebar. Default true. */
  defaultOpen?: boolean;
  /** Optional start-boundary block id (for ordering / ranges). */
  anchor?: string;
};

export type OutlineSection = {
  kind: 'section';
  id: string;
  label: string;
  /** DOM / JSON sectionId used as scrollspy + hash target. Defaults to `id`. */
  anchor?: string;
};

export type OutlineEntry = OutlineGroup | OutlineSection;

/** @deprecated Use OutlineGroup — kept for migration typing */
export type OutlineSectionLegacy = OutlineGroup;
/** @deprecated Use OutlineSection — old name was subsection */
export type OutlineSubsection = OutlineSection;

export type SectionNavLink = {
  id: string;
  label: string;
  /** Stable outline marker id; `id` remains the DOM / scroll target. */
  outlineId?: string;
};

export type SectionNavGroup = {
  label: string;
  children: SectionNavLink[];
  defaultOpen?: boolean;
  /** Stable outline marker id and optional page-boundary anchor. */
  id?: string;
  anchor?: string;
};

export type SectionNavItem = SectionNavLink | SectionNavGroup;

export const isOutlineGroup = (entry: OutlineEntry): entry is OutlineGroup =>
  entry?.kind === 'group';

export const isOutlineSection = (entry: OutlineEntry): entry is OutlineSection =>
  entry?.kind === 'section';

export const isSectionNavGroup = (item: SectionNavItem): item is SectionNavGroup =>
  Boolean(item && typeof item === 'object' && 'children' in item);

/** Normalize legacy kinds: `section`+defaultOpen → group, `subsection` → section. */
export function normalizeOutline(raw: unknown): OutlineEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OutlineEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const kind = (item as { kind?: string }).kind;
    const label = typeof (item as { label?: string }).label === 'string'
      ? (item as { label: string }).label
      : '';
    const id = typeof (item as { id?: string }).id === 'string'
      ? (item as { id: string }).id
      : '';
    if (!label || !id || !kind) continue;
    const anchor = typeof (item as { anchor?: string }).anchor === 'string'
      ? (item as { anchor: string }).anchor
      : undefined;
    const defaultOpen = typeof (item as { defaultOpen?: boolean }).defaultOpen === 'boolean'
      ? (item as { defaultOpen: boolean }).defaultOpen
      : undefined;

    if (kind === 'group') {
      out.push({
        kind: 'group',
        id,
        label,
        defaultOpen: defaultOpen !== false,
        ...(anchor ? { anchor } : {}),
      });
      continue;
    }
    if (kind === 'subsection') {
      out.push({ kind: 'section', id, label, ...(anchor ? { anchor } : {}) });
      continue;
    }
    if (kind === 'section') {
      // Legacy outline used `section` for groups (had defaultOpen).
      if (Object.prototype.hasOwnProperty.call(item, 'defaultOpen')) {
        out.push({
          kind: 'group',
          id,
          label,
          defaultOpen: defaultOpen !== false,
          ...(anchor ? { anchor } : {}),
        });
      } else {
        out.push({ kind: 'section', id, label, ...(anchor ? { anchor } : {}) });
      }
    }
  }
  return out;
}

/** Resolve scroll / boundary target id for any outline entry. */
export function outlineAnchorId(entry: OutlineEntry): string {
  return entry.anchor?.trim() || entry.id;
}

/**
 * Best page-position id for sorting: explicit anchor, else first following
 * section for a group boundary.
 */
export function outlineSortAnchor(
  entry: OutlineEntry,
  outline: OutlineEntry[],
): string | null {
  if (entry.kind === 'section') return outlineAnchorId(entry);
  if (entry.anchor?.trim()) return entry.anchor.trim();

  const index = outline.indexOf(entry);
  if (index < 0) return null;
  for (let i = index + 1; i < outline.length; i += 1) {
    const next = outline[i];
    if (next.kind === 'group') break;
    if (next.kind === 'section') return outlineAnchorId(next);
  }
  return null;
}

/**
 * Re-order outline entries to match page block order while keeping each
 * section in its current group. Group markers move with their first child
 * on the page (anchor updated), so dragging a later section above a group's
 * former first section keeps it in that group instead of the previous one.
 */
export function reorderOutlinePreservingGroups(
  outline: OutlineEntry[],
  pageIndexForId: (id: string) => number,
): OutlineEntry[] {
  const normalized = normalizeOutline(outline);
  if (!normalized.length) return [];

  const seen = new Set<string>();
  const entries = normalized.filter((entry) => {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return entries
    .map((entry, outlineIndex) => ({
      entry,
      outlineIndex,
      pageIndex: pageIndexForId(
        entry.kind === 'group' && !entry.anchor
          ? outlineSortAnchor(entry, normalized) || outlineAnchorId(entry)
          : outlineAnchorId(entry),
      ),
    }))
    .sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
      if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'group' ? -1 : 1;
      return a.outlineIndex - b.outlineIndex;
    })
    .map(({ entry }) => entry);
}

/**
 * Page index lookup from project `sections[]` (`sectionId` then `id`).
 * Unknown ids sort after known blocks (same as DOM helpers).
 */
export function pageIndexFromSections(
  sections: Array<{ sectionId?: string; id?: string } | null | undefined> | null | undefined,
): (id: string) => number {
  const order: string[] = [];
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;
      const sid = String(section.sectionId || section.id || '').trim();
      if (sid) order.push(sid);
    }
  }
  return (id: string) => {
    if (!id) return Number.POSITIVE_INFINITY;
    const idx = order.indexOf(id);
    return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
  };
}

/**
 * Insert outline markers at this block’s page position — never only push to
 * the end. Pushing made new sectionTitles appear last in the sidebar while
 * the DOM block sat at the top (and re-added markers could inherit the wrong
 * group).
 */
export function insertOutlineEntriesAtPagePosition(
  outline: OutlineEntry[],
  blockAnchorId: string,
  entries: OutlineEntry[],
  pageIndexForId: (id: string) => number,
): OutlineEntry[] {
  if (!entries.length) return normalizeOutline(outline);
  const next = normalizeOutline(outline);
  const blockPage = pageIndexForId(blockAnchorId);
  let insertAt = next.length;
  for (let i = 0; i < next.length; i += 1) {
    const entryPage = pageIndexForId(outlineAnchorId(next[i]));
    if (entryPage > blockPage) {
      insertAt = i;
      break;
    }
  }
  next.splice(insertAt, 0, ...entries);
  return next;
}

/**
 * Derive the sidebar tree from a flat outline.
 * Sections attach to the nearest preceding group; leading sections
 * before any group become top-level links.
 */
export function deriveNavFromOutline(outline: OutlineEntry[] | undefined | null): SectionNavItem[] {
  const normalized = normalizeOutline(outline ?? []);
  if (!normalized.length) return [];

  const nav: SectionNavItem[] = [];
  let currentGroup: SectionNavGroup | null = null;

  for (const entry of normalized) {
    if (entry.kind === 'group') {
      currentGroup = {
        id: entry.id,
        label: entry.label,
        children: [],
        defaultOpen: entry.defaultOpen !== false,
        ...(entry.anchor ? { anchor: entry.anchor } : {}),
      };
      nav.push(currentGroup);
      continue;
    }

    if (entry.kind === 'section') {
      const link: SectionNavLink = {
        id: outlineAnchorId(entry),
        label: entry.label,
        outlineId: entry.id,
      };
      if (currentGroup) {
        currentGroup.children.push(link);
      } else {
        nav.push(link);
      }
    }
  }

  return nav;
}

/**
 * Convert legacy nested `nav` into a flat outline.
 */
export function outlineFromNav(nav: SectionNavItem[] | undefined | null): OutlineEntry[] {
  if (!Array.isArray(nav) || nav.length === 0) return [];

  const outline: OutlineEntry[] = [];
  const usedGroupIds = new Set<string>();
  for (const item of nav) {
    if (isSectionNavGroup(item) && item.id?.trim()) usedGroupIds.add(item.id.trim());
  }

  const uniqueGroupId = (label: string, suppliedId?: string) => {
    const supplied = suppliedId?.trim();
    if (supplied) return supplied;
    const base = slugifyOutlineId(label);
    let id = base;
    let suffix = 2;
    while (usedGroupIds.has(id)) id = `${base}-${suffix++}`;
    usedGroupIds.add(id);
    return id;
  };

  for (const item of nav) {
    if (isSectionNavGroup(item)) {
      const groupId = uniqueGroupId(item.label, item.id);
      const firstChild = item.children[0];
      outline.push({
        kind: 'group',
        id: groupId,
        label: item.label,
        defaultOpen: item.defaultOpen !== false,
        ...(item.anchor || firstChild ? { anchor: item.anchor || firstChild?.id } : {}),
      });
      for (const child of item.children) {
        outline.push({
          kind: 'section',
          id: child.outlineId?.trim() || child.id || slugifyOutlineId(child.label),
          label: child.label,
          anchor: child.id || slugifyOutlineId(child.label),
        });
      }
      continue;
    }

    outline.push({
      kind: 'section',
      id: item.id,
      label: item.label,
      anchor: item.id,
    });
  }

  return outline;
}

/** Prefer `outline`; fall back to deriving from legacy `nav`.
 * When `sections` is provided, reorder to page order so a pushed insert
 * cannot leave sidebar markers below blocks that sit higher on the page.
 */
export function resolveProjectOutline(data: {
  outline?: OutlineEntry[] | null;
  nav?: SectionNavItem[] | null;
  sections?: Array<{ sectionId?: string; id?: string } | null | undefined> | null;
}): OutlineEntry[] {
  const base =
    Array.isArray(data.outline)
      ? normalizeOutline(data.outline)
      : outlineFromNav(data.nav);

  if (!Array.isArray(data.sections)) {
    return base;
  }

  if (!data.sections.length) return [];
  const sectionIds = new Set(
    data.sections
      .map((section) => (section && typeof section === 'object'
        ? String(section.sectionId || section.id || '').trim()
        : ''))
      .filter(Boolean),
  );
  return reorderOutlinePreservingGroups(base, pageIndexFromSections(data.sections))
    .filter((entry) => sectionIds.has(outlineAnchorId(entry)));
}

export function resolveProjectSectionLinks(data: {
  outline?: OutlineEntry[] | null;
  nav?: SectionNavItem[] | null;
  sections?: Array<{ sectionId?: string; id?: string } | null | undefined> | null;
}): SectionNavItem[] {
  return deriveNavFromOutline(resolveProjectOutline(data));
}

export function slugifyOutlineId(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

export function outlineEntriesForAnchor(
  outline: OutlineEntry[],
  anchorId: string,
): OutlineEntry[] {
  if (!anchorId) return [];
  const normalized = normalizeOutline(outline);
  return normalized.filter((entry) => outlineAnchorId(entry) === anchorId);
}

/**
 * Find which outline section (and group) owns a page block, given ordered
 * block ids on the page. Ownership = from a section’s start until the next
 * section or group marker.
 */
export function owningOutlineSection(
  outline: OutlineEntry[],
  blockAnchorId: string,
  orderedBlockIds: string[],
): { group: OutlineGroup | null; section: OutlineSection | null } {
  const normalized = normalizeOutline(outline);
  const blockIndex = orderedBlockIds.indexOf(blockAnchorId);
  if (blockIndex < 0) return { group: null, section: null };

  type Marker = { entry: OutlineEntry; pageIndex: number; outlineIndex: number };
  const markers: Marker[] = [];

  normalized.forEach((entry, outlineIndex) => {
    const anchor = outlineSortAnchor(entry, normalized) || outlineAnchorId(entry);
    const pageIndex = orderedBlockIds.indexOf(anchor);
    if (pageIndex < 0) return;
    markers.push({ entry, pageIndex, outlineIndex });
  });

  markers.sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    if (a.entry.kind === 'group' && b.entry.kind === 'section') return -1;
    if (a.entry.kind === 'section' && b.entry.kind === 'group') return 1;
    return a.outlineIndex - b.outlineIndex;
  });

  let group: OutlineGroup | null = null;
  let section: OutlineSection | null = null;

  for (const marker of markers) {
    if (marker.pageIndex > blockIndex) break;
    if (marker.entry.kind === 'group') {
      group = marker.entry;
      section = null;
    } else {
      section = marker.entry;
    }
  }

  return { group, section };
}

/**
 * Block ids that fall in a section’s range [start, next section/group).
 */
export function blockIdsInSectionRange(
  outline: OutlineEntry[],
  sectionEntry: OutlineSection,
  orderedBlockIds: string[],
): string[] {
  const normalized = normalizeOutline(outline);
  const startAnchor = outlineAnchorId(sectionEntry);
  const startIndex = orderedBlockIds.indexOf(startAnchor);
  if (startIndex < 0) return [];

  const markers = normalized
    .map((entry, outlineIndex) => ({
      entry,
      outlineIndex,
      pageIndex: orderedBlockIds.indexOf(
        entry.kind === 'group' && !entry.anchor
          ? outlineSortAnchor(entry, normalized) || outlineAnchorId(entry)
          : outlineAnchorId(entry),
      ),
    }))
    .filter((marker) => marker.pageIndex >= 0)
    .sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
      if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'group' ? -1 : 1;
      return a.outlineIndex - b.outlineIndex;
    });
  const markerIndex = markers.findIndex(
    ({ entry }) => entry.kind === 'section' && entry.id === sectionEntry.id,
  );

  let endIndex = orderedBlockIds.length;
  for (let i = markerIndex + 1; i < markers.length; i += 1) {
    const next = markers[i];
    if (next.pageIndex > startIndex) {
      endIndex = next.pageIndex;
      break;
    }
    if (next.pageIndex === startIndex) {
      endIndex = startIndex + 1;
      break;
    }
  }

  return orderedBlockIds.slice(startIndex, endIndex);
}
