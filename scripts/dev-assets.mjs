// @ts-check
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { suppressContentHmr } from './content-hmr-gate.mjs';
import { isVideoSrc } from '../src/lib/imageUpload.mjs';
import { normalizeAssetSrc, stripAssetRefsFromDocument } from '../src/lib/contentAuthoringMedia.mjs';
export { normalizeAssetSrc, removeMediaItemFromDocument, stripAssetRefsFromDocument } from '../src/lib/contentAuthoringMedia.mjs';

const UNASSIGNED_SLUG = '__unassigned__';
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif']);
const execFile = promisify(execFileCallback);
const FFMPEG_PROBE = existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';

/** @param {string} relativeFile @param {unknown} data */
async function writeProjectJson(relativeFile, data) {
  suppressContentHmr();
  await writeFile(
    path.join(process.cwd(), relativeFile),
    `${JSON.stringify(data, null, 2)}\n`,
    'utf8',
  );
}

/** @param {string} src */
export function assetUrlFromSrc(src) {
  const token = normalizeAssetSrc(src);
  if (!token) return '';
  return `/images/${token.split('/').map(encodeURIComponent).join('/')}`;
}

/** @param {string} src */
export function resolveAssetFilePath(src) {
  const token = normalizeAssetSrc(src);
  if (!token || token.includes('..')) return null;
  return path.join(process.cwd(), 'media', token);
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
  if (typeof obj.hoverImage === 'string') {
    const token = normalizeAssetSrc(obj.hoverImage);
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
 *     filename: string,
 *     usedBy: string[],
 *   }>,
 * }>}
 */
export async function listDevAssets(filterProject = '') {
  const projectsDir = path.join(process.cwd(), 'src/content/projects');
  const mediaDir = path.join(process.cwd(), 'media');

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
   *   filename: string,
   *   usedBy: Set<string>,
   * }>} */
  const assets = new Map();

  const addAsset = (src) => {
    const token = normalizeAssetSrc(src);
    if (!token) return;
    if (assets.has(token)) return;
    assets.set(token, {
      id: token,
      src: token,
      url: assetUrlFromSrc(token),
      filename: path.basename(token),
      usedBy: new Set(),
    });
  };

  // Flat, site-wide media library — one file per token (top level only; the
  // asset manager UI does not surface subdirectory files — see #204).
  try {
    for (const filename of readdirSync(mediaDir)) {
      if (!isImageFilename(filename)) continue;
      const filePath = path.join(mediaDir, filename);
      try {
        if (!statSync(filePath).isFile()) continue;
      } catch {
        continue;
      }
      if (filename === 'placeholder.svg' || filename === 'black-token.svg') continue;
      addAsset(filename);
    }
  } catch {
    // media/ missing
  }

  // Referenced files — including missing ones, so editors can see the gap.
  for (const refs of refsByProject.values()) {
    for (const src of refs) addAsset(src);
  }

  // usedBy — every project that references each token.
  for (const [slug, refs] of refsByProject) {
    for (const src of refs) {
      const token = normalizeAssetSrc(src);
      const asset = assets.get(token);
      if (asset) asset.usedBy.add(slug);
    }
  }

  let list = [...assets.values()].map((asset) => ({
    id: asset.id,
    src: asset.src,
    url: asset.url,
    filename: asset.filename,
    usedBy: [...asset.usedBy].sort(),
  }));

  const projectFilter = String(filterProject || '').trim();
  if (projectFilter && projectFilter !== UNASSIGNED_SLUG) {
    list = list.filter((asset) => asset.usedBy.includes(projectFilter));
  } else if (projectFilter === UNASSIGNED_SLUG) {
    list = list.filter((asset) => asset.usedBy.length === 0);
  }

  list.sort((a, b) => a.filename.localeCompare(b.filename));

  const projectRows = [
    ...projects,
    { slug: UNASSIGNED_SLUG, title: 'Unassigned' },
  ];

  return { projects: projectRows, assets: list };
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
    const { width, height, orientation } = await sharp(filePath).metadata();
    if (!width || !height) return null;
    const rotated = typeof orientation === 'number' && orientation >= 5 && orientation <= 8;
    return rotated ? { srcWidth: height, srcHeight: width } : { srcWidth: width, srcHeight: height };
  } catch {
    return null;
  }
}

/**
 * Natural dimensions for a canonical image or video src. Video metadata is
 * read only here, during an authoring save; the image consumers keep their
 * existing Sharp-only behavior.
 * @param {string} src
 */
export async function readMediaDimsFromSrc(src) {
  const value = String(src || '').trim();
  if (value === 'placeholder.svg') {
    try {
      const { width, height } = await sharp(path.join(process.cwd(), 'media', value)).metadata();
      return width && height ? { srcWidth: width, srcHeight: height } : null;
    } catch {
      return null;
    }
  }
  if (!isVideoSrc(value)) return readImageDimsFromSrc(value);
  const filePath = resolveAssetFilePath(value);
  if (!filePath) return null;
  try {
    const { stdout } = await execFile(FFMPEG_PROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation',
      '-of', 'json',
      filePath,
    ], { timeout: 5000, maxBuffer: 32 * 1024 });
    const stream = JSON.parse(stdout).streams?.[0];
    let width = Number(stream?.width);
    let height = Number(stream?.height);
    const rotation = Number(stream?.tags?.rotate ?? stream?.side_data_list?.[0]?.rotation);
    if (Number.isFinite(rotation) && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null;
    return { srcWidth: width, srcHeight: height };
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
