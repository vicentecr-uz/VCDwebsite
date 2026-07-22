import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { OutlineEntry } from './projectOutline';
import { normalizeOutline, outlineAnchorId } from './projectOutline';

export type ViewSectionInsert = {
  after?: string;
  before?: string;
  sections: Array<Record<string, unknown>>;
};

export type ViewSectionOverlay = {
  hide?: string[];
  order?: string[];
  prepend?: Array<Record<string, unknown>>;
  append?: Array<Record<string, unknown>>;
  insert?: ViewSectionInsert[];
};

export type ViewProjectOverride = {
  slug: string;
  order?: number;
  card?: Record<string, unknown>;
  /** Small inline overrides; large overlays live in overlays/{viewId}/{slug}.json */
  sections?: ViewSectionOverlay;
};

export type SiteViewConfig = {
  id: string;
  title?: string;
  site?: {
    nav?: string[];
    homeLayout?: string;
  };
  projects: ViewProjectOverride[];
};

const viewModules = import.meta.glob<{ default: SiteViewConfig }>(
  '../content/views/*.json',
  { eager: true },
);

const overlayModules = import.meta.glob<{ default: ViewSectionOverlay }>(
  '../content/views/overlays/*/*.json',
  { eager: true },
);

export function getActiveViewId(): string | undefined {
  const id = import.meta.env.VIEW_ID;
  return id ? String(id) : undefined;
}

export function loadViewConfig(viewId?: string): SiteViewConfig | undefined {
  const id = viewId ?? getActiveViewId();
  if (!id || id.startsWith('_')) return undefined;
  const entry = viewModules[`../content/views/${id}.json`];
  return entry?.default;
}

export function loadSectionOverlay(viewId: string, slug: string): ViewSectionOverlay | undefined {
  if (import.meta.env.DEV) {
    try {
      const file = path.join(
        process.cwd(),
        'src/content/views/overlays',
        viewId,
        `${slug}.json`,
      );
      if (existsSync(file)) {
        return JSON.parse(readFileSync(file, 'utf8')) as ViewSectionOverlay;
      }
    } catch {
      // Fall through to the build-time glob cache.
    }
  }
  return overlayModules[`../content/views/overlays/${viewId}/${slug}.json`]?.default;
}

export function isViewBuild(): boolean {
  return Boolean(getActiveViewId());
}

function mergeOverlays(
  file?: ViewSectionOverlay,
  inline?: ViewSectionOverlay,
): ViewSectionOverlay | undefined {
  if (!file && !inline) return undefined;
  return {
    hide: [...new Set([...(file?.hide ?? []), ...(inline?.hide ?? [])])],
    order: inline?.order ?? file?.order,
    prepend: [...(file?.prepend ?? []), ...(inline?.prepend ?? [])],
    append: [...(file?.append ?? []), ...(inline?.append ?? [])],
    insert: [...(file?.insert ?? []), ...(inline?.insert ?? [])],
  };
}

function applyInserts(
  sections: Array<Record<string, unknown>>,
  inserts: ViewSectionInsert[],
): Array<Record<string, unknown>> {
  let result = [...sections];

  for (const insert of inserts) {
    const blocks = insert.sections ?? [];
    if (!blocks.length) continue;

    if (insert.after) {
      const index = result.findIndex((section) => String(section.id ?? '') === insert.after);
      if (index >= 0) {
        result.splice(index + 1, 0, ...blocks);
        continue;
      }
    }

    if (insert.before) {
      const index = result.findIndex((section) => String(section.id ?? '') === insert.before);
      if (index >= 0) {
        result.splice(index, 0, ...blocks);
        continue;
      }
    }

    result.push(...blocks);
  }

  return result;
}

export function applyViewToSections(
  slug: string,
  sections: Array<Record<string, unknown>>,
  viewIdOverride?: string,
): Array<Record<string, unknown>> {
  const viewId = viewIdOverride ?? getActiveViewId();
  if (!viewId) return sections;

  const inline = loadViewConfig(viewId)?.projects.find((entry) => entry.slug === slug)?.sections;
  const file = loadSectionOverlay(viewId, slug);
  const override = mergeOverlays(file, inline);
  if (!override) return sections;

  let result = [...sections];

  if (override.hide?.length) {
    const hidden = new Set(override.hide);
    result = result.filter((section) => !hidden.has(String(section.id ?? '')));
  }

  if (override.prepend?.length) {
    result = [...override.prepend, ...result];
  }

  if (override.insert?.length) {
    result = applyInserts(result, override.insert);
  }

  if (override.append?.length) {
    result = [...result, ...override.append];
  }

  if (override.order?.length) {
    const order = new Map(override.order.map((id, index) => [id, index]));
    result.sort((left, right) => {
      const leftOrder = order.get(String(left.id ?? '')) ?? 999;
      const rightOrder = order.get(String(right.id ?? '')) ?? 999;
      return leftOrder - rightOrder;
    });
  }

  return result;
}

export function applyViewToOutline(
  slug: string,
  outline: OutlineEntry[],
  baseSections: Array<Record<string, unknown>>,
  viewIdOverride?: string,
): OutlineEntry[] {
  const viewId = viewIdOverride ?? getActiveViewId();
  if (!viewId) return outline;

  const inline = loadViewConfig(viewId)?.projects.find((entry) => entry.slug === slug)?.sections;
  const file = loadSectionOverlay(viewId, slug);
  const override = mergeOverlays(file, inline);
  if (!override) return outline;

  const hiddenIds = new Set(override.hide ?? []);
  const hiddenAnchors = new Set<string>();
  for (const section of baseSections) {
    const id = String(section.id ?? '');
    if (!hiddenIds.has(id)) continue;
    hiddenAnchors.add(id);
    const sectionId = String(section.sectionId ?? '');
    if (sectionId) hiddenAnchors.add(sectionId);
  }

  let result = normalizeOutline(outline).filter((entry) => {
    const anchor = outlineAnchorId(entry);
    return !hiddenAnchors.has(anchor) && !hiddenAnchors.has(entry.id);
  });

  for (const insert of override.insert ?? []) {
    for (const block of insert.sections ?? []) {
      if (String(block.type ?? '') !== 'sectionTitle') continue;
      const anchor = String(block.sectionId ?? block.id ?? '');
      const label = String(block.title ?? anchor);
      if (!anchor) continue;

      const entry: OutlineEntry = {
        kind: 'section',
        id: anchor,
        label,
        anchor,
      };

      let insertIndex = result.length;
      if (insert.after) {
        const afterSection = baseSections.find((section) => String(section.id ?? '') === insert.after);
        const afterAnchor = afterSection
          ? String(afterSection.sectionId ?? afterSection.id ?? '')
          : insert.after;
        const index = result.findIndex((item) => (
          outlineAnchorId(item) === afterAnchor || item.id === afterAnchor
        ));
        if (index >= 0) insertIndex = index + 1;
      } else if (insert.before) {
        const beforeSection = baseSections.find((section) => String(section.id ?? '') === insert.before);
        const beforeAnchor = beforeSection
          ? String(beforeSection.sectionId ?? beforeSection.id ?? '')
          : insert.before;
        const index = result.findIndex((item) => (
          outlineAnchorId(item) === beforeAnchor || item.id === beforeAnchor
        ));
        if (index >= 0) insertIndex = index;
      }

      result.splice(insertIndex, 0, entry);
    }
  }

  return result;
}
