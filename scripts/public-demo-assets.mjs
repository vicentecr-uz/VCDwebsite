// @ts-check
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const TECHNICAL_FILENAMES = new Set(['placeholder.svg', 'black-token.svg']);
const MARKER = /(<script\b[^>]*\btype=["']application\/json["'][^>]*\bdata-published-demo-assets(?=\s|=|>)[^>]*>)[\s\S]*?(<\/script>)/gi;

/** @param {string} dir @returns {Promise<string[]>} */
async function listHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`public output: symlink is not allowed in dist: ${file}`);
    if (entry.isDirectory()) files.push(...await listHtmlFiles(file));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.html') files.push(file);
  }
  return files;
}

/** @param {string} distDir @param {string[]|Set<string>|undefined} retainedHtml */
async function publishedHtmlFiles(distDir, retainedHtml) {
  let files;
  try { files = await listHtmlFiles(distDir); }
  catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (!retainedHtml) return files;
  const allowed = new Set([...retainedHtml].map((file) => path.normalize(String(file))));
  return files.filter((file) => allowed.has(path.normalize(path.relative(distDir, file))));
}

/** @param {string} value @returns {string|null} */
function normalizeImageToken(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return null;
  const source = raw.startsWith('/images/') ? raw.slice('/images/'.length) : raw;
  let token;
  try { token = decodeURIComponent(source); } catch { return null; }
  if (!token || token.startsWith('/') || token.includes('\\')) return null;
  const parts = token.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  const filename = parts.at(-1) || '';
  const lower = filename.toLowerCase();
  if (!IMAGE_EXTENSIONS.has(path.extname(lower)) || TECHNICAL_FILENAMES.has(lower) || lower.includes('black-token')) return null;
  return token;
}

/** @param {string} token */
function imageUrl(token, tier = 'original') {
  const encodeSegment = (value) => encodeURIComponent(value).replace(/'/g, '%27');
  if (tier === 'original' || token.toLowerCase().endsWith('.svg') || token.toLowerCase().endsWith('.gif')) {
    return `/images/${token.split('/').map(encodeSegment).join('/')}`;
  }
  const parts = token.split('/');
  const filename = parts.pop() || '';
  const dot = filename.lastIndexOf('.');
  parts.push(`${dot > 0 ? filename.slice(0, dot) : filename}.${tier}.webp`);
  return `/images/${parts.map(encodeSegment).join('/')}`;
}

/** @param {string} token */
function thumbUrl(token) {
  return imageUrl(token, 'thumb');
}

/** @param {string} html @returns {Set<string>} */
function renderedImageTokens(html) {
  const tokens = new Set();
  const add = (value) => {
    for (const raw of String(value || '').split(',')) {
      const candidate = raw.trim().split(/\s+/, 1)[0];
      if (!candidate.startsWith('/images/')) continue;
      const token = normalizeImageToken(candidate);
      if (token) tokens.add(token);
    }
  };
  const walk = (node) => {
    if (!node) return;
    for (const attr of node.attrs || []) add(attr.value);
    if (node.nodeName === '#text' || node.nodeName === '#comment') {
      for (const match of String(node.value || '').matchAll(/[`"'](\/images\/[^`"']+)[`"']/g)) add(match[1]);
    }
    for (const child of node.childNodes || []) walk(child);
  };
  walk(parse(html));
  return tokens;
}

/** @param {string} html */
function isSubstantiveRender(html) {
  if (!/<meta\b[^>]*http-equiv=["']?refresh\b/i.test(html)) return true;
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
  const children = withoutComments.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, '').trim();
  return !/^\s*<a\b[^>]*>[\s\S]*?<\/a>\s*$/i.test(children);
}

/** @param {string} file */
async function readProject(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

/** @param {unknown} node @param {Set<string>} out */
function collectProjectImages(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectProjectImages(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (node))) {
    if (['src', 'image', 'hoverImage', 'coverImage'].includes(key) && typeof value === 'string') {
      const token = normalizeImageToken(value);
      if (token) out.add(token);
    }
    collectProjectImages(value, out);
  }
}

/** @param {string} distDir @param {string} slug @param {string[]|Set<string>|undefined} retainedHtml */
async function retainedProjectHtml(distDir, slug, retainedHtml) {
  const relative = path.join(slug, 'index.html');
  if (retainedHtml && !new Set([...retainedHtml].map((file) => path.normalize(file))).has(path.normalize(relative))) return null;
  const file = path.join(distDir, relative);
  try { await stat(file); } catch { return null; }
  const html = await readFile(file, 'utf8');
  return isSubstantiveRender(html) ? { file, html } : null;
}

/**
 * @param {{distDir:string, projectsDir:string, mediaDir:string, retainedHtml?:string[]|Set<string>}} options
 * @returns {Promise<Array<{slug:string,title:string,images:Array<{src:string,filename:string,url:string,thumb:string}>}>>}
 */
export async function readPublishedDemoAssets({ distDir, projectsDir, mediaDir, retainedHtml }) {
  let entries = [];
  try { entries = await readdir(projectsDir, { withFileTypes: true }); } catch { entries = []; }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(projectsDir, entry.name)).sort();
  const catalog = [];
  const mediaRoot = path.resolve(mediaDir);
  for (const file of files) {
    const data = await readProject(file);
    if (!data || (data.status !== undefined && data.status !== 'published')) continue;
    const slug = String(data.slug || path.basename(file, '.json')).trim();
    if (!slug || slug === '404' || slug.includes('/') || slug.includes('\\')) continue;
    const page = await retainedProjectHtml(distDir, slug, retainedHtml);
    if (!page) continue;
    const rendered = renderedImageTokens(page.html);
    const sourceTokens = new Set();
    collectProjectImages(data, sourceTokens);
    const images = [];
    for (const token of [...sourceTokens].sort()) {
      if (!rendered.has(token)) continue;
      const source = path.resolve(mediaRoot, token);
      if (source !== mediaRoot && !source.startsWith(`${mediaRoot}${path.sep}`)) continue;
      try { if (!(await stat(source)).isFile()) continue; } catch { continue; }
      images.push({ src: token, filename: path.basename(token), url: imageUrl(token, 'preview'), thumb: thumbUrl(token) });
    }
    if (images.length) catalog.push({ slug, title: String(data.title || slug), images });
  }
  return catalog.sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
}

/** @param {string} distDir @param {Array<{slug:string,title:string,images:Array<{src:string,filename:string,url:string,thumb:string}>}>} catalog @param {string[]|Set<string>|undefined} retainedHtml */
export async function injectPublishedDemoAssets(distDir, catalog, retainedHtml) {
  const json = JSON.stringify(catalog).replace(/</g, '\\u003c');
  let changed = false;
  for (const file of await publishedHtmlFiles(distDir, retainedHtml)) {
    const html = await readFile(file, 'utf8');
    const updated = html.replace(MARKER, (_match, open, close) => {
      changed = true;
      return `${open}${json}${close}`;
    });
    if (updated !== html) await writeFile(file, updated, 'utf8');
  }
  return changed;
}
