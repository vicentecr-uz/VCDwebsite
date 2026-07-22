// @ts-check
import { readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_IMAGE_VARIANTS = {
  desktop: { aspectRatio: 'original', x: 0, y: 0, zoom: 1 },
  tablet: { aspectRatio: 'original', x: 0, y: 0, zoom: 1 },
  mobile: { aspectRatio: 'original', x: 0, y: 0, zoom: 1 },
};

export const PLACEHOLDER_IMAGE_VARIANTS = {
  desktop: { aspectRatio: '4:3', x: 0, y: 0, zoom: 1 },
  tablet: { aspectRatio: '4:3', x: 0, y: 0, zoom: 1 },
  mobile: { aspectRatio: '4:3', x: 0, y: 0, zoom: 1 },
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

export function buildImageSection(documentKey, filenames) {
  const id = `image-${Date.now().toString(36)}`;
  return {
    type: 'image',
    id,
    src: draftMediaSrc(documentKey, filenames[0]),
    alt: '',
    spacing: 'section',
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

export function buildImageGridSection(documentKey, filenames) {
  const id = `grid-${Date.now().toString(36)}`;
  const items = filenames.map((filename, index) => ({
    id: `item-${index + 1}-${Date.now().toString(36)}`,
    src: draftMediaSrc(documentKey, filename),
    alt: '',
    variants: structuredClone(DEFAULT_IMAGE_VARIANTS),
  }));
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

export function emptyModernProject(slug, title, grid) {
  const year = `'${new Date().getFullYear().toString().slice(-2)}`;
  return {
    slug,
    title,
    description: '',
    status: 'draft',
    stack: 'modern',
    listings: {
      [grid]: {
        order: 999,
        year,
        image: '/images/black-token.svg',
        bg: '#efefef',
        dark: false,
        full: false,
      },
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
    }
    for (const value of Object.values(node)) {
      await rewriteNode(value);
    }
  };

  await rewriteNode(data);
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
          await writeFile(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
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
          data.status = String(body.status || data.status || 'draft');
          data.slug = slug;
          const previousListings = data.listings ?? {};
          data.listings = {};
          for (const grid of ['home', 'work', 'play']) {
            const listing = body.listings?.[grid];
            if (!listing) continue;
            data.listings[grid] = {
              order: previousListings[grid]?.order ?? 999,
              image: String(listing.image || ''),
              bg: String(listing.bg || '#efefef'),
              dark: Boolean(listing.dark),
              full: Boolean(listing.full),
              ...(grid === 'play'
                ? { meta: String(listing.meta || listing.year || '') }
                : { year: String(listing.year || listing.meta || '') }),
            };
          }
          data.teaser = {
            label: String(body.teaser?.label || ''),
            coverImage: String(body.teaser?.coverImage || ''),
          };
          await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not save project settings.' });
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
              await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
              continue;
            }
            if (entry.type === 'play-link') {
              const id = String(entry.id || '').trim();
              if (!id || id.includes('..') || id.includes('/')) continue;
              const file = path.join(process.cwd(), `src/content/play/${id}.json`);
              const data = JSON.parse(await readFile(file, 'utf8'));
              data.order = order;
              await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
            }
          }

          const viewId = String(body.viewId || process.env.VIEW_ID || '').trim();
          if (viewId && !viewId.startsWith('_') && (grid === 'home' || grid === 'work')) {
            const viewPath = path.join(process.cwd(), `src/content/views/${viewId}.json`);
            const viewData = JSON.parse(await readFile(viewPath, 'utf8'));
            const projectItems = items.filter((entry) => entry.type === 'project');
            const orderBySlug = new Map(
              projectItems.map((entry) => [String(entry.slug || '').trim(), Number(entry.order)]),
            );
            const fullBySlug = new Map(
              projectItems
                .filter((entry) => typeof entry.full === 'boolean')
                .map((entry) => [String(entry.slug || '').trim(), entry.full]),
            );

            if (Array.isArray(viewData.projects)) {
              for (const project of viewData.projects) {
                const nextOrder = orderBySlug.get(project.slug);
                if (nextOrder != null) {
                  project.order = nextOrder;
                }
                if (fullBySlug.has(project.slug)) {
                  project.card = { ...(project.card ?? {}), full: fullBySlug.get(project.slug) };
                }
              }
              viewData.projects.sort((left, right) => (left.order ?? 999) - (right.order ?? 999));
              await writeFile(viewPath, `${JSON.stringify(viewData, null, 2)}\n`, 'utf8');
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
          await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
          send(200, { ok: true, moved });
        } catch {
          send(400, { error: 'Could not publish media.' });
        }
      });
    },
  };
}
