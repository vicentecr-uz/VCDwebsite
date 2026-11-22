#!/usr/bin/env node

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'src/content');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');

const ASSET_FIELDS = new Set([
  'src',
  'image',
  'hoverImage',
  'coverImage',
  'avatarSrc',
  'logoSrc',
  'poster',
]);

const DRAFT_PREFIX = 'draft:';
const DRAFT_MEDIA_PREFIX = '/draft-media/';
const IMAGES_PREFIX = '/images/';

const stats = {
  files: 0,
  refs: 0,
};

/** @param {string} value */
function normalizeRef(value) {
  const raw = String(value ?? '');
  if (!raw) return raw;
  if (/^(https?:)?\/\//i.test(raw)) return raw;

  if (raw.startsWith(DRAFT_PREFIX)) {
    return decodeURIComponent(raw.slice(DRAFT_PREFIX.length));
  }
  if (raw.startsWith(DRAFT_MEDIA_PREFIX)) {
    return decodeURIComponent(raw.slice(DRAFT_MEDIA_PREFIX.length));
  }
  if (raw.startsWith(IMAGES_PREFIX)) {
    return decodeURIComponent(raw.slice(IMAGES_PREFIX.length));
  }
  if (raw.startsWith('/')) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** @param {unknown} node @returns {boolean} whether anything changed */
function walk(node) {
  if (Array.isArray(node)) {
    let changed = false;
    for (const item of node) {
      if (walk(item)) changed = true;
    }
    return changed;
  }
  if (!node || typeof node !== 'object') return false;

  /** @type {Record<string, unknown>} */
  const obj = /** @type {Record<string, unknown>} */ (node);
  let changed = false;
  for (const key of ASSET_FIELDS) {
    const value = obj[key];
    if (typeof value !== 'string' || !value) continue;
    const next = normalizeRef(value);
    if (next !== value) {
      obj[key] = next;
      stats.refs += 1;
      changed = true;
    }
  }

  for (const value of Object.values(obj)) {
    if (walk(value)) changed = true;
  }
  return changed;
}

/** @param {string} dir @returns {Promise<string[]>} */
async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

const files = await findJsonFiles(CONTENT_DIR);

for (const file of files) {
  const raw = await readFile(file, 'utf8');
  const data = JSON.parse(raw);
  const changed = walk(data);
  if (!changed) continue;
  const next = `${JSON.stringify(data, null, 2)}\n`;
  stats.files += 1;
  if (!DRY) await writeFile(file, next, 'utf8');
  console.log(`${DRY ? 'would update' : 'updated'}  ${path.relative(ROOT, file)}`);
}

console.log('\n--- migrate-asset-refs ---');
console.log(`mode          ${DRY ? 'dry run' : 'write'}`);
console.log(`files changed ${stats.files}`);
console.log(`refs rewritten ${stats.refs}`);
