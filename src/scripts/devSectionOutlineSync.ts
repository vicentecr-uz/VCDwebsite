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

type NavLink = { id: string; label: string; outlineId?: string };
type NavGroup = { label: string; children: NavLink[]; defaultOpen?: boolean; id?: string; anchor?: string };
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
let outlineAbort: AbortController | null = null;
let outlineInitialized = false;

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
  outlineInitialized = true;
  writeRootDatasets();
}

export function remapDevSectionOutlineId(clientId: string, serverId: string) {
  if (!clientId || !serverId || clientId === serverId) return;
  for (let i = 0; i < outline.length; i += 1) {
    const entry = outline[i];
    if (entry.kind === 'group') {
      if (outlineAnchorId(entry) !== clientId) continue;
      outline[i] = { ...entry, anchor: serverId };
      continue;
    }
    if (entry.kind !== 'section') continue;
    if (outlineAnchorId(entry) !== clientId && entry.id !== clientId) continue;
    outline[i] = { ...entry, anchor: serverId };
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

  if (!outlineInitialized) {
    loadOutlineFromRoot();
  }

  const sorted = reorderOutlinePreservingGroups(outline, pageIndexForId);
  outline.length = 0;
  outline.push(...sorted);
  const nav = deriveNavFromOutline(outline) as NavItem[];
  list.closest<HTMLElement>('[data-section-sidebar]')?.classList.toggle(
    'section-sidebar-nav--empty',
    nav.length === 0,
  );

  const editorMode = isSectionEditorActive();
  const openStateById = new Map<string, boolean>();
  if (!editorMode) {
    list.querySelectorAll<HTMLElement>('[data-section-nav-group]').forEach((el, index) => {
      const id = el.dataset.outlineId || `legacy-group-${index}`;
      const details = el.querySelector('details');
      if (details) openStateById.set(id, details.open);
    });
  }

  writeRootDatasets();

  const existingLinks = new Map<string, HTMLElement>();
  list.querySelectorAll<HTMLElement>('[data-section-nav-link]').forEach((el, index) => {
    const id = el.dataset.outlineId || el.dataset.navId || `legacy-link-${index}`;
    if (id) existingLinks.set(id, el);
  });
  const existingGroups = new Map<string, HTMLElement>();
  list.querySelectorAll<HTMLElement>('[data-section-nav-group]').forEach((el, index) => {
    const id = el.dataset.outlineId || `legacy-group-${index}`;
    existingGroups.set(id, el);
  });

  const ensureLink = (link: NavLink, rootLink: boolean) => {
    const markerId = link.outlineId || link.id;
    let el = existingLinks.get(markerId);
    if (!el) {
      el = document.createElement('li');
      el.setAttribute('data-section-nav-link', '');
      el.append(document.createElement('a'));
    }
    el.dataset.navId = link.id;
    el.dataset.outlineId = markerId;
    el.dataset.outlineKind = 'section';
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

  const ensureGroup = (group: SectionNavGroup, groupIndex: number) => {
    const markerId = group.id || `legacy-group-${groupIndex}`;
    const isNewGroup = !existingGroups.has(markerId);
    let groupEl = existingGroups.get(markerId);
    if (!groupEl) {
      groupEl = document.createElement('li');
      groupEl.className = 'section-sidebar-nav__group-item';
      groupEl.setAttribute('data-section-nav-group', '');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.className = 'section-sidebar-nav__summary';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 8 12');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M1.5 1.5 6 6l-4.5 4.5');
      svg.append(path);
      const labelEl = document.createElement('span');
      labelEl.setAttribute('data-section-nav-label', '');
      summary.append(svg, labelEl);
      const content = document.createElement('div');
      content.className = 'section-sidebar-nav__group-content';
      const children = document.createElement('ul');
      children.className = 'section-sidebar-nav__children';
      content.append(children);
      details.append(summary, content);
      groupEl.append(details);
    }
    groupEl.dataset.outlineId = markerId;
    groupEl.dataset.outlineKind = 'group';
    groupEl.dataset.navAnchor = group.anchor || '';
    groupEl.dataset.navLabel = group.label;
    const labelEl = groupEl.querySelector<HTMLElement>('[data-section-nav-label]');
    if (labelEl) labelEl.textContent = group.label;
    const details = groupEl.querySelector('details');
    if (details) {
      clearGroupAnimState(groupEl);
      if (openStateById.has(markerId)) {
        details.open = openStateById.get(markerId) !== false;
      } else if (editorMode && isNewGroup) {
        // SectionSidebarNav openClosedGroups animates expand on level-2 entry.
        details.open = false;
      } else if (!editorMode) {
        details.open = group.defaultOpen !== false;
      }
      // editorMode + reused group: keep details.open — openClosedGroups expands closed ones.
    }
    return groupEl;
  };

  const kept = new Set<HTMLElement>();
  nav.forEach((item, itemIndex) => {
    if ('children' in item) {
      const group = item as SectionNavGroup;
      const groupEl = ensureGroup(group, itemIndex);
      const childList = groupEl?.querySelector<HTMLElement>('.section-sidebar-nav__children');
      if (!groupEl || !childList) return;
      const groupLinks = new Set<HTMLElement>();
      for (const child of group.children) {
        const linkEl = ensureLink(child, false);
        childList.append(linkEl);
        groupLinks.add(linkEl);
      }
      [...childList.children].forEach((child) => {
        if (child instanceof HTMLElement && !groupLinks.has(child)) child.remove();
      });
      list.append(groupEl);
      kept.add(groupEl);
    } else {
      const linkEl = ensureLink(item as NavLink, true);
      list.append(linkEl);
      kept.add(linkEl);
    }
  });
  [...list.children].forEach((child) => {
    if (child instanceof HTMLElement && !kept.has(child)) child.remove();
  });

  window.dispatchEvent(new CustomEvent('vcd:section-nav-sidebar-synced'));
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
  const hasOutlineDataset = root.hasAttribute('data-section-outline');
  let next = normalizeOutline(parseJson(root.dataset.sectionOutline, []));
  if (!hasOutlineDataset) {
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
  outlineInitialized = true;
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
  delete document.documentElement.dataset.devSectionOutlineSync;
  root = null;
  documentKey = '';
  outline.length = 0;
  outlineInitialized = false;
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
