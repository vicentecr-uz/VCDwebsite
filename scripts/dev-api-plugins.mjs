// @ts-check
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { suppressContentHmr } from './content-hmr-gate.mjs';
import { normalizeAssetSrc, readImageDimsFromSrc } from './dev-assets.mjs';

export { suppressContentHmr, contentHmrGate } from './content-hmr-gate.mjs';

async function writeProjectJson(file, data) {
  suppressContentHmr();
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const VALID_STATUSES = new Set(['published', 'draft', 'teaser']);
const PUBLIC_STATUSES = new Set(['published', 'teaser']);
const LISTING_GRIDS = ['home', 'work', 'play'];

function validateStatus(status, fallback = 'draft') {
  const value = String(status || fallback);
  return VALID_STATUSES.has(value) ? value : fallback;
}

function listingCardForGrid(grid, listing, previous = {}) {
  const base = {
    order: previous.order ?? 999,
    image: String(listing.image || ''),
    bg: String(listing.bg || '#efefef'),
    dark: Boolean(listing.dark),
    full: Boolean(listing.full),
  };
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

function rewriteDraftRefs(node, oldSlug, newSlug) {
  if (Array.isArray(node)) {
    for (const item of node) rewriteDraftRefs(item, oldSlug, newSlug);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.src === 'string' && node.src.startsWith(`draft:${oldSlug}/`)) {
    node.src = `draft:${newSlug}/${node.src.slice(`draft:${oldSlug}/`.length)}`;
  }
  for (const value of Object.values(node)) {
    rewriteDraftRefs(value, oldSlug, newSlug);
  }
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
  if (!Array.isArray(fieldPath) || !fieldPath.length) {
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
  ['[retired-project]', 'src/content/projects/[retired-project].json'],
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
  return map.get(documentKey);
}

export function draftMediaSrc(documentKey, filename) {
  return `draft:${documentKey}/${filename}`;
}

/**
 * Natural dimensions for a freshly dropped draft image, stamped onto the node so
 * frames resolve server-side (an `aspect: "original"` frame has no shape without
 * them). Mirrors scripts/migrate-crop-rects.mjs, including the EXIF transpose:
 * sharp reports stored dimensions, browsers honour the orientation flag.
 */
export async function readImageDims(documentKey, filename) {
  try {
    const { default: sharp } = await import('sharp');
    const file = path.join(process.cwd(), 'src/content/drafts/media', documentKey, filename);
    const { width, height, orientation } = await sharp(file).metadata();
    if (!width || !height) return null;
    const rotated = typeof orientation === 'number' && orientation >= 5 && orientation <= 8;
    return rotated ? { srcWidth: height, srcHeight: width } : { srcWidth: width, srcHeight: height };
  } catch {
    return null;
  }
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

export async function buildImageSection(documentKey, filenames) {
  const id = `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    type: 'image',
    id,
    src: draftMediaSrc(documentKey, filenames[0]),
    alt: '',
    spacing: 'section',
    ...(await readImageDims(documentKey, filenames[0]) ?? {}),
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  };
}

/** Build an image section from an existing canonical src token (draft: or public filename). */
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

export function buildPlaceholderImageSection() {
  const id = `placeholder-${Date.now().toString(36)}`;
  return {
    type: 'image',
    id,
    src: 'placeholder.svg',
    alt: 'Placeholder',
    spacing: 'section',
    variants: structuredClone(PLACEHOLDER_IMAGE_VARIANTS),
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
    dims = await readImageDimsFromSrc(src);
  } else {
    src = draftMediaSrc(documentKey, filename);
    dims = await readImageDims(documentKey, filename);
  }

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
    src: draftMediaSrc(documentKey, filename),
    alt: '',
    ...(await readImageDims(documentKey, filename) ?? {}),
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

/** Build an image grid from existing canonical src tokens (draft: or public filenames). */
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
    src: draftMediaSrc(documentKey, filename),
    alt: '',
    ...(await readImageDims(documentKey, filename) ?? {}),
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

/** Build an image carousel from existing canonical src tokens (draft: or public filenames). */
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

export function emptyModernProject(slug, title, grid) {
  const year = `'${new Date().getFullYear().toString().slice(-2)}`;
  const listing = grid === 'play'
    ? {
        order: 999,
        meta: '',
        image: '/images/black-token.svg',
        bg: '#efefef',
        dark: false,
        full: false,
      }
    : {
        order: 999,
        year,
        image: '/images/black-token.svg',
        bg: '#efefef',
        dark: false,
        full: false,
      };
  return {
    slug,
    title,
    description: '',
    status: 'draft',
    stack: 'modern',
    listings: {
      [grid]: listing,
    },
    outline: [
      {
        kind: 'section',
        id: 'overview',
        label: 'Overview',
        anchor: 'overview',
      },
    ],
    sections: [
      {
        type: 'sectionTitle',
        id: 'overview-title',
        title,
        spacing: 'section',
        sectionId: 'overview',
      },
      {
        type: 'bodyText',
        id: 'overview-body',
        spacing: 'section',
        sectionId: 'overview',
        paragraphs: [''],
      },
    ],
  };
}

export async function publishDraftMediaForProject(slug, data) {
  const draftDir = path.join(process.cwd(), 'src/content/drafts/media', slug);
  const publicDir = path.join(process.cwd(), 'public/images');
  const moved = [];
  const publishedSources = [];

  const rewriteNode = async (node) => {
    if (Array.isArray(node)) {
      for (const item of node) await rewriteNode(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (typeof node.src === 'string' && node.src.startsWith(`draft:${slug}/`)) {
      const filename = node.src.slice(`draft:${slug}/`.length);
      const source = path.join(draftDir, filename);
      const targetName = await uniqueUploadFilename(publicDir, filename);
      const target = path.join(publicDir, targetName);
      const file = await readFile(source);
      await writeFile(target, file);
      node.src = targetName;
      moved.push(targetName);
      publishedSources.push(source);
    }
    for (const value of Object.values(node)) {
      await rewriteNode(value);
    }
  };

  await rewriteNode(data);

  for (const source of publishedSources) {
    await rm(source, { force: true });
  }

  try {
    if (!readdirSync(draftDir).length) {
      await rm(draftDir, { recursive: true, force: true });
    }
  } catch {
    // Draft folder may not exist.
  }

  return moved;
}

export function draftMediaDevServer() {
  return {
    name: 'draft-media-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/draft-media', async (req, res, next) => {
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
        const filePath = path.join(process.cwd(), 'src/content/drafts/media', relative);
        try {
          const file = await readFile(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const type = ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
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
          const directory = path.join(process.cwd(), 'src/content/drafts/media', documentKey);
          // Draft media is served by middleware, not imported — still lives under
          // src/content, so Vite/Astro would full-reload without a suppress window.
          suppressContentHmr();
          await mkdir(directory, { recursive: true });
          const filenames = [];
          for (const file of files) {
            const mimeType = String(file.mimeType || '');
            if (!mimeType.startsWith('image/')) {
              send(400, { error: 'Only image uploads are supported.' });
              return;
            }
            const filename = await uniqueUploadFilename(directory, file.filename);
            const data = Buffer.from(String(file.data || ''), 'base64');
            await writeFile(path.join(directory, filename), data);
            filenames.push(filename);
          }
          send(200, { ok: true, filenames });
        } catch {
          send(400, { error: 'Could not save uploaded files.' });
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
          const slug = String(body.slug || '').trim();
          const title = String(body.title || '').trim();
          const grid = ['home', 'work', 'play'].includes(body.grid) ? body.grid : 'work';
          if (!/^[a-z0-9-]+$/.test(slug) || !title) {
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
          const project = emptyModernProject(slug, title, grid);
          await writeProjectJson(file, project);
          send(200, { ok: true, slug });
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
            send(200, {
              slug,
              title: data.title,
              description: data.description ?? '',
              status: data.status ?? 'draft',
              listings: data.listings ?? {},
              listing: {
                image: listing.image ?? '',
                bg: listing.bg ?? '#efefef',
                dark: Boolean(listing.dark),
                full: Boolean(listing.full),
                subtitle: listing.year ?? listing.meta ?? '',
              },
              teaser: data.teaser ?? {},
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
          data.listings = {};
          for (const grid of LISTING_GRIDS) {
            const listing = body.listings?.[grid];
            if (!listing) continue;
            data.listings[grid] = listingCardForGrid(grid, listing, previousListings[grid] ?? {});
          }
          data.teaser = {
            label: String(body.teaser?.label || ''),
            coverImage: String(body.teaser?.coverImage || ''),
          };
          let moved = [];
          if (PUBLIC_STATUSES.has(data.status)) {
            moved = await publishDraftMediaForProject(slug, data);
          }
          await writeProjectJson(file, data);
          send(200, { ok: true, moved });
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
          // Keep sidebar group membership in sync with the new page order.
          // Client sends the sticky-rebuilt outline (group anchors follow first child).
          if (Array.isArray(body.outline) && body.outline.length > 0) {
            data.outline = body.outline;
            delete data.nav;
          }
          await writeDevDocument(relativeFile, data);
          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not save section order.' });
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
              continue;
            }
            if (entry.type === 'play-link') {
              const id = String(entry.id || '').trim();
              if (!id || id.includes('..') || id.includes('/')) continue;
              const file = path.join(process.cwd(), `src/content/play/${id}.json`);
              const data = JSON.parse(await readFile(file, 'utf8'));
              data.order = order;
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
          await rm(path.join(process.cwd(), 'src/content/drafts/media', slug), {
            recursive: true,
            force: true,
          });
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
          rewriteDraftRefs(data, slug, newSlug);
          const draftDir = path.join(process.cwd(), 'src/content/drafts/media', slug);
          const nextDraftDir = path.join(process.cwd(), 'src/content/drafts/media', newSlug);
          try {
            await rename(draftDir, nextDraftDir);
          } catch {
            // no draft media folder yet
          }
          await writeProjectJson(newFile, data);
          await rm(file, { force: true });
          send(200, { ok: true, slug: newSlug });
        } catch (error) {
          send(400, { error: error instanceof Error ? error.message : 'Could not rename the project.' });
        }
      });
    },
  };
}

export function publishMediaDevWriter() {
  return {
    name: 'publish-media-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/publish-media', async (req, res, next) => {
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
          const relativeFile = resolveEditableDocument(slug);
          if (!relativeFile) {
            send(404, { error: 'Project not found.' });
            return;
          }
          const file = path.join(process.cwd(), relativeFile);
          const data = JSON.parse(await readFile(file, 'utf8'));
          const moved = await publishDraftMediaForProject(slug, data);
          await writeProjectJson(file, data);
          send(200, { ok: true, moved });
        } catch {
          send(400, { error: 'Could not publish media.' });
        }
      });
    },
  };
}
