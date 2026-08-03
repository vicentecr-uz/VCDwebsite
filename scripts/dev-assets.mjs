// @ts-check
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { suppressContentHmr } from './content-hmr-gate.mjs';

const DRAFT_PREFIX = 'draft:';
const UNASSIGNED_SLUG = '__unassigned__';
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif']);
const DEFAULT_COVER = '/images/black-token.svg';

/** @param {string} slug @param {string} filename */
function draftMediaSrc(slug, filename) {
  return `${DRAFT_PREFIX}${slug}/${filename}`;
}

/** @param {string} relativeFile @param {unknown} data */
async function writeProjectJson(relativeFile, data) {
  suppressContentHmr();
  await writeFile(
    path.join(process.cwd(), relativeFile),
    `${JSON.stringify(data, null, 2)}\n`,
    'utf8',
  );
}

/** @param {string} value */
export function normalizeAssetSrc(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'placeholder.svg' || raw.endsWith('/placeholder.svg')) return '';
  if (raw.startsWith(DRAFT_PREFIX)) return raw;
  if (raw.startsWith('/draft-media/')) {
    return `${DRAFT_PREFIX}${decodeURIComponent(raw.slice('/draft-media/'.length))}`;
  }
  if (raw.startsWith('/images/')) {
    return decodeURIComponent(raw.slice('/images/'.length));
  }
  if (raw.startsWith('/')) return '';
  return raw;
}

/** @param {string} src */
export function assetUrlFromSrc(src) {
  const token = normalizeAssetSrc(src);
  if (!token) return '';
  if (token.startsWith(DRAFT_PREFIX)) {
    const draftPath = token.slice(DRAFT_PREFIX.length);
    return `/draft-media/${draftPath.split('/').map(encodeURIComponent).join('/')}`;
  }
  return `/images/${token.split('/').map(encodeURIComponent).join('/')}`;
}

/** @param {string} src */
export function resolveAssetFilePath(src) {
  const token = normalizeAssetSrc(src);
  if (!token) return null;
  if (token.startsWith(DRAFT_PREFIX)) {
    const relative = token.slice(DRAFT_PREFIX.length);
    if (!relative || relative.includes('..')) return null;
    return path.join(process.cwd(), 'src/content/drafts/media', relative);
  }
  if (token.includes('..')) return null;
  return path.join(process.cwd(), 'public/images', token);
}

/**
 * Collect image-like src tokens from a project document.
 * @param {unknown} node
 * @param {Set<string>} out
 */
function collectSrcTokens(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectSrcTokens(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;

  /** @type {Record<string, unknown>} */
  const obj = /** @type {Record<string, unknown>} */ (node);

  if (typeof obj.src === 'string') {
    const token = normalizeAssetSrc(obj.src);
    if (token) out.add(token);
  }
  if (typeof obj.image === 'string') {
    const token = normalizeAssetSrc(obj.image);
    if (token) out.add(token);
  }
  if (typeof obj.coverImage === 'string') {
    const token = normalizeAssetSrc(obj.coverImage);
    if (token) out.add(token);
  }

  for (const value of Object.values(obj)) {
    collectSrcTokens(value, out);
  }
}

/** @param {string} filename */
function isImageFilename(filename) {
  return IMAGE_EXT.has(path.extname(filename).toLowerCase());
}

/**
 * @returns {Promise<{
 *   projects: Array<{ slug: string, title: string }>,
 *   assets: Array<{
 *     id: string,
 *     src: string,
 *     url: string,
 *     projectSlug: string,
 *     onPage: boolean,
 *     filename: string,
 *   }>,
 * }>}
 */
export async function listDevAssets(filterProject = '') {
  const projectsDir = path.join(process.cwd(), 'src/content/projects');
  const draftsRoot = path.join(process.cwd(), 'src/content/drafts/media');
  const publicDir = path.join(process.cwd(), 'public/images');

  /** @type {Array<{ slug: string, title: string }>} */
  const projects = [];
  /** @type {Map<string, Set<string>>} */
  const refsByProject = new Map();
  /** @type {Set<string>} */
  const allReferenced = new Set();

  let projectFiles = [];
  try {
    projectFiles = readdirSync(projectsDir).filter((file) => file.endsWith('.json'));
  } catch {
    projectFiles = [];
  }

  for (const file of projectFiles) {
    const slug = file.replace(/\.json$/, '');
    try {
      const data = JSON.parse(await readFile(path.join(projectsDir, file), 'utf8'));
      projects.push({
        slug,
        title: String(data.title || slug),
      });
      const refs = new Set();
      collectSrcTokens(data, refs);
      refsByProject.set(slug, refs);
      for (const src of refs) allReferenced.add(src);
    } catch {
      projects.push({ slug, title: slug });
      refsByProject.set(slug, new Set());
    }
  }

  projects.sort((a, b) => a.title.localeCompare(b.title));

  /** @type {Map<string, {
   *   id: string,
   *   src: string,
   *   url: string,
   *   projectSlug: string,
   *   onPage: boolean,
   *   filename: string,
   * }>} */
  const assets = new Map();

  const addAsset = (src, projectSlug, onPage) => {
    const token = normalizeAssetSrc(src);
    if (!token) return;
    const key = `${projectSlug}::${token}`;
    const existing = assets.get(key);
    if (existing) {
      existing.onPage = existing.onPage || onPage;
      return;
    }
    const filename = token.startsWith(DRAFT_PREFIX)
      ? token.slice(token.lastIndexOf('/') + 1)
      : path.basename(token);
    assets.set(key, {
      id: key,
      src: token,
      url: assetUrlFromSrc(token),
      projectSlug,
      onPage,
      filename,
    });
  };

  // Draft media folders — attributed to their slug.
  try {
    for (const slug of readdirSync(draftsRoot)) {
      const dir = path.join(draftsRoot, slug);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const refs = refsByProject.get(slug) ?? new Set();
      for (const filename of readdirSync(dir)) {
        if (!isImageFilename(filename)) continue;
        const src = draftMediaSrc(slug, filename);
        addAsset(src, slug, refs.has(src));
      }
    }
  } catch {
    // No drafts yet.
  }

  // Referenced public images — attribute to each project that references them.
  for (const [slug, refs] of refsByProject) {
    for (const src of refs) {
      if (src.startsWith(DRAFT_PREFIX)) continue;
      const filePath = resolveAssetFilePath(src);
      if (!filePath || !existsSync(filePath)) {
        // Still list referenced missing files as on-page so editors can see the gap.
        addAsset(src, slug, true);
        continue;
      }
      addAsset(src, slug, true);
    }
  }

  // Unreferenced top-level public images → Unassigned.
  try {
    for (const filename of readdirSync(publicDir)) {
      if (!isImageFilename(filename)) continue;
      const filePath = path.join(publicDir, filename);
      try {
        if (!statSync(filePath).isFile()) continue;
      } catch {
        continue;
      }
      if (filename === 'placeholder.svg' || filename === 'black-token.svg') continue;
      if (allReferenced.has(filename)) continue;
      addAsset(filename, UNASSIGNED_SLUG, false);
    }
  } catch {
    // public/images missing
  }

  let list = [...assets.values()];
  const projectFilter = String(filterProject || '').trim();
  if (projectFilter && projectFilter !== UNASSIGNED_SLUG) {
    list = list.filter((asset) => asset.projectSlug === projectFilter);
  } else if (projectFilter === UNASSIGNED_SLUG) {
    list = list.filter((asset) => asset.projectSlug === UNASSIGNED_SLUG);
  }

  list.sort((a, b) => {
    if (a.projectSlug !== b.projectSlug) return a.projectSlug.localeCompare(b.projectSlug);
    return a.filename.localeCompare(b.filename);
  });

  const projectRows = [
    ...projects,
    { slug: UNASSIGNED_SLUG, title: 'Unassigned' },
  ];

  return { projects: projectRows, assets: list };
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

  if (Array.isArray(data.sections)) {
    const nextSections = [];
    for (const section of data.sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        nextSections.push(section);
        continue;
      }
      /** @type {Record<string, unknown>} */
      const node = /** @type {Record<string, unknown>} */ (section);
      const type = String(node.type || '');

      if ((type === 'image' || type === 'placeholder') && matches(node.src)) {
        removed += 1;
        continue;
      }

      if ((type === 'imageGrid' || type === 'imageCarousel') && Array.isArray(node.items)) {
        const before = node.items.length;
        const kept = node.items.filter((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
          return !matches(/** @type {Record<string, unknown>} */ (item).src);
        });
        const removedIds = new Set(
          node.items
            .filter((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
              return matches(/** @type {Record<string, unknown>} */ (item).src);
            })
            .map((item) => String(/** @type {Record<string, unknown>} */ (item).id || '')),
        );
        if (kept.length !== before) {
          removed += before - kept.length;
          node.items = kept;
          if (Array.isArray(node.visible)) {
            node.visible = node.visible.filter((id) => !removedIds.has(String(id)));
            if (!node.visible.length) delete node.visible;
          }
          if (node.layouts && typeof node.layouts === 'object' && !Array.isArray(node.layouts)) {
            for (const layout of Object.values(/** @type {Record<string, unknown>} */ (node.layouts))) {
              if (!layout || typeof layout !== 'object' || Array.isArray(layout)) continue;
              const visible = /** @type {Record<string, unknown>} */ (layout).visible;
              if (!Array.isArray(visible)) continue;
              /** @type {Record<string, unknown>} */ (layout).visible = visible.filter(
                (id) => !removedIds.has(String(id)),
              );
            }
          }
          if (
            node.breakpoints
            && typeof node.breakpoints === 'object'
            && !Array.isArray(node.breakpoints)
          ) {
            for (const bp of Object.values(/** @type {Record<string, unknown>} */ (node.breakpoints))) {
              if (!bp || typeof bp !== 'object' || Array.isArray(bp)) continue;
              const visible = /** @type {Record<string, unknown>} */ (bp).visible;
              if (!Array.isArray(visible)) continue;
              /** @type {Record<string, unknown>} */ (bp).visible = visible.filter(
                (id) => !removedIds.has(String(id)),
              );
            }
          }
        }
      }

      nextSections.push(node);
    }
    data.sections = nextSections;
  }

  if (data.listings && typeof data.listings === 'object' && !Array.isArray(data.listings)) {
    for (const listing of Object.values(/** @type {Record<string, unknown>} */ (data.listings))) {
      if (!listing || typeof listing !== 'object' || Array.isArray(listing)) continue;
      const card = /** @type {Record<string, unknown>} */ (listing);
      if (matches(card.image)) {
        card.image = DEFAULT_COVER;
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

/**
 * Remove one media item from a grid/carousel section by item id (file stays on disk).
 * @param {Record<string, unknown>} data
 * @param {Array<string | number>} fieldPath
 * @param {string} itemId
 */
export function removeMediaItemFromDocument(data, fieldPath, itemId) {
  const id = String(itemId || '');
  if (!id) throw new Error('An item id is required.');
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
  const type = String(node.type || '');
  if (type !== 'imageGrid' && type !== 'imageCarousel') {
    throw new Error('Only image grids and carousels support remove-from-page.');
  }
  if (!Array.isArray(node.items)) {
    throw new Error('That media block has no items.');
  }

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

/**
 * @param {string} src
 */
export async function deleteDevAsset(src) {
  const token = normalizeAssetSrc(src);
  if (!token) throw new Error('That asset cannot be deleted.');
  if (token === 'black-token.svg' || token === 'placeholder.svg') {
    throw new Error('That built-in image cannot be deleted.');
  }

  const filePath = resolveAssetFilePath(token);
  if (!filePath) throw new Error('That asset path is invalid.');

  const projectsDir = path.join(process.cwd(), 'src/content/projects');
  let stripped = 0;
  try {
    for (const file of readdirSync(projectsDir).filter((name) => name.endsWith('.json'))) {
      const relativeFile = `src/content/projects/${file}`;
      const absolute = path.join(process.cwd(), relativeFile);
      const data = JSON.parse(await readFile(absolute, 'utf8'));
      const count = stripAssetRefsFromDocument(data, token);
      if (count > 0) {
        await writeProjectJson(relativeFile, data);
        stripped += count;
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('Could not update project references.');
  }

  suppressContentHmr();
  await rm(filePath, { force: true });

  return { ok: true, src: token, stripped };
}

/**
 * Natural dimensions for any canonical src token (draft or public).
 * @param {string} src
 */
export async function readImageDimsFromSrc(src) {
  try {
    const filePath = resolveAssetFilePath(src);
    if (!filePath) return null;
    const { default: sharp } = await import('sharp');
    const { width, height, orientation } = await sharp(filePath).metadata();
    if (!width || !height) return null;
    const rotated = typeof orientation === 'number' && orientation >= 5 && orientation <= 8;
    return rotated ? { srcWidth: height, srcHeight: width } : { srcWidth: width, srcHeight: height };
  } catch {
    return null;
  }
}

export function assetsDevWriter() {
  return {
    name: 'assets-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/assets', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET') {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const project = String(url.searchParams.get('project') || '');
            const payload = await listDevAssets(project);
            send(200, payload);
          } catch {
            send(400, { error: 'Could not list assets.' });
          }
          return;
        }

        if (req.method === 'DELETE') {
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const result = await deleteDevAsset(String(body.src || ''));
            send(200, result);
          } catch (error) {
            send(400, {
              error: error instanceof Error ? error.message : 'Could not delete that asset.',
            });
          }
          return;
        }

        next();
      });
    },
  };
}

export { UNASSIGNED_SLUG };
