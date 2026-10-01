// @ts-check
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';

const GENERATED_EXTENSIONS = new Set(['.html', '.css', '.js']);
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'data', 'action', 'srcset']);

/** @param {string} dir @returns {Promise<string[]>} */
async function listFiles(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** @param {any} node @param {(node: any) => void} visit */
function walk(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

/** @param {any} node @param {string} name */
function attr(node, name) {
  return (node.attrs || []).find((item) => item.name.toLowerCase() === name)?.value ?? null;
}

/** @param {any} node */
function elementChildren(node) {
  return (node.childNodes || []).filter((child) => child.nodeName !== '#text' && child.nodeName !== '#comment');
}

/** @param {string} raw */
function cleanReference(raw) {
  return raw.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
}

/** @param {string} raw */
function srcsetReferences(raw) {
  return raw.split(',').map((part) => part.trim().split(/\s+/, 1)[0]).filter(Boolean);
}

/** @param {string} raw @param {URL} base @param {URL} site */
function resolveUrl(raw, base, site) {
  const value = cleanReference(raw);
  if (!value || /^(?:data|mailto|javascript|tel|blob):/i.test(value)) return null;
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (url.protocol !== site.protocol || url.host !== site.host) return null;
  return url;
}

/** @param {string} file @param {string} distDir */
function routeForFile(file, distDir) {
  const relative = path.relative(distDir, file).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  if (relative.endsWith('.html')) return `/${relative.slice(0, -'.html'.length)}`;
  return null;
}

/** @param {string} route */
function routeKey(route) {
  const url = new URL(route, 'https://output.invalid');
  url.search = ''; url.hash = '';
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replace(/\/+/g, '/'); } catch { pathname = url.pathname.replace(/\/+/g, '/'); }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (pathname !== '/' && !pathname.endsWith('/')) pathname += '/';
  return pathname;
}

/** @param {any} document */
function documentInfo(document) {
  const links = [];
  const resources = [];
  const inline = [];
  walk(document, (node) => {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase();
    const href = attr(node, 'href');
    if ((tag === 'a' || tag === 'area') && href) links.push(href);
    if ((tag === 'iframe' || tag === 'object')) {
      const embedded = attr(node, tag === 'iframe' ? 'src' : 'data');
      if (embedded) links.push(embedded);
    }
    for (const attribute of node.attrs || []) {
      const name = attribute.name.toLowerCase();
      if (name === 'srcset') resources.push(...srcsetReferences(attribute.value));
      else if (URL_ATTRIBUTES.has(name)) resources.push(attribute.value);
      if (name === 'style') inline.push(attribute.value);
    }
    if (tag === 'meta' && attr(node, 'http-equiv')?.toLowerCase() === 'refresh') {
      const content = attr(node, 'content') || '';
      const match = content.match(/^[^;]+;\s*url\s*=\s*(.*)$/i);
      if (match) links.push(match[1].trim().replace(/^['"]|['"]$/g, ''));
    }
    if (tag === 'style' || tag === 'script') inline.push((node.childNodes || []).map((child) => child.value || '').join(''));
  });
  return { links, resources, inline };
}

/** @param {any} document @param {URL} base @param {URL} site */
function redirectInfo(document, base, site) {
  const metas = [];
  walk(document, (node) => {
    if (node.tagName?.toLowerCase() !== 'meta' || attr(node, 'http-equiv')?.toLowerCase() !== 'refresh') return;
    const match = (attr(node, 'content') || '').match(/^[^;]+;\s*url\s*=\s*(.*)$/i);
    if (match) metas.push(match[1].trim().replace(/^['"]|['"]$/g, ''));
  });
  const body = (() => {
    let result = null;
    walk(document, (node) => { if (node.tagName?.toLowerCase() === 'body') result = node; });
    return result;
  })();
  if (!body || metas.length !== 1) return null;
  const children = elementChildren(body);
  const anchor = children[0];
  if (children.length !== 1 || anchor.tagName?.toLowerCase() !== 'a') return null;
  if ((body.childNodes || []).some((child) => child !== anchor && child.nodeName !== '#comment' && (child.nodeName !== '#text' || child.value.trim()))) return null;
  const href = attr(anchor, 'href');
  if (!href || cleanReference(href) !== cleanReference(metas[0])) return null;
  const destination = resolveUrl(href, base, site);
  if (!destination) {
    let external;
    try { external = new URL(cleanReference(href), base); } catch { return null; }
    if (!['http:', 'https:'].includes(external.protocol) || external.host === site.host) return null;
    return { href, destination: external, external: true };
  }
  return { href, destination, external: false };
}

/** @param {string} raw @param {string} file @param {string} distDir @param {URL} site */
function resolveAssetFile(raw, file, distDir, site) {
  const base = new URL(`file://${file}`);
  const value = cleanReference(raw);
  if (!value || /^(?:data|mailto|javascript|tel|blob):/i.test(value)) return null;
  let candidate;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
      const url = new URL(value);
      if (url.protocol !== site.protocol || url.host !== site.host) return null;
      candidate = path.join(distDir, decodeURIComponent(url.pathname).replace(/^\//, ''));
    } else if (value.startsWith('/')) candidate = path.join(distDir, decodeURIComponent(value.slice(1)));
    else if (value.startsWith('_astro/')) candidate = path.join(distDir, decodeURIComponent(value));
    else if (file.endsWith('.html')) {
      const route = routeForFile(file, distDir) || '/';
      const url = resolveUrl(value, new URL(route, site), site);
      if (!url) return null;
      candidate = path.join(distDir, decodeURIComponent(url.pathname).replace(/^\//, ''));
    } else candidate = decodeURIComponent(new URL(value, base).pathname);
  } catch { return null; }
  const resolved = path.resolve(candidate);
  const root = path.resolve(distDir) + path.sep;
  return resolved === path.resolve(distDir) || resolved.startsWith(root) ? resolved : null;
}

/** @param {string} contents */
function codeReferences(contents) {
  const refs = [];
  for (const match of contents.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) refs.push(match[1]);
  for (const match of contents.matchAll(/(['"`])([^'"`\n]+)\1/g)) refs.push(match[2]);
  return refs;
}

/** @param {string} distDir @param {{site?: string|URL, assetsDir?: string}} options */
export async function prunePublicOutput(distDir, options = {}) {
  const site = new URL(String(options.site || 'http://localhost/'));
  const assetsDir = options.assetsDir || '_astro';
  const allFiles = await listFiles(distDir);
  const htmlFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === '.html');
  const routeFiles = new Map();
  for (const file of htmlFiles) {
    const route = routeForFile(file, distDir);
    if (route) routeFiles.set(routeKey(route), file);
  }
  if (!routeFiles.has('/')) throw new Error(`public output: missing root index.html in ${distDir}`);

  const documents = new Map();
  for (const file of htmlFiles) documents.set(file, parse(await readFile(file, 'utf8')));
  const reachable = new Set();
  const queue = [routeFiles.get('/')];
  while (queue.length) {
    const file = queue.shift();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);
    const document = documents.get(file);
    const info = documentInfo(document);
    const route = routeForFile(file, distDir) || '/';
    const base = new URL(route, site);
    for (const raw of info.links) {
      const target = resolveUrl(raw, base, site);
      if (!target) continue;
      const targetFile = routeFiles.get(routeKey(target.pathname));
      if (targetFile && !reachable.has(targetFile)) queue.push(targetFile);
    }
    const redirect = redirectInfo(document, base, site);
    if (redirect && !redirect.external) {
      const targetFile = routeFiles.get(routeKey(redirect.destination.pathname));
      if (targetFile && !reachable.has(targetFile)) queue.push(targetFile);
    }
  }

  const technical = new Set(htmlFiles.filter((file) => {
    const route = routeForFile(file, distDir) || '';
    if (routeKey(route) === '/404/') return true;
    const redirect = redirectInfo(documents.get(file), new URL(route || '/', site), site);
    if (!redirect) return false;
    if (redirect.external) return true;
    const targetFile = routeFiles.get(routeKey(redirect.destination.pathname));
    return Boolean(targetFile && reachable.has(targetFile));
  }));
  const retainedHtml = new Set([...reachable, ...technical]);
  const removedHtml = [];
  for (const file of htmlFiles) {
    if (!retainedHtml.has(file)) { await unlink(file); removedHtml.push(path.relative(distDir, file)); }
  }

  const retainedAssets = new Set();
  // Ceiling: this traces emitted HTML/CSS/JS and generated assets; upgrade to a full module graph when runtime loading semantics require it.
  const assetRoot = path.resolve(distDir, assetsDir);
  const addRefs = (file, refs) => {
    for (const raw of refs) {
      const resolved = resolveAssetFile(raw, file, distDir, site);
      if (resolved && (resolved === assetRoot || resolved.startsWith(assetRoot + path.sep))) retainedAssets.add(resolved);
    }
  };
  for (const file of retainedHtml) {
    const info = documentInfo(documents.get(file));
    addRefs(file, [...info.resources, ...info.inline.flatMap((value) => codeReferences(value))]);
  }
  const assetFiles = allFiles.filter((file) => file === assetRoot || file.startsWith(assetRoot + path.sep));
  const assetQueue = [...retainedAssets];
  while (assetQueue.length) {
    const file = assetQueue.shift();
    if (!file || !assetFiles.includes(file) || !GENERATED_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    for (const raw of codeReferences(await readFile(file, 'utf8'))) {
      const resolved = resolveAssetFile(raw, file, distDir, site);
      if (resolved && assetFiles.includes(resolved) && !retainedAssets.has(resolved)) { retainedAssets.add(resolved); assetQueue.push(resolved); }
    }
  }
  const removedAssets = [];
  for (const file of assetFiles) {
    if (!retainedAssets.has(file)) { await unlink(file); removedAssets.push(path.relative(distDir, file)); }
  }
  return { retainedHtml: [...retainedHtml].map((file) => path.relative(distDir, file)), removedHtml, retainedAssets: [...retainedAssets].map((file) => path.relative(distDir, file)), removedAssets };
}
