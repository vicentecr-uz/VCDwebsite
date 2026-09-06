import {
  deriveNavFromOutline,
  normalizeOutline,
  outlineAnchorId,
  insertOutlineEntriesAtPagePosition,
  reorderOutlinePreservingGroups,
  type OutlineEntry,
  type SectionNavGroup,
  type SectionNavItem,
} from '../lib/projectOutline';

type NavLink = { id: string; label: string };
type NavGroup = { label: string; children: NavLink[]; defaultOpen?: boolean };
type NavItem = NavLink | NavGroup;

type StructureChangeDetail = {
  document?: string;
  action: 'insert' | 'delete';
  index?: number;
  type?: string;
  section?: Record<string, unknown>;
  sectionId?: string;
};

const mainScope = '[data-section-nav-main]';

let root: HTMLElement | null = null;
let documentKey = '';
const outline: OutlineEntry[] = [];
let preservedLinkTemplate: HTMLElement | null = null;
let preservedGroupTemplate: HTMLElement | null = null;
let outlineAbort: AbortController | null = null;

const parseJson = <T>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const sectionIndexFromPath = (pathRaw: string | undefined) => {
  const path = parseJson<Array<string | number>>(pathRaw, []);
  if (path[0] !== 'sections' || typeof path[1] !== 'number') return null;
  return path[1];
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

const isEditableBlock = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.closest(mainScope)) return false;
  if (el.classList.contains('section-block') && el.id) return true;
  return sectionIndexFromPath(el.dataset.devSpacingPath) !== null;
};

const editableBlocks = () =>
  [
    ...document.querySelectorAll<HTMLElement>(`${mainScope} [data-dev-spacing-path]`),
    ...document.querySelectorAll<HTMLElement>(`${mainScope} .section-block[id]`),
  ].filter((el, index, all) => all.indexOf(el) === index && isEditableBlock(el));

const pageIndexForId = (id: string) => {
  if (!id) return Number.POSITIVE_INFINITY;
  const blocks = editableBlocks();
  const byId = blocks.findIndex((el) => el.id === id);
  if (byId >= 0) return byId;
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) return Number.POSITIVE_INFINITY;
  const idx = blocks.indexOf(el);
  return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
};

const writeRootDatasets = () => {
  if (!root) return;
  const nav = deriveNavFromOutline(outline);
  root.dataset.sectionOutline = JSON.stringify(outline);
  root.dataset.sectionNav = JSON.stringify(nav);
};

const applyBlockSectionId = (block: HTMLElement, id: string | null) => {
  if (id) {
    block.id = id;
    block.classList.add('section-block');
    block.dataset.devSectionTitle = 'true';
  }
};

export function getDevSectionOutline() {
  return outline;
}

export function setDevSectionOutline(entries: OutlineEntry[]) {
  // Caller may pass the live module array — copy before clear/push.
  const next = entries === outline ? [...entries] : entries;
  outline.length = 0;
  outline.push(...next);
  writeRootDatasets();
}

export function remapDevSectionOutlineId(clientId: string, serverId: string) {
  if (!clientId || !serverId || clientId === serverId) return;
  for (let i = 0; i < outline.length; i += 1) {
    const entry = outline[i];
    if (entry.kind === 'group') {
      if (entry.anchor !== clientId) continue;
      outline[i] = { ...entry, anchor: serverId };
      continue;
    }
    if (entry.kind !== 'section') continue;
    if (outlineAnchorId(entry) !== clientId && entry.id !== clientId) continue;
    outline[i] = { ...entry, id: serverId, anchor: serverId };
  }
  const block = document.getElementById(clientId);
  if (block instanceof HTMLElement) {
    block.id = serverId;
  }
  syncDevSectionOutlineSidebar();
}

const isSectionEditorActive = () =>
  document.documentElement.classList.contains('show-section-nav-editor') &&
  document.documentElement.classList.contains('is-dev-mode');

const clearGroupAnimState = (groupEl: HTMLElement) => {
  const content = groupEl.querySelector<HTMLElement>('.section-sidebar-nav__group-content');
  if (!content) return;
  content.classList.remove('is-expanding', 'is-collapsing');
  content.style.height = '';
  content.style.transition = '';
  content.style.opacity = '';
  content.style.overflow = '';
  content.style.minHeight = '';
  content.style.gridTemplateRows = '';
  content.style.display = '';
  content.querySelectorAll<HTMLElement>('.section-sidebar-nav__link').forEach((link) => {
    link.style.transition = '';
  });
  content.querySelectorAll<HTMLElement>('.section-sidebar-nav__children > li').forEach((row) => {
    row.style.opacity = '';
  });
};

export function syncDevSectionOutlineSidebar() {
  const list = document.querySelector<HTMLElement>('[data-section-sidebar-list]');
  if (!root) {
    root = document.querySelector<HTMLElement>('[data-section-nav-root]');
    documentKey = root?.dataset.sectionNavDocument?.trim() || '';
  }
  if (!list || !root) return;

  if (!outline.length) {
    loadOutlineFromRoot();
  }

  const sorted = reorderOutlinePreservingGroups(outline, pageIndexForId);
  outline.length = 0;
  outline.push(...sorted);
  const nav = deriveNavFromOutline(outline) as NavItem[];

  if (!nav.length) return;

  const editorMode = isSectionEditorActive();
  const openStateByLabel = new Map<string, boolean>();
  if (!editorMode) {
    list.querySelectorAll<HTMLElement>('[data-section-nav-group]').forEach((el) => {
      const label = el.dataset.navLabel;
      const details = el.querySelector('details');
      if (label && details) openStateByLabel.set(label, details.open);
    });
  }

  writeRootDatasets();

  const liveLinkTemplate = list.querySelector<HTMLElement>('[data-section-nav-link]');
  const liveGroupTemplate = list.querySelector<HTMLElement>('[data-section-nav-group]');
  if (liveLinkTemplate) {
    preservedLinkTemplate = liveLinkTemplate.cloneNode(true) as HTMLElement;
  }
  if (liveGroupTemplate) {
    preservedGroupTemplate = liveGroupTemplate.cloneNode(true) as HTMLElement;
  }

  const linkTemplate = liveLinkTemplate ?? preservedLinkTemplate;
  const groupTemplate = liveGroupTemplate ?? preservedGroupTemplate;
  if (!linkTemplate) return;

  const existingLinks = new Map<string, HTMLElement>();
  list.querySelectorAll<HTMLElement>('[data-section-nav-link]').forEach((el) => {
    const id = el.dataset.navId;
    if (id) existingLinks.set(id, el);
  });
  const existingGroups = new Map<string, HTMLElement>();
  list.querySelectorAll<HTMLElement>('[data-section-nav-group]').forEach((el) => {
    const label =
      el.dataset.navLabel ||
      el.querySelector('[data-section-nav-label]')?.textContent?.trim() ||
      '';
    if (label) existingGroups.set(label, el);
  });

  const ensureLink = (link: NavLink, rootLink: boolean) => {
    let el = existingLinks.get(link.id);
    if (!el) el = (preservedLinkTemplate ?? linkTemplate).cloneNode(true) as HTMLElement;
    el.dataset.navId = link.id;
    el.dataset.navLabel = link.label;
    const anchor = el.querySelector('a');
    if (anchor) {
      anchor.href = `#${link.id}`;
      anchor.textContent = link.label;
      anchor.className = rootLink
        ? 'section-sidebar-nav__link section-sidebar-nav__root-link'
        : 'section-sidebar-nav__link';
    }
    return el;
  };

  const ensureGroup = (label: string, defaultOpen: boolean) => {
    const isNewGroup = !existingGroups.has(label);
    let groupEl = existingGroups.get(label);
    if (!groupEl) {
      if (!groupTemplate) return null;
      groupEl = groupTemplate.cloneNode(true) as HTMLElement;
    }
    groupEl.dataset.navLabel = label;
    const labelEl = groupEl.querySelector<HTMLElement>('[data-section-nav-label]');
    if (labelEl) labelEl.textContent = label;
    const details = groupEl.querySelector('details');
    if (details) {
      clearGroupAnimState(groupEl);
      if (openStateByLabel.has(label)) {
        details.open = openStateByLabel.get(label) !== false;
      } else if (editorMode && isNewGroup) {
        // SectionSidebarNav openClosedGroups animates expand on level-2 entry.
        details.open = false;
      } else if (!editorMode) {
        details.open = defaultOpen;
      }
      // editorMode + reused group: keep details.open — openClosedGroups expands closed ones.
    }
    groupEl.querySelector<HTMLElement>('.section-sidebar-nav__children')?.replaceChildren();
    return groupEl;
  };

  const kept = new Set<HTMLElement>();
  for (const item of nav) {
    if ('children' in item) {
      const group = item as SectionNavGroup;
      const groupEl = ensureGroup(group.label, group.defaultOpen !== false);
      const childList = groupEl?.querySelector<HTMLElement>('.section-sidebar-nav__children');
      if (!groupEl || !childList) continue;
      for (const child of group.children) {
        childList.append(ensureLink(child, false));
      }
      list.append(groupEl);
      kept.add(groupEl);
    } else {
      const linkEl = ensureLink(item as NavLink, true);
      list.append(linkEl);
      kept.add(linkEl);
    }
  }
  [...list.children].forEach((child) => {
    if (child instanceof HTMLElement && !kept.has(child)) child.remove();
  });

  if (editorMode) {
    window.dispatchEvent(new CustomEvent('vcd:section-nav-sidebar-synced'));
  }
}

const syncOutlineForStructureChange = (detail: StructureChangeDetail) => {
  if (detail.document && detail.document !== documentKey) return;

  let changed = false;

  if (detail.action === 'insert' && detail.type === 'sectionTitle' && typeof detail.index === 'number') {
    const section = detail.section;
    const sectionId = String(
      detail.sectionId || section?.sectionId || section?.id || '',
    ).trim();
    if (!sectionId) return;

    const block = editableBlocks().find(
      (el) => sectionIndexFromPath(el.dataset.devSpacingPath) === detail.index,
    );
    if (block) applyBlockSectionId(block, sectionId);

    const labelFromDom = block
      ?.querySelector<HTMLElement>('.project-section-title, [data-dev-text-document]')
      ?.textContent
      ?.trim();
    const label = labelFromDom
      || (typeof section?.title === 'string' ? section.title.trim() : '')
      || 'Section title';

    if (outline.some((entry) => entry.kind === 'section' && outlineAnchorId(entry) === sectionId)) {
      return;
    }

    const next = insertOutlineEntriesAtPagePosition(
      outline,
      sectionId,
      [{
        kind: 'section',
        id: sectionId,
        label,
        anchor: sectionId,
      }],
      pageIndexForId,
    );
    outline.length = 0;
    outline.push(...next);
    changed = true;
  } else if (detail.action === 'delete') {
    const sectionId = String(detail.sectionId || '').trim();
    if (sectionId) {
      const kept = outline.filter(
        (entry) => outlineAnchorId(entry) !== sectionId && entry.id !== sectionId,
      );
      outline.length = 0;
      outline.push(...kept);
      changed = true;
    }
  }

  if (!changed) return;
  syncDevSectionOutlineSidebar();
};

const loadOutlineFromRoot = () => {
  if (!root) return;
  let next = normalizeOutline(parseJson(root.dataset.sectionOutline, []));
  if (!next.length) {
    const nav = parseJson<NavItem[]>(root.dataset.sectionNav, []);
    for (const item of nav) {
      if (item && typeof item === 'object' && 'children' in item) {
        const group = item as NavGroup;
        next.push({
          kind: 'group',
          id: slugify(group.label),
          label: group.label,
          defaultOpen: group.defaultOpen !== false,
          anchor: group.children[0]?.id,
        });
        for (const child of group.children) {
          next.push({
            kind: 'section',
            id: child.id,
            label: child.label,
            anchor: child.id,
          });
        }
      } else if (item && 'id' in item) {
        next.push({
          kind: 'section',
          id: item.id,
          label: item.label,
          anchor: item.id,
        });
      }
    }
  }
  outline.length = 0;
  outline.push(...next);
  writeRootDatasets();
};

/** Reload outline from SSR datasets and rebuild the sidebar (e.g. after section editor exits). */
export function restoreDevSectionOutlineFromRoot() {
  if (!root) {
    root = document.querySelector<HTMLElement>('[data-section-nav-root]');
    documentKey = root?.dataset.sectionNavDocument?.trim() || '';
  }
  if (!root) return;
  loadOutlineFromRoot();
  syncDevSectionOutlineSidebar();
}

export function disposeDevSectionOutlineSync() {
  outlineAbort?.abort();
  outlineAbort = null;
  document.documentElement.dataset.devSectionOutlineSync = '';
  root = null;
  documentKey = '';
  outline.length = 0;
  preservedLinkTemplate = null;
  preservedGroupTemplate = null;
}

export function initDevSectionOutlineSync() {
  if (document.documentElement.dataset.devSectionOutlineSync === '1') return;
  root = document.querySelector<HTMLElement>('[data-section-nav-root]');
  documentKey = root?.dataset.sectionNavDocument?.trim() || '';
  if (!root || !documentKey) return;

  document.documentElement.dataset.devSectionOutlineSync = '1';
  outlineAbort = new AbortController();
  const { signal } = outlineAbort;
  loadOutlineFromRoot();

  window.addEventListener('vcd:dev-section-structure-changed', ((event: CustomEvent<StructureChangeDetail>) => {
    syncOutlineForStructureChange(event.detail ?? { action: 'delete' });
  }) as EventListener, { signal });

  window.addEventListener('vcd:dev-section-outline-label', ((event: CustomEvent<{
    document?: string;
    sectionId?: string;
    label?: string;
  }>) => {
    const { document: doc, sectionId, label } = event.detail ?? {};
    if ((doc && doc !== documentKey) || !sectionId || !label?.trim()) return;
    for (let i = 0; i < outline.length; i += 1) {
      const entry = outline[i];
      if (entry.kind !== 'section') continue;
      if (outlineAnchorId(entry) !== sectionId && entry.id !== sectionId) continue;
      outline[i] = { ...entry, label: label.trim() };
    }
    syncDevSectionOutlineSidebar();
  }) as EventListener, { signal });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeDevSectionOutlineSync());
}
