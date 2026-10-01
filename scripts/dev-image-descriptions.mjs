// @ts-check
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import sharp from 'sharp';
import { documentInfo } from './public-site-output.mjs';
import { readDevDocument, resolveEditableDocument, writeDevDocument } from './dev-api-plugins.mjs';

const DEFAULT_SITE = 'https://wip.vcruzdesigns.com';
const MAX_PAGES = 100;
const MAX_HTML = 2 * 1024 * 1024;
const MAX_IMAGE = 16 * 1024 * 1024;
const MAX_DESCRIPTION = 300;
const VALID_INTENTS = new Set(['auto', 'manual', 'decorative']);
const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff']);

const cleanPath = (value) => String(value || '').split(/[?#]/, 1)[0];
const tokenFromUrl = (value) => decodeURIComponent(cleanPath(value).replace(/^\/images\//, ''));
const isRaster = (value) => RASTER.has(path.extname(cleanPath(value)).toLowerCase());
const plain = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_DESCRIPTION && !/[<>]/.test(value);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBoundedBody(response, limit) {
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length > limit) return null;
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.length > limit ? null : text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function walkJson(value, pathParts, callback) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, [...pathParts, index], callback));
    return;
  }
  callback(value, pathParts);
  for (const [key, child] of Object.entries(value)) walkJson(child, [...pathParts, key], callback);
}

function stableIds(data, nodePath, node) {
  const sectionIndex = nodePath.indexOf('sections');
  if (sectionIndex < 0) return [];
  const section = data.sections?.[nodePath[sectionIndex + 1]];
  const ids = section?.id ? [section.id] : [];
  if (node?.id && node !== section) ids.push(node.id);
  return ids;
}

function sourceNodes(document, data) {
  const result = [];
  walkJson(data, [], (node, nodePath) => {
    const sectionIndex = nodePath.indexOf('sections');
    const section = sectionIndex >= 0 ? data.sections?.[nodePath[sectionIndex + 1]] : null;
    if (!['image', 'imageGrid', 'imageCarousel'].includes(String(node.type || ''))
      && !['image', 'imageGrid', 'imageCarousel'].includes(String(section?.type || ''))) return;
    if (typeof node.src !== 'string' || !node.src.trim() || !isRaster(node.src) || node.src === 'black-token.svg') return;
    result.push({ document, node, path: nodePath, ids: stableIds(data, nodePath, node), src: node.src });
  });
  return result;
}

function attr(node, name) { return (node.attrs || []).find((item) => item.name === name)?.value || ''; }
function ancestor(node, predicate) {
  for (let current = node.parentNode; current; current = current.parentNode) if (predicate(current)) return current;
  return null;
}

function publicImages(document) {
  const found = [];
  const visit = (node) => {
    if (node.tagName !== 'img') return;
    const original = attr(node, 'data-image-original') || attr(node, 'src');
    if (!original || !isRaster(original) || /placeholder|black-token/i.test(original)) return;
    if (node.attrs?.some((item) => item.name === 'hidden') || ancestor(node, (item) => item.attrs?.some((a) => a.name === 'hidden'))) return;
    const carousel = ancestor(node, (item) => item.attrs?.some((a) => a.name === 'data-carousel-slide'));
    if (carousel && attr(carousel, 'aria-hidden') === 'true') return;
    const grid = ancestor(node, (item) => item.attrs?.some((a) => a.name === 'data-grid-item-id'));
    if (grid && ['desktop', 'tablet', 'mobile'].every((mode) => attr(grid, `data-grid-hidden-${mode}`) === 'true')) return;
    const ids = [];
    for (let current = node; current; current = current.parentNode) {
      const id = attr(current, 'data-grid-item-id') || attr(current, 'data-outline-id') || attr(current, 'id');
      if (id) ids.unshift(id);
    }
    found.push({ src: tokenFromUrl(original), alt: attr(node, 'alt'), ids, node });
  };
  const walk = (node) => { visit(node); (node.childNodes || []).forEach(walk); };
  walk(document);
  return found;
}

function routeForDocument(document) { return document === 'home' ? '/' : `/${document}/`; }

async function publicGraph({ fetchImpl, site, root = '/' }) {
  const origin = new URL(site || DEFAULT_SITE);
  const pages = new Map();
  const queue = [new URL(root, origin)];
  const visited = new Set();
  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    const requestKey = url.href;
    if (url.origin !== origin.origin || visited.has(requestKey)) continue;
    visited.add(requestKey);
    const response = await fetchImpl(url, { credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300 && response.status < 400) {
      try { const next = new URL(response.headers.get('location'), url); if (next.origin === origin.origin) queue.push(next); } catch {}
      continue;
    }
    if (!response.ok || new URL(response.url || url, origin).origin !== origin.origin) continue;
    const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!type.includes('text/html')) continue;
    const html = await readBoundedBody(response, MAX_HTML);
    if (html === null) continue;
    const document = parse(html);
    pages.set(url.pathname, { document, html });
    if (/^\/404\/?$/.test(url.pathname)) continue;
    const info = documentInfo(document);
    for (const raw of info.links) {
      let next;
      try { next = new URL(raw, url); } catch { continue; }
      if (next.origin === origin.origin) { next.search = ''; next.hash = ''; if (!pages.has(next.pathname)) queue.push(next); }
    }
  }
  return pages;
}

async function readCache(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}

async function writeCache(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function statusFor(row) {
  if (row.intent === 'decorative') return 'Decorative';
  if (row.intent === 'manual') return 'Manual';
  if (row.status === 'failed' || row.error) return 'Failed';
  if (row.description) return 'Ready';
  if (row.status === 'describing') return 'Describing';
  return 'Waiting for publication';
}

export function createImageDescriptionsService(options = {}) {
  const cwd = options.cwd || process.cwd();
  const site = new URL(options.site || process.env.PUBLIC_SITE_URL || DEFAULT_SITE);
  const fetchImpl = options.fetchImpl || fetch;
  const modelFetch = options.modelFetch || fetchImpl;
  const cacheFile = options.cacheFile || path.join(cwd, '.dev-session/image-descriptions.json');
  const mediaDir = options.mediaDir || path.join(cwd, 'media');
  const readDocument = options.readDocument || (async (document) => {
    const relative = resolveEditableDocument(document);
    if (!relative) throw new Error('Document not found.');
    return readDevDocument(relative);
  });
  const writeDocument = options.writeDocument || (async (document, data) => {
    const relative = resolveEditableDocument(document);
    if (!relative) throw new Error('Document not found.');
    return writeDevDocument(relative, data);
  });
  let rows = [];
  let checking = false;
  async function enumerate() {
    const graph = await publicGraph({ fetchImpl, site });
    const usage = new Map();
    let documentKeys = options.documentKeys;
    if (!documentKeys) {
      const keys = [];
      for (const directory of ['src/content/pages', 'src/content/projects']) {
        try { keys.push(...(await readdir(path.join(cwd, directory))).filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''))); } catch {}
      }
      documentKeys = keys;
    }
    const publicByDocument = new Map();
    for (const [pathname, page] of graph) {
      const document = pathname === '/' ? 'home' : pathname.replace(/^\//, '').replace(/\/$/, '');
      publicByDocument.set(document, publicImages(page.document));
    }
    for (const document of documentKeys) {
      let data;
      try { data = await readDocument(document); } catch { continue; }
      const source = sourceNodes(document, data);
      const images = publicByDocument.get(document) || [];
      for (const node of source) {
        const candidates = images.filter((image) => cleanPath(image.src) === cleanPath(node.src));
        const matched = candidates.filter((image) => !node.ids.length || node.ids.some((id) => image.ids.includes(id)));
        const publicUse = matched.length === 1 ? matched[0] : (candidates.length === 1 ? candidates[0] : null);
        const key = `${document}:${node.ids.join('/') || node.path.join('.')}`;
        if (usage.has(key)) continue;
        usage.set(key, { key, document, title: data.title || document, pathLabel: publicUse?.ids.join(' / ') || node.ids.join(' / ') || 'Image', path: node.path, src: node.src, alt: String(node.node.alt || ''), intent: VALID_INTENTS.has(node.node.altIntent) ? node.node.altIntent : 'manual', public: Boolean(publicUse && (!data.status || data.status === 'published' || document === 'home')), node, sourceBytes: null });
      }
    }
    return [...usage.values()];
  }

  async function sourcePath(src) {
    const token = cleanPath(src).replace(/^\//, '');
    const file = path.resolve(mediaDir, token);
    if (!file.startsWith(path.resolve(mediaDir) + path.sep)) throw new Error('Invalid image path.');
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error('Image source symlinks are not allowed.');
    if (!info.isFile()) throw new Error('Image source is not a file.');
    return file;
  }

  async function baseToken(row) {
    const file = await sourcePath(row.src);
    const bytes = await readFile(file);
    return createHash('sha256').update(JSON.stringify({ src: row.src, alt: row.alt, intent: row.intent, bytes: createHash('sha256').update(bytes).digest('hex') })).digest('hex');
  }

  async function refresh() {
    const cache = await readCache(cacheFile);
    const next = await enumerate();
    for (const row of next) {
      row.baseToken = await baseToken(row).catch(() => '');
      const saved = cache[row.key];
      if (saved && saved.baseToken === row.baseToken && saved.intent === row.intent && saved.alt === row.alt) {
        row.description = saved.description || '';
        row.status = saved.status || '';
        row.error = saved.error;
      }
      row.status = statusFor(row);
    }
    rows = next;
    return rows;
  }

  async function describe(row) {
    const file = await sourcePath(row.src);
    const original = await readFile(file);
    const publicResponse = await fetchImpl(new URL(`/images/${encodeURIComponent(row.src).replace(/%2F/g, '/')}`, site), { credentials: 'omit' });
    if (!publicResponse.ok) throw new Error('Public image is unavailable.');
    if (new URL(publicResponse.url || site, site).origin !== site.origin) throw new Error('Public image redirect crossed origin.');
    const contentType = String(publicResponse.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/') || contentType.includes('svg')) throw new Error('Public image is not a raster image.');
    const publicBytes = Buffer.from(await publicResponse.arrayBuffer());
    if (publicBytes.length > MAX_IMAGE || !original.equals(publicBytes)) throw new Error('Public image does not match the local source.');
    const resized = await sharp(publicBytes).flatten({ background: '#ffffff' }).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const response = await modelFetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal: AbortSignal.timeout(90_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gemma3:4b', stream: false, options: { temperature: 0, num_predict: 90 }, messages: [{ role: 'user', content: 'Identify primary visible objects or action. Omit incidental backgrounds, colours, materials, inferred relationships, and purpose. Use 25 words or fewer; do not begin with “image of” or “showcasing”.', images: [resized.toString('base64')] }] }) });
    if (!response.ok) throw new Error('The local vision model failed.');
    const body = await response.json();
    const text = String(body.message?.content || '').trim();
    if (!plain(text)) throw new Error('The model returned invalid description text.');
    return text;
  }

  async function check() {
    if (checking) return rows;
    checking = true;
    try {
      await refresh();
      const cache = await readCache(cacheFile);
      const candidates = rows.filter((row) => row.public && row.intent === 'auto' && !row.description && row.status !== 'failed');
      for (const row of candidates) {
        row.status = 'describing';
        try {
          const description = await describe(row);
          await refresh();
          const current = rows.find((candidate) => candidate.key === row.key);
          if (!current || current.baseToken !== row.baseToken) continue;
          current.description = description;
          current.status = 'ready';
          cache[row.key] = { description, status: current.status, baseToken: current.baseToken, alt: current.alt, intent: current.intent };
        }
        catch (error) { row.status = 'failed'; row.error = error instanceof Error ? error.message : 'Generation failed.'; cache[row.key] = { status: row.status, error: row.error, baseToken: row.baseToken, alt: row.alt, intent: row.intent }; }
        await writeCache(cacheFile, cache);
      }
      rows.forEach((row) => { row.status = statusFor(row); });
    } finally { checking = false; }
    return rows;
  }

  function publicRows() { return rows.map(({ node, sourceBytes, ...row }) => ({ ...row, status: statusFor(row), description: row.description || row.alt })); }

  async function save(body) {
    await refresh();
    const row = rows.find((item) => item.key === body.key);
    if (!row || row.baseToken !== body.baseToken) return { status: 409, payload: { error: 'This image changed. Refresh and try again.' } };
    const intent = String(body.intent || '');
    const alt = String(body.alt || '');
    if (!VALID_INTENTS.has(intent) || alt.length > MAX_DESCRIPTION || (intent !== 'decorative' && alt && !plain(alt))) return { status: 400, payload: { error: 'Invalid description.' } };
    let data;
    try { data = await readDocument(row.document); } catch { return { status: 404, payload: { error: 'Document not found.' } }; }
    let target;
    walkJson(data, [], (node, nodePath) => { if (!target && nodePath.join('.') === row.node.path.join('.') && node.src === row.node.src) target = node; });
    if (!target) return { status: 409, payload: { error: 'This image changed. Refresh and try again.' } };
    target.alt = intent === 'decorative' ? '' : alt;
    target.altIntent = intent;
    await writeDocument(row.document, data);
    await refresh();
    const saved = rows.find((item) => item.key === row.key);
    return { status: 200, payload: { ok: true, row: saved ? { ...saved, node: undefined, description: saved.alt, status: statusFor(saved) } : null } };
  }

  async function retry(key) {
    const cache = await readCache(cacheFile);
    delete cache[key];
    await writeCache(cacheFile, cache);
    const row = rows.find((item) => item.key === key);
    if (row) { row.status = ''; row.error = undefined; }
    return check();
  }
  return { refresh, check, retry, save, rows: publicRows, isChecking: () => checking };
}

export function imageDescriptionsDevWriter(options = {}) {
  return {
    name: 'image-descriptions-dev-writer', apply: 'serve',
    configureServer(server) {
      const service = createImageDescriptionsService(options);
      server.middlewares.use('/api/image-descriptions', async (req, res, next) => {
        try {
          if (req.method === 'GET') { await service.refresh(); sendJson(res, 200, { rows: service.rows(), checking: service.isChecking() }); return; }
          if (req.method !== 'POST') { next(); return; }
          const body = await bodyJson(req);
          if (body.action === 'check') { service.check(); sendJson(res, 202, { rows: service.rows(), checking: true }); return; }
          if (body.action === 'retry') { service.retry(String(body.key || '')); sendJson(res, 202, { rows: service.rows(), checking: true }); return; }
          sendJson(res, 400, { error: 'Unknown action.' });
        } catch { sendJson(res, 400, { error: 'Could not load image descriptions.' }); }
      });
      server.middlewares.use('/api/image-description-save', async (req, res, next) => {
        if (req.method !== 'POST') { next(); return; }
        try { const result = await service.save(await bodyJson(req)); sendJson(res, result.status, result.payload); }
        catch { sendJson(res, 400, { error: 'Could not save image description.' }); }
      });
      const timer = setInterval(() => { service.check(); }, 30_000);
      server.httpServer?.once('close', () => clearInterval(timer));
    },
  };
}
