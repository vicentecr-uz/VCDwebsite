// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { suppressContentHmr } from './content-hmr-gate.mjs';

function mergeOverlays(file, inline) {
  if (!file && !inline) return undefined;
  return {
    hide: [...new Set([...(file?.hide ?? []), ...(inline?.hide ?? [])])],
    order: inline?.order ?? file?.order,
    prepend: [...(file?.prepend ?? []), ...(inline?.prepend ?? [])],
    append: [...(file?.append ?? []), ...(inline?.append ?? [])],
    insert: [...(file?.insert ?? []), ...(inline?.insert ?? [])],
  };
}

function applyInserts(entries, inserts) {
  let result = [...entries];

  for (let insertIndex = 0; insertIndex < inserts.length; insertIndex += 1) {
    const insert = inserts[insertIndex];
    const blocks = insert.sections ?? [];
    if (!blocks.length) continue;

    const tagged = blocks.map((section, sectionIndex) => ({
      section,
      source: {
        target: 'overlay',
        path: ['insert', insertIndex, 'sections', sectionIndex],
      },
    }));

    if (insert.after) {
      const index = result.findIndex(
        (entry) => String(entry.section?.id ?? '') === insert.after,
      );
      if (index >= 0) {
        result.splice(index + 1, 0, ...tagged);
        continue;
      }
    }

    if (insert.before) {
      const index = result.findIndex(
        (entry) => String(entry.section?.id ?? '') === insert.before,
      );
      if (index >= 0) {
        result.splice(index, 0, ...tagged);
        continue;
      }
    }

    result.push(...tagged);
  }

  return result;
}

export function buildViewSectionSources(baseSections, override) {
  let entries = baseSections.map((section, baseIndex) => ({
    section,
    source: { target: 'base', baseIndex },
  }));

  if (!override) return entries.map((entry) => entry.source);

  if (override.hide?.length) {
    const hidden = new Set(override.hide);
    entries = entries.filter(
      (entry) => !hidden.has(String(entry.section?.id ?? '')),
    );
  }

  if (override.prepend?.length) {
    const prepended = override.prepend.map((section, index) => ({
      section,
      source: { target: 'overlay', path: ['prepend', index] },
    }));
    entries = [...prepended, ...entries];
  }

  if (override.insert?.length) {
    entries = applyInserts(entries, override.insert);
  }

  if (override.append?.length) {
    const appended = override.append.map((section, index) => ({
      section,
      source: { target: 'overlay', path: ['append', index] },
    }));
    entries = [...entries, ...appended];
  }

  if (override.order?.length) {
    const order = new Map(override.order.map((id, index) => [id, index]));
    entries.sort((left, right) => {
      const leftOrder = order.get(String(left.section?.id ?? '')) ?? 999;
      const rightOrder = order.get(String(right.section?.id ?? '')) ?? 999;
      return leftOrder - rightOrder;
    });
  }

  return entries.map((entry) => entry.source);
}

export function overlayRelativePath(viewId, slug) {
  return `src/content/views/overlays/${viewId}/${slug}.json`;
}

export function projectRelativePath(slug) {
  return `src/content/projects/${slug}.json`;
}

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

function loadViewOverride(viewId, slug) {
  if (!viewId) return undefined;
  let file;
  try {
    file = loadJson(overlayRelativePath(viewId, slug));
  } catch {
    file = undefined;
  }
  let inline;
  try {
    const view = loadJson(`src/content/views/${viewId}.json`);
    inline = view.projects?.find((entry) => entry.slug === slug)?.sections;
  } catch {
    inline = undefined;
  }
  return mergeOverlays(file, inline);
}

export function viewSectionSourcesForSlug(slug, viewId) {
  const project = loadJson(projectRelativePath(slug));
  const baseSections = Array.isArray(project.sections) ? project.sections : [];
  return buildViewSectionSources(baseSections, loadViewOverride(viewId, slug));
}

export function resolveDevFieldTarget(slug, viewId, fieldPath) {
  if (!Array.isArray(fieldPath) || !fieldPath.length) {
    throw new Error('Invalid field path.');
  }

  if (!viewId || fieldPath[0] !== 'sections' || typeof fieldPath[1] !== 'number') {
    return {
      relativeFile: projectRelativePath(slug),
      path: fieldPath,
      ensureOverlay: false,
    };
  }

  const sources = viewSectionSourcesForSlug(slug, viewId);
  const source = sources[fieldPath[1]];
  if (!source) {
    throw new Error('That section index is out of date. Refresh and try again.');
  }

  const rest = fieldPath.slice(2);
  if (source.target === 'base') {
    return {
      relativeFile: projectRelativePath(slug),
      path: ['sections', source.baseIndex, ...rest],
      ensureOverlay: false,
    };
  }

  return {
    relativeFile: overlayRelativePath(viewId, slug),
    path: [...source.path, ...rest],
    ensureOverlay: true,
  };
}

async function ensureOverlayFile(relativeFile) {
  const absolute = path.join(process.cwd(), relativeFile);
  await mkdir(path.dirname(absolute), { recursive: true });
  if (!existsSync(absolute)) {
    await writeFile(absolute, '{}\n', 'utf8');
  }
}

export async function readDevDocument(relativeFile, { ensureOverlay = false } = {}) {
  if (ensureOverlay) await ensureOverlayFile(relativeFile);
  return JSON.parse(await readFile(path.join(process.cwd(), relativeFile), 'utf8'));
}

export async function writeDevDocument(relativeFile, data) {
  const absolute = path.join(process.cwd(), relativeFile);
  await mkdir(path.dirname(absolute), { recursive: true });
  suppressContentHmr();
  await writeFile(absolute, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function walkToNode(root, parts) {
  let target = root;
  for (const part of parts) {
    if (
      target === null ||
      typeof target !== 'object' ||
      !Object.prototype.hasOwnProperty.call(target, part)
    ) {
      return null;
    }
    target = target[part];
  }
  return target;
}

function sectionAtSource(slug, overlay, source) {
  if (source.target === 'base') {
    return loadJson(projectRelativePath(slug)).sections?.[source.baseIndex];
  }
  return walkToNode(overlay, source.path);
}

export async function insertViewSection(slug, viewId, viewIndex, section) {
  const relativeFile = overlayRelativePath(viewId, slug);
  const overlay = await readDevDocument(relativeFile, { ensureOverlay: true });
  const sources = viewSectionSourcesForSlug(slug, viewId);

  if (viewIndex >= sources.length) {
    overlay.append = Array.isArray(overlay.append) ? overlay.append : [];
    overlay.append.push(section);
    await writeDevDocument(relativeFile, overlay);
    return { relativeFile, section };
  }

  const anchorSection = sectionAtSource(slug, overlay, sources[viewIndex]);
  const anchorId = String(anchorSection?.id ?? '');

  overlay.insert = Array.isArray(overlay.insert) ? overlay.insert : [];
  overlay.insert.push({
    ...(anchorId ? { before: anchorId } : {}),
    sections: [section],
  });
  await writeDevDocument(relativeFile, overlay);
  return { relativeFile, section };
}

export async function deleteViewSection(slug, viewId, viewIndex) {
  const sources = viewSectionSourcesForSlug(slug, viewId);
  const source = sources[viewIndex];
  if (!source) {
    throw new Error('That section index is out of date. Refresh and try again.');
  }

  if (source.target === 'base') {
    const relativeFile = overlayRelativePath(viewId, slug);
    const overlay = await readDevDocument(relativeFile, { ensureOverlay: true });
    const baseSection = loadJson(projectRelativePath(slug)).sections?.[source.baseIndex];
    const sectionId = String(baseSection?.id ?? '');
    if (!sectionId) throw new Error('That section cannot be hidden.');
    overlay.hide = [...new Set([...(overlay.hide ?? []), sectionId])];
    await writeDevDocument(relativeFile, overlay);
    return { action: 'hide', sectionId };
  }

  const relativeFile = overlayRelativePath(viewId, slug);
  const overlay = await readDevDocument(relativeFile, { ensureOverlay: true });
  const sectionNode = walkToNode(overlay, source.path);
  const sectionId = String(sectionNode?.id ?? '');

  if (source.path[0] === 'prepend') {
    overlay.prepend.splice(Number(source.path[1]), 1);
  } else if (source.path[0] === 'append') {
    overlay.append.splice(Number(source.path[1]), 1);
  } else if (source.path[0] === 'insert') {
    const insertIndex = Number(source.path[1]);
    const sectionIndex = Number(source.path[3]);
    const block = overlay.insert?.[insertIndex];
    if (!block?.sections) throw new Error('That overlay section is out of date.');
    block.sections.splice(sectionIndex, 1);
    if (!block.sections.length) overlay.insert.splice(insertIndex, 1);
  } else {
    throw new Error('That section cannot be deleted.');
  }

  await writeDevDocument(relativeFile, overlay);
  return { action: 'delete', sectionId };
}
