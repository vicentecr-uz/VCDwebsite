// @ts-check
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { suppressContentHmr } from './content-hmr-gate.mjs';
import { normalizeAssetSrc, assetUrlFromSrc, readImageDimsFromSrc } from './dev-assets.mjs';
import { PLACEHOLDER_COVER, EMPTY_COVER_FILL, isPlaceholderCoverSrc } from '../src/lib/placeholderCover.mjs';
import { normalizeOutline } from '../src/lib/projectOutline.ts';
import { isHeicUpload, uploadFilename } from '../src/lib/imageUpload.mjs';
import {
  derivativeKind,
  findOriginal,
  generateDerivativeBuffer,
  isDerivativeToken,
} from './image-derivatives.mjs';

export { suppressContentHmr, contentHmrGate } from './content-hmr-gate.mjs';

const devAuthoringClients = new Set();

export const devAuthoringActive = () => devAuthoringClients.size > 0;

export function devAuthoringState() {
  return {
    name: 'vcd-dev-authoring-state',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/dev-session-state', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        if (req.method === 'GET') {
          send(200, { editing: devAuthoringClients.size > 0, clients: devAuthoringClients.size });
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const id = String(body.id || '').trim();
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || typeof body.active !== 'boolean') {
            send(400, { error: 'Invalid authoring state.' });
            return;
          }
          if (body.active) devAuthoringClients.add(id);
          else devAuthoringClients.delete(id);
          send(200, { editing: devAuthoringClients.size > 0, clients: devAuthoringClients.size });
        } catch {
          send(400, { error: 'Invalid JSON.' });
        }
      });
    },
  };
}

export async function writeAtomicJson(file, data) {
  suppressContentHmr();
  const temporaryFile = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => {});
  }
}

async function writeProjectJson(file, data) {
  await writeAtomicJson(file, data);
}

const MUTATING_AUTHORING_PATHS = new Set([
  '/api/image-crop', '/api/image-grid', '/api/style-token', '/api/content-text',
  '/api/content-batch', '/api/content-section', '/api/content-spacing', '/api/content-nav',
  '/api/project-create', '/api/project-settings', '/api/content-section-order',
  '/api/gallery-membership', '/api/listing-order', '/api/project-delete', '/api/project-rename',
]);

export function isMutatingAuthoringRequest(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) return false;
  return MUTATING_AUTHORING_PATHS.has(String(req.url || '').split('?', 1)[0]);
}

export function createSerializedRequestQueue() {
  let tail = Promise.resolve();
  return async function enqueue(req, res, next) {
    const previous = tail;
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    tail = tail.then(() => current);
    await previous;
    if (req.aborted || req.destroyed) {
      release();
      return;
    }
    let released = false;
    const complete = () => {
      if (released) return;
      released = true;
      release();
    };
    const end = res.end;
    res.end = function (...args) {
      complete();
      return end.apply(this, args);
    };
    try {
      next();
    } catch (error) {
      complete();
      throw error;
    }
  };
}

export function devAuthoringRequestQueue() {
  return {
    name: 'vcd-dev-authoring-request-queue',
    apply: 'serve',
    configureServer(server) {
      const enqueue = createSerializedRequestQueue();
      server.middlewares.use(async (req, res, next) => {
        if (!isMutatingAuthoringRequest(req)) {
          next();
          return;
        }
        try {
          await enqueue(req, res, next);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

const VALID_STATUSES = new Set(['published', 'draft', 'teaser', 'image']);
const LISTING_GRIDS = ['home', 'work', 'play'];

function validateStatus(status, fallback = 'draft') {
  const value = String(status || fallback);
  return VALID_STATUSES.has(value) ? value : fallback;
}

/** Bust Astro's getStaticPaths RouteCache so a newly written slug is routable in `astro dev`. Static output ignores `prerender = false`; this is the real DEV hook. */
function invalidateAstroRouteCache(server) {
  for (const name of ['ssr', 'astro']) {
    const env = server.environments?.[name];
    if (env?.hot?.send) env.hot.send('astro:content-changed', {});
  }
}

export function listingCardForGrid(grid, listing, previous = {}) {
  // Normalize here rather than trust the client: the settings panel sends a
  // ready-to-use URL (for live preview), but storage wants the bare token.
  const hoverImage = normalizeAssetSrc(String(listing.hoverImage ?? previous.hoverImage ?? ''));
  const base = {
    order: previous.order ?? 999,
    image: normalizeAssetSrc(String(listing.image || '')),
    bg: String(listing.bg || '#efefef'),
    dark: Boolean(listing.dark),
    full: Boolean(listing.full),
  };
  if (hoverImage) {
    base.hoverImage = hoverImage;
    // #182 — listingCardForGrid rebuilds from a fixed key set rather than
    // merging, so a settings-only save (which doesn't send hoverDark) needs
    // this fallback or it silently drops on the second save. Same pattern as
    // hoverImage/variants above.
    const hoverDark = typeof listing.hoverDark === 'boolean' ? listing.hoverDark : previous.hoverDark;
    if (typeof hoverDark === 'boolean') base.hoverDark = hoverDark;
  }
  const href = String(listing.href ?? previous.href ?? '').trim();
  if (href) base.href = href;
  // Crop data lives on the listing card; settings saves omit it — keep prior.
  const variants = listing.variants ?? previous.variants;
  if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
    base.variants = structuredClone(variants);
  }
  const hoverVariants = listing.hoverVariants ?? previous.hoverVariants;
  if (hoverVariants && typeof hoverVariants === 'object' && !Array.isArray(hoverVariants)) {
    base.hoverVariants = structuredClone(hoverVariants);
  }
  const srcWidth = Number(listing.srcWidth ?? previous.srcWidth);
  const srcHeight = Number(listing.srcHeight ?? previous.srcHeight);
  if (Number.isFinite(srcWidth) && srcWidth > 0) base.srcWidth = Math.round(srcWidth);
  if (Number.isFinite(srcHeight) && srcHeight > 0) base.srcHeight = Math.round(srcHeight);
  if (grid === 'play') {
    return {
      ...base,
      meta: String(listing.meta || listing.year || previous.meta || ''),
    };
  }
  return {
    ...base,
    year: String(listing.year || listing.meta || previous.year || ''),
  };
}

async function assertModernProject(slug) {
  const relativeFile = resolveEditableDocument(slug);
  if (!relativeFile) {
    throw new Error('Project not found.');
  }
  const file = path.join(process.cwd(), relativeFile);
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.stack !== 'modern') {
    throw new Error('Only modern projects can be renamed or deleted here.');
  }
  return { relativeFile, file, data };
}

export async function readDevDocument(relativeFile) {
  return JSON.parse(await readFile(path.join(process.cwd(), relativeFile), 'utf8'));
}

export async function writeDevDocument(relativeFile, data) {
  await writeProjectJson(path.join(process.cwd(), relativeFile), data);
}

export function resolveDevFieldTarget(slug, _viewId, fieldPath) {
  const relativeFile = resolveEditableDocument(slug);
  if (!relativeFile) throw new Error('Project not found.');
  if (!Array.isArray(fieldPath)) {
    throw new Error('Invalid field path.');
  }
  if (fieldPath.length === 0) {
    throw new Error('Invalid field path.');
  }
  return { relativeFile, path: fieldPath, ensureOverlay: false };
}

const DEFAULT_IMAGE_VARIANTS = {
  desktop: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 },
  tablet: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 },
  mobile: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 },
};

export const PLACEHOLDER_IMAGE_VARIANTS = {
  desktop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
  tablet: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
  mobile: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 1 },
};

const STATIC_EDITABLE_DOCUMENTS = new Map([
  ['the-rams', 'src/content/projects/the-rams.json'],
  ['parentpal', 'src/content/projects/parentpal.json'],
  ['conic-collection', 'src/content/projects/conic-collection.json'],
  ['styles', 'src/content/pages/styles.json'],
]);

export function resolveEditableDocument(documentKey) {
  const map = new Map(STATIC_EDITABLE_DOCUMENTS);
  const projectsDir = path.join(process.cwd(), 'src/content/projects');
  try {
    for (const file of readdirSync(projectsDir)) {
      if (!file.endsWith('.json')) continue;
      const key = file.replace(/\.json$/, '');
      map.set(key, `src/content/projects/${file}`);
    }
  } catch {
    // projects dir may not exist yet during first scaffold
  }
  const pagesDir = path.join(process.cwd(), 'src/content/pages');
  try {
    for (const file of readdirSync(pagesDir)) {
      if (!file.endsWith('.json')) continue;
      const key = file.replace(/\.json$/, '');
      map.set(key, `src/content/pages/${file}`);
    }
  } catch {
    // pages dir may not exist yet during first scaffold
  }
  return map.get(documentKey);
}

function isValidOutlineEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (
    typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 80
    || typeof entry.label !== 'string' || entry.label.length === 0 || entry.label.length > 120
    || (entry.anchor !== undefined && (typeof entry.anchor !== 'string' || entry.anchor.length === 0 || entry.anchor.length > 80))
  ) return false;
  if (entry.kind === 'group') return entry.defaultOpen === undefined || typeof entry.defaultOpen === 'boolean';
  if (entry.kind === 'section') {
    return entry.defaultOpen === undefined || typeof entry.defaultOpen === 'boolean';
  }
  return entry.kind === 'subsection' && entry.defaultOpen === undefined;
}

export function validateProjectOutline(outline) {
  if (!Array.isArray(outline) || outline.length > 120 || !outline.every(isValidOutlineEntry)) return false;
  const identities = new Set();
  for (const entry of outline) {
    const normalizedKind = entry.kind === 'group'
      || (entry.kind === 'section' && Object.prototype.hasOwnProperty.call(entry, 'defaultOpen'))
      ? 'group'
      : 'section';
    const identity = `${normalizedKind}:${entry.id}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

export function validateProjectOutlineTargets(outline, sections) {
  if (!Array.isArray(outline) || !Array.isArray(sections)) return false;
  const targets = new Set(
    sections
      .filter((section) => section && typeof section === 'object' && !Array.isArray(section))
      .map((section) => String(section.sectionId || section.id || '').trim())
      .filter(Boolean),
  );
  return outline.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    return targets.has(String(entry.anchor || entry.id || '').trim());
  });
}

export function sanitizeUploadFilename(filename) {
  const base = path.basename(String(filename || 'image.jpg'))
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim() || 'image.jpg';
  return base;
}

export async function uniqueUploadFilename(directory, filename) {
  const safe = sanitizeUploadFilename(filename);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  let candidate = safe;
  let index = 2;
  while (true) {
    try {
      await readFile(path.join(directory, candidate));
      candidate = `${stem}-${index}${ext}`;
      index += 1;
    } catch {
      return candidate;
    }
  }
}

const execFile = promisify(execFileCallback);

export class HeicConversionError extends Error {
  constructor() {
    super('Could not convert HEIC image to JPEG.');
    this.name = 'HeicConversionError';
    this.code = 'HEIC_CONVERSION_FAILED';
  }
}

export async function convertHeicUpload(data, options = {}) {
  const run = options.run || ((...args) => execFile(...args));
  const temporaryDirectory = await mkdtemp(path.join(options.tmpdir || process.env.TMPDIR || '/tmp', 'vcd-heic-'));
  const input = path.join(temporaryDirectory, 'input.heic');
  const output = path.join(temporaryDirectory, 'output.jpg');
  try {
    await writeFile(input, data);
    // Deliberate limit: local editor conversion currently relies on macOS sips; a cross-platform/online editor needs a portable HEIC decoder.
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', input, '--out', output]);
    return await readFile(output);
  } catch {
    throw new HeicConversionError();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function buildImageSection(documentKey, filenames) {
  const id = `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    type: 'image',
    id,
    src: filenames[0],
    alt: '',
    spacing: 'section',
    ...(await readImageDimsFromSrc(filenames[0]) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  };
}

/** Build an image section from an existing canonical src token. */
export async function buildImageSectionFromSrcs(srcs) {
  const src = normalizeAssetSrc(srcs[0]);
  if (!src) throw new Error('An image file is required.');
  const id = `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    type: 'image',
    id,
    src,
    alt: '',
    spacing: 'section',
    ...(await readImageDimsFromSrc(src) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  };
}

export const buildPlaceholderItem = (id) => ({
  id,
  src: 'placeholder.svg',
  alt: 'Placeholder',
  variants: structuredClone(PLACEHOLDER_IMAGE_VARIANTS),
});

export function buildPlaceholderImageSection() {
  const id = `placeholder-${Date.now().toString(36)}`;
  return { type: 'image', id, spacing: 'section', ...buildPlaceholderItem(id) };
}

export function buildPlaceholderImageGridSection() {
  const id = `placeholder-grid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const items = [
    buildPlaceholderItem(`grid-item-1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    buildPlaceholderItem(`grid-item-2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
  ];
  const visible = items.map((item) => item.id);
  return {
    type: 'imageGrid', id, columns: 2, defaultAspectRatio: '4:3', spacing: 'section', items,
    layouts: { desktop: { visible: [...visible] }, mobile: { visible: [...visible] } },
  };
}

export function buildPlaceholderImageCarouselSection() {
  const id = `placeholder-carousel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const items = [
    buildPlaceholderItem(`carousel-item-1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    buildPlaceholderItem(`carousel-item-2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
  ];
  return {
    type: 'imageCarousel', id, orientation: 'horizontal', heightMode: 'dynamic', dotsPlacement: 'outside',
    defaultAspectRatio: 'original', spacing: 'section', items, visible: items.map((item) => item.id),
  };
}

export function isPlaceholderImageSrc(src) {
  const value = String(src || '');
  return value === 'placeholder.svg' || value.endsWith('/placeholder.svg');
}

/** Replace a placeholder image section's src/dims with an uploaded draft file.
 *  Crop variants stay as authored on the placeholder (frame size / position).
 *  Pass `variants` to stamp the frame the editor was previewing (e.g. from DOM). */
export async function fillPlaceholderImageSection(section, documentKey, filename, variants, existingSrc) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error('That section cannot be filled.');
  }
  if (String(section.type || '') !== 'image' && String(section.type || '') !== 'placeholder') {
    throw new Error('Only image placeholders can be filled.');
  }
  if (!isPlaceholderImageSrc(section.src)) {
    throw new Error('That image is not a placeholder.');
  }

  let src = '';
  /** @type {{ srcWidth: number, srcHeight: number } | null} */
  let dims = null;
  if (existingSrc) {
    src = normalizeAssetSrc(existingSrc);
    if (!src) throw new Error('An image file is required.');
  } else {
    src = normalizeAssetSrc(filename);
    if (!src) throw new Error('An image file is required.');
  }
  dims = await readImageDimsFromSrc(src);

  section.type = 'image';
  section.src = src;
  if (dims) {
    section.srcWidth = dims.srcWidth;
    section.srcHeight = dims.srcHeight;
  } else {
    delete section.srcWidth;
    delete section.srcHeight;
  }
  if (variants && typeof variants === 'object' && !Array.isArray(variants) && Object.keys(variants).length) {
    section.variants = structuredClone(variants);
  } else if (
    !section.variants
    || typeof section.variants !== 'object'
    || Array.isArray(section.variants)
    || !Object.keys(section.variants).length
  ) {
    section.variants = structuredClone(PLACEHOLDER_IMAGE_VARIANTS);
  }
  if (String(section.alt || '') === 'Placeholder') section.alt = '';
  return section;
}

export async function buildImageGridSection(documentKey, filenames) {
  const id = `grid-${Date.now().toString(36)}`;
  const items = await Promise.all(filenames.map(async (filename, index) => ({
    id: `item-${index + 1}-${Date.now().toString(36)}`,
    src: filename,
    alt: '',
    ...(await readImageDimsFromSrc(filename) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  })));
  const visible = items.map((item) => item.id);
  return {
    type: 'imageGrid',
    id,
    columns: Math.min(2, Math.max(1, filenames.length)),
    defaultAspectRatio: '4:3',
    spacing: 'section',
    items,
    layouts: {
      desktop: { visible: [...visible] },
      mobile: { visible: [...visible] },
    },
  };
}

/** Build an image grid from existing canonical src tokens. */
export async function buildImageGridSectionFromSrcs(srcs) {
  const tokens = srcs.map((value) => normalizeAssetSrc(value)).filter(Boolean);
  if (!tokens.length) throw new Error('At least one image file is required.');
  const id = `grid-${Date.now().toString(36)}`;
  const items = await Promise.all(tokens.map(async (src, index) => ({
    id: `item-${index + 1}-${Date.now().toString(36)}`,
    src,
    alt: '',
    ...(await readImageDimsFromSrc(src) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  })));
  const visible = items.map((item) => item.id);
  return {
    type: 'imageGrid',
    id,
    columns: Math.min(2, Math.max(1, tokens.length)),
    defaultAspectRatio: '4:3',
    spacing: 'section',
    items,
    layouts: {
      desktop: { visible: [...visible] },
      mobile: { visible: [...visible] },
    },
  };
}

export async function buildImageCarouselSection(documentKey, filenames) {
  const id = `carousel-${Date.now().toString(36)}`;
  const items = await Promise.all(filenames.map(async (filename, index) => ({
    id: `item-${index + 1}-${Date.now().toString(36)}`,
    src: filename,
    alt: '',
    ...(await readImageDimsFromSrc(filename) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  })));
  return {
    type: 'imageCarousel',
    id,
    orientation: 'horizontal',
    heightMode: 'dynamic',
    dotsPlacement: 'outside',
    defaultAspectRatio: 'original',
    spacing: 'section',
    items,
    visible: items.map((item) => item.id),
  };
}

/** Build an image carousel from existing canonical src tokens. */
export async function buildImageCarouselSectionFromSrcs(srcs) {
  const tokens = srcs.map((value) => normalizeAssetSrc(value)).filter(Boolean);
  if (!tokens.length) throw new Error('At least one image file is required.');
  const id = `carousel-${Date.now().toString(36)}`;
  const items = await Promise.all(tokens.map(async (src, index) => ({
    id: `item-${index + 1}-${Date.now().toString(36)}`,
    src,
    alt: '',
    ...(await readImageDimsFromSrc(src) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  })));
  return {
    type: 'imageCarousel',
    id,
    orientation: 'horizontal',
    heightMode: 'dynamic',
    dotsPlacement: 'outside',
    defaultAspectRatio: 'original',
    spacing: 'section',
    items,
    visible: items.map((item) => item.id),
  };
}

function slugifyTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function emptyModernProject(slug, title, grid, status = 'draft') {
  const year = `'${new Date().getFullYear().toString().slice(-2)}`;
  const listing = grid === 'play'
    ? {
        order: 999,
        meta: '',
        image: '',
        bg: EMPTY_COVER_FILL,
        dark: true,
        full: false,
      }
    : {
        order: 999,
        year,
        image: '',
        bg: EMPTY_COVER_FILL,
        dark: true,
        full: false,
      };
  return {
    slug,
    title,
    description: '',
    status: validateStatus(status, 'draft'),
    stack: 'modern',
    listings: {
      [grid]: listing,
    },
    outline: [],
    sections: [
      {
        type: 'bodyText',
        id: 'body-1',
        spacing: 'none',
        paragraphs: [''],
      },
    ],
  };
}

export function mediaDevServer() {
  return {
    name: 'media-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/images', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        if (!relative || relative.includes('..')) {
          res.statusCode = 400;
          res.end('Bad request');
          return;
        }
        const mediaDir = path.join(process.cwd(), 'media');
        const filePath = path.join(mediaDir, relative);
        try {
          if (isDerivativeToken(relative)) {
            let derivativeOnDisk = false;
            try {
              await stat(filePath);
              derivativeOnDisk = true;
            } catch {
              // generate on the fly below
            }

            if (!derivativeOnDisk) {
              const originalPath = await findOriginal(mediaDir, relative);
              if (!originalPath) {
                next();
                return;
              }
              const kind = derivativeKind(relative);
              if (!kind) {
                next();
                return;
              }
              const file = await generateDerivativeBuffer(originalPath, kind);
              res.statusCode = 200;
              res.setHeader('content-type', 'image/webp');
              res.setHeader('cache-control', 'public, max-age=31536000, immutable');
              res.end(file);
              return;
            }
          }

          const ext = path.extname(filePath).toLowerCase();
          const widthParam = url.searchParams.get('w');
          const skipResize = !widthParam || ext === '.svg' || ext === '.gif';

          if (!skipResize) {
            const width = Math.min(640, Math.max(32, Number.parseInt(widthParam, 10)));
            if (!Number.isFinite(width)) {
              res.statusCode = 400;
              res.end('Bad request');
              return;
            }
            const { default: sharp } = await import('sharp');
            let pipeline = sharp(filePath).rotate().resize({ width, withoutEnlargement: true });
            if (ext === '.png' || ext === '.webp' || ext === '.avif') {
              pipeline = pipeline.webp({ quality: 80 });
            } else {
              pipeline = pipeline.jpeg({ quality: 80 });
            }
            const file = await pipeline.toBuffer();
            const type = ext === '.png' || ext === '.webp' || ext === '.avif' ? 'image/webp' : 'image/jpeg';
            res.statusCode = 200;
            res.setHeader('content-type', type);
            res.setHeader('cache-control', 'public, max-age=31536000, immutable');
            res.end(file);
            return;
          }

          const file = await readFile(filePath);
          const type = ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : ext === '.svg'
                  ? 'image/svg+xml'
                  : ext === '.avif'
                    ? 'image/avif'
                    : 'image/jpeg';
          res.statusCode = 200;
          res.setHeader('content-type', type);
          res.end(file);
        } catch {
          next();
        }
      });
    },
  };
}

export function uploadDevWriter() {
  return {
    name: 'upload-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/upload', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 50_000_000) {
              send(413, { error: 'Upload is too large.' });
              return;
            }
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const documentKey = String(body.document || '');
          if (!resolveEditableDocument(documentKey)) {
            send(400, { error: 'That document cannot receive uploads.' });
            return;
          }
          const files = Array.isArray(body.files) ? body.files : [];
          if (!files.length) {
            send(400, { error: 'No files were uploaded.' });
            return;
          }
          const directory = path.join(process.cwd(), 'media');
          // media/ is watch-ignored + skipped in contentHmrGate; keep the
          // suppress call as belt-and-suspenders for any residual CSS/module path.
          suppressContentHmr();
          await mkdir(directory, { recursive: true });
          const filenames = [];
          for (const file of files) {
            const mimeType = String(file.mimeType || '');
            const filename = String(file.filename || '');
            const mime = mimeType.toLowerCase().split(';', 1)[0].trim();
            if (!mime.startsWith('image/') && !(isHeicUpload(filename, mimeType) && !mime)) {
              send(400, { error: 'Only image uploads are supported.' });
              return;
            }
            const data = Buffer.from(String(file.data || ''), 'base64');
            const converted = isHeicUpload(filename, mimeType)
              ? await convertHeicUpload(data)
              : data;
            const outputFilename = await uniqueUploadFilename(directory, uploadFilename(filename, mimeType));
            await writeFile(path.join(directory, outputFilename), converted);
            filenames.push(outputFilename);
          }
          send(200, { ok: true, filenames });
        } catch (error) {
          send(400, {
            error: error?.code === 'HEIC_CONVERSION_FAILED'
              ? 'Could not convert HEIC image to JPEG.'
              : 'Could not save uploaded files.',
          });
        }
      });
    },
  };
}

export function projectCreateDevWriter() {
  return {
    name: 'project-create-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/project-create', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const title = String(body.title || '').trim();
          const grid = ['home', 'work', 'play'].includes(body.grid) ? body.grid : 'work';
          const status = validateStatus(body.status, 'draft');
          let slug = String(body.slug || '').trim();
          if (status === 'image' && !slug) slug = slugifyTitle(title);
          if (!title || !/^[a-z0-9-]+$/.test(slug)) {
            send(400, { error: 'Enter a valid title and slug.' });
            return;
          }
          const file = path.join(process.cwd(), `src/content/projects/${slug}.json`);
          try {
            await readFile(file);
            send(400, { error: 'A project with that slug already exists.' });
            return;
          } catch {
            // available
          }
          const pageFile = path.join(process.cwd(), `src/pages/${slug}.astro`);
          try {
            await readFile(pageFile);
            send(400, { error: 'A page with that slug already exists.' });
            return;
          } catch {
            // available
          }
          const project = emptyModernProject(slug, title, grid, status);
          await writeProjectJson(file, project);
          invalidateAstroRouteCache(server);
          send(200, { ok: true, slug, status, grid });
        } catch {
          send(400, { error: 'Could not create the project.' });
        }
      });
    },
  };
}

export function projectSettingsDevWriter() {
  return {
    name: 'project-settings-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/project-settings', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET') {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const slug = String(url.searchParams.get('slug') || '');
            const relativeFile = resolveEditableDocument(slug);
            if (!relativeFile) {
              send(404, { error: 'Project not found.' });
              return;
            }
            const data = JSON.parse(await readFile(path.join(process.cwd(), relativeFile), 'utf8'));
            const grid = ['home', 'work', 'play'].find((key) => data.listings?.[key]) ?? 'work';
            const listing = data.listings?.[grid] ?? {};
            // Storage holds bare tokens; the client wants ready-to-use URLs for
            // live preview (it assigns these straight to <img src>).
            const resolvedListings = {};
            for (const [key, value] of Object.entries(data.listings ?? {})) {
              resolvedListings[key] = {
                ...value,
                image: value.image ? assetUrlFromSrc(value.image) : '',
                ...(value.hoverImage ? { hoverImage: assetUrlFromSrc(value.hoverImage) } : {}),
              };
            }
            send(200, {
              slug,
              title: data.title,
              description: data.description ?? '',
              status: data.status ?? 'draft',
              listings: resolvedListings,
              listing: {
                image: listing.image ? assetUrlFromSrc(listing.image) : '',
                hoverImage: listing.hoverImage ? assetUrlFromSrc(listing.hoverImage) : '',
                hoverDark: typeof listing.hoverDark === 'boolean' ? listing.hoverDark : undefined,
                bg: listing.bg ?? '#efefef',
                dark: Boolean(listing.dark),
                full: Boolean(listing.full),
                subtitle: listing.year ?? listing.meta ?? '',
              },
              teaser: {
                ...(data.teaser ?? {}),
                coverImage: data.teaser?.coverImage ? assetUrlFromSrc(data.teaser.coverImage) : '',
              },
            });
          } catch {
            send(400, { error: 'Could not load project settings.' });
          }
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const slug = String(body.slug || '').trim();
          const relativeFile = resolveEditableDocument(slug);
          if (!relativeFile) {
            send(404, { error: 'Project not found.' });
            return;
          }
          const file = path.join(process.cwd(), relativeFile);
          const data = JSON.parse(await readFile(file, 'utf8'));
          data.title = String(body.title || data.title || '').trim();
          data.description = String(body.description || '').trim();
          data.status = validateStatus(body.status, validateStatus(data.status));
          data.slug = slug;
          const previousListings = data.listings ?? {};
          // Merge — one-grid saves must not wipe Home/Work/Play siblings.
          data.listings = { ...previousListings };
          for (const grid of LISTING_GRIDS) {
            const listing = body.listings?.[grid];
            if (!listing) continue;
            data.listings[grid] = listingCardForGrid(grid, listing, previousListings[grid] ?? {});
          }
          data.teaser = {
            label: String(body.teaser?.label || ''),
            coverImage: normalizeAssetSrc(String(body.teaser?.coverImage || '')),
          };
          await writeProjectJson(file, data);
          invalidateAstroRouteCache(server);
          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not save project settings.' });
        }
      });
    },
  };
}

export function sectionOrderDevWriter() {
  return {
    name: 'section-order-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-section-order', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const documentKey = String(body.document || '').trim();
          const relativeFile = resolveEditableDocument(documentKey);
          if (!relativeFile) {
            send(400, { error: 'That document cannot be updated.' });
            return;
          }
          const order = Array.isArray(body.order) ? body.order : [];
          const data = await readDevDocument(relativeFile);
          const sections = Array.isArray(data.sections) ? data.sections : [];
          if (order.length !== sections.length) {
            send(400, { error: 'Section order does not match the document.' });
            return;
          }
          const used = new Set();
          const reordered = [];
          for (const raw of order) {
            const index = Number(raw);
            if (
              !Number.isInteger(index)
              || index < 0
              || index >= sections.length
              || used.has(index)
            ) {
              send(400, { error: 'Invalid section order.' });
              return;
            }
            used.add(index);
            reordered.push(sections[index]);
          }
          data.sections = reordered;
          // Persist the outline from the same draft as the reordered page blocks.
          if (Object.prototype.hasOwnProperty.call(body, 'outline')) {
            if (!validateProjectOutline(body.outline)) {
              send(400, { error: 'The section outline is invalid.' });
              return;
            }
            if (relativeFile.startsWith('src/content/projects/')
              && !validateProjectOutlineTargets(body.outline, sections)) {
              send(400, { error: 'The section outline contains an orphan target.' });
              return;
            }
            data.outline = normalizeOutline(body.outline);
            delete data.nav;
          }
          await writeDevDocument(relativeFile, data);
          send(200, { ok: true, ...(Object.prototype.hasOwnProperty.call(body, 'outline') ? { outline: data.outline } : {}) });
        } catch {
          send(400, { error: 'Could not save section order.' });
        }
      });
    },
  };
}

function seedListingCard(grid, data, order) {
  const previous = data.listings && typeof data.listings === 'object' ? data.listings : {};
  const sibling = LISTING_GRIDS.map((key) => previous[key]).find(Boolean) ?? {};
  const year = `'${new Date().getFullYear().toString().slice(-2)}`;
  const image = String(
    sibling.image
    || data.teaser?.coverImage
    || 'black-token.svg',
  );
  const base = {
    order,
    image,
    bg: String(sibling.bg || '#efefef'),
    dark: Boolean(sibling.dark),
    full: false,
  };
  const hoverImage = String(sibling.hoverImage || '').trim();
  if (hoverImage) base.hoverImage = hoverImage;
  if (grid === 'play') {
    return {
      ...base,
      meta: String(sibling.meta || sibling.year || ''),
    };
  }
  return {
    ...base,
    year: String(sibling.year || sibling.meta || year),
  };
}

function coverForGalleryPage(data, grid) {
  const listings = data.listings && typeof data.listings === 'object' ? data.listings : {};
  const onGallery = Boolean(listings[grid]);
  const listing = listings[grid]
    ?? LISTING_GRIDS.map((key) => listings[key]).find(Boolean)
    ?? {};
  const isTeaser = data.status === 'teaser';
  const rawImage = isTeaser
    ? (data.teaser?.coverImage || listing.image || '')
    : (listing.image || data.teaser?.coverImage || '');
  const hasCover = !isPlaceholderCoverSrc(rawImage);
  const image = hasCover ? String(rawImage) : PLACEHOLDER_COVER;
  const order = onGallery ? Number(listings[grid].order) : Number.POSITIVE_INFINITY;
  const variants = listing.variants
    && typeof listing.variants === 'object'
    && !Array.isArray(listing.variants)
    ? structuredClone(listing.variants)
    : structuredClone(PLACEHOLDER_IMAGE_VARIANTS);
  /** @type {Record<string, unknown>} */
  const cover = {
    onGallery,
    hasCover,
    image,
    coverUrl: hasCover ? assetUrlFromSrc(image) : '',
    bg: String(listing.bg || '#efefef'),
    dark: Boolean(listing.dark),
    full: Boolean(listing.full),
    subtitle: String(grid === 'play' ? (listing.meta || '') : (listing.year || '')),
    hoverImage: String(listing.hoverImage || ''),
    order: Number.isFinite(order) ? order : Number.POSITIVE_INFINITY,
    variants,
  };
  const hoverVariants = listing.hoverVariants
    && typeof listing.hoverVariants === 'object'
    && !Array.isArray(listing.hoverVariants)
    ? structuredClone(listing.hoverVariants)
    : undefined;
  if (hoverVariants) {
    cover.hoverVariants = hoverVariants;
  }
  if (typeof listing.hoverDark === 'boolean') {
    cover.hoverDark = listing.hoverDark;
  }
  const srcWidth = Number(listing.srcWidth);
  const srcHeight = Number(listing.srcHeight);
  if (Number.isFinite(srcWidth) && srcWidth > 0) cover.srcWidth = Math.round(srcWidth);
  if (Number.isFinite(srcHeight) && srcHeight > 0) cover.srcHeight = Math.round(srcHeight);
  return cover;
}

/** Toggle which projects appear on Home / Work / Play (`listings[grid]` presence). */
export function galleryMembershipDevWriter() {
  return {
    name: 'gallery-membership-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/gallery-membership', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET') {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const grid = String(url.searchParams.get('grid') || '');
            if (!LISTING_GRIDS.includes(grid)) {
              send(400, { error: 'That gallery cannot be edited.' });
              return;
            }
            const projectsDir = path.join(process.cwd(), 'src/content/projects');
            const files = readdirSync(projectsDir)
              .filter((file) => file.endsWith('.json') && !file.endsWith('-old.json'));
            /** @type {Array<Record<string, unknown>>} */
            const pages = [];
            for (const file of files) {
              const slug = file.replace(/\.json$/, '');
              try {
                const data = JSON.parse(await readFile(path.join(projectsDir, file), 'utf8'));
                const cover = coverForGalleryPage(data, grid);
                pages.push({
                  slug,
                  title: String(data.title || slug),
                  status: validateStatus(data.status, 'published'),
                  ...cover,
                });
              } catch {
                pages.push({
                  slug,
                  title: slug,
                  status: 'draft',
                  onGallery: false,
                  hasCover: false,
                  image: PLACEHOLDER_COVER,
                  coverUrl: '',
                  bg: '#efefef',
                  dark: false,
                  full: false,
                  subtitle: '',
                  hoverImage: '',
                  order: Number.POSITIVE_INFINITY,
                  variants: structuredClone(PLACEHOLDER_IMAGE_VARIANTS),
                });
              }
            }
            pages.sort((a, b) => {
              if (Boolean(a.onGallery) !== Boolean(b.onGallery)) {
                return a.onGallery ? -1 : 1;
              }
              if (a.onGallery && b.onGallery && a.order !== b.order) {
                return a.order - b.order;
              }
              return String(a.title).localeCompare(String(b.title));
            });
            send(200, { grid, pages });
          } catch {
            send(400, { error: 'Could not load gallery pages.' });
          }
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const grid = String(body.grid || '');
          if (!LISTING_GRIDS.includes(grid)) {
            send(400, { error: 'That gallery cannot be updated.' });
            return;
          }
          const wanted = Array.isArray(body.slugs)
            ? [...new Set(body.slugs.map((value) => String(value || '').trim()).filter(Boolean))]
            : [];
          const wantedSet = new Set(wanted);
          const projectsDir = path.join(process.cwd(), 'src/content/projects');
          const files = readdirSync(projectsDir)
            .filter((file) => file.endsWith('.json') && !file.endsWith('-old.json'));

          let maxOrder = 0;
          for (const file of files) {
            try {
              const data = JSON.parse(await readFile(path.join(projectsDir, file), 'utf8'));
              const order = Number(data.listings?.[grid]?.order);
              if (Number.isFinite(order) && order > maxOrder) maxOrder = order;
            } catch {
              // Skip unreadable project files when scanning max order.
            }
          }

          // Play-link orders share the Play sort key — keep project appends above them.
          if (grid === 'play') {
            try {
              const playDir = path.join(process.cwd(), 'src/content/play');
              for (const file of readdirSync(playDir).filter((name) => name.endsWith('.json'))) {
                const data = JSON.parse(await readFile(path.join(playDir, file), 'utf8'));
                const order = Number(data.order);
                if (Number.isFinite(order) && order > maxOrder) maxOrder = order;
              }
            } catch {
              // Play folder may be empty.
            }
          }

          let nextOrder = maxOrder;
          for (const file of files) {
            const slug = file.replace(/\.json$/, '');
            const filePath = path.join(projectsDir, file);
            const data = JSON.parse(await readFile(filePath, 'utf8'));
            if (!data.listings || typeof data.listings !== 'object' || Array.isArray(data.listings)) {
              data.listings = {};
            }
            const hasListing = Boolean(data.listings[grid]);
            const shouldHave = wantedSet.has(slug);
            if (hasListing && !shouldHave) {
              delete data.listings[grid];
              if (!Object.keys(data.listings).length) delete data.listings;
              await writeProjectJson(filePath, data);
              continue;
            }
            if (!hasListing && shouldHave) {
              nextOrder += 1;
              data.listings[grid] = seedListingCard(grid, data, nextOrder);
              await writeProjectJson(filePath, data);
            }
          }

          // Optional DOM order from the panel — covers remove→re-add landing at the end.
          const items = Array.isArray(body.items) ? body.items : [];
          for (const entry of items) {
            const order = Number(entry.order);
            if (!Number.isInteger(order) || order < 1) continue;
            if (entry.type === 'project') {
              const slug = String(entry.slug || '').trim();
              const relativeFile = resolveEditableDocument(slug);
              if (!relativeFile) continue;
              const file = path.join(process.cwd(), relativeFile);
              const data = JSON.parse(await readFile(file, 'utf8'));
              if (!data.listings?.[grid]) continue;
              data.listings[grid].order = order;
              if (typeof entry.full === 'boolean') {
                data.listings[grid].full = entry.full;
              }
              await writeProjectJson(file, data);
            }
          }

          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not save gallery membership.' });
        }
      });
    },
  };
}

export function listingOrderDevWriter() {
  return {
    name: 'listing-order-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/listing-order', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const grid = String(body.grid || '');
          if (!['home', 'work', 'play'].includes(grid)) {
            send(400, { error: 'That grid cannot be updated.' });
            return;
          }
          const items = Array.isArray(body.items) ? body.items : [];
          for (const entry of items) {
            const order = Number(entry.order);
            if (!Number.isInteger(order) || order < 1) continue;
            if (entry.type === 'project') {
              const slug = String(entry.slug || '').trim();
              const relativeFile = resolveEditableDocument(slug);
              if (!relativeFile) continue;
              const file = path.join(process.cwd(), relativeFile);
              const data = JSON.parse(await readFile(file, 'utf8'));
              if (!data.listings?.[grid]) continue;
              data.listings[grid].order = order;
              if (typeof entry.full === 'boolean') {
                data.listings[grid].full = entry.full;
              }
              await writeProjectJson(file, data);
            }
          }

          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not save listing order.' });
        }
      });
    },
  };
}

export function projectDeleteDevWriter() {
  return {
    name: 'project-delete-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/project-delete', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const slug = String(body.slug || '').trim();
          if (!/^[a-z0-9-]+$/.test(slug)) {
            send(400, { error: 'Enter a valid slug.' });
            return;
          }
          const { file } = await assertModernProject(slug);
          await rm(file, { force: true });
          // Draft media is site-wide; unreferenced files surface as Unassigned in the asset manager.
          invalidateAstroRouteCache(server);
          send(200, { ok: true });
        } catch (error) {
          send(400, { error: error instanceof Error ? error.message : 'Could not delete the project.' });
        }
      });
    },
  };
}

export function projectRenameDevWriter() {
  return {
    name: 'project-rename-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/project-rename', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const slug = String(body.slug || '').trim();
          const newSlug = String(body.newSlug || '').trim();
          if (!/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9-]+$/.test(newSlug) || slug === newSlug) {
            send(400, { error: 'Enter a valid new slug.' });
            return;
          }
          const newFile = path.join(process.cwd(), `src/content/projects/${newSlug}.json`);
          try {
            await readFile(newFile);
            send(400, { error: 'A project with that slug already exists.' });
            return;
          } catch {
            // available
          }
          const pageFile = path.join(process.cwd(), `src/pages/${newSlug}.astro`);
          try {
            await readFile(pageFile);
            send(400, { error: 'A page with that slug already exists.' });
            return;
          } catch {
            // available
          }

          const { file, data } = await assertModernProject(slug);
          data.slug = newSlug;
          await writeProjectJson(newFile, data);
          await rm(file, { force: true });
          invalidateAstroRouteCache(server);
          send(200, { ok: true, slug: newSlug });
        } catch (error) {
          send(400, { error: error instanceof Error ? error.message : 'Could not rename the project.' });
        }
      });
    },
  };
}
