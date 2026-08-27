// @ts-check
import { stat } from 'node:fs/promises';
import path from 'node:path';

export const THUMB_SIZE = 640;
export const PREVIEW_SIZE = 1440;

const THUMB_SUFFIX = '.thumb.webp';
const PREVIEW_SUFFIX = '.preview.webp';

/** @param {string} token */
export function isDerivativeToken(token) {
  const base = path.basename(token);
  return base.endsWith(THUMB_SUFFIX) || base.endsWith(PREVIEW_SUFFIX);
}

/** @param {string} token @returns {'thumb' | 'preview' | null} */
export function derivativeKind(token) {
  const base = path.basename(token);
  if (base.endsWith(THUMB_SUFFIX)) return 'thumb';
  if (base.endsWith(PREVIEW_SUFFIX)) return 'preview';
  return null;
}

/** @param {string} token @returns {string | null} */
function derivativeStem(token) {
  const base = path.basename(token);
  if (base.endsWith(THUMB_SUFFIX)) return base.slice(0, -THUMB_SUFFIX.length);
  if (base.endsWith(PREVIEW_SUFFIX)) return base.slice(0, -PREVIEW_SUFFIX.length);
  return null;
}

/** @param {string} token @returns {string[]} */
export function originalCandidates(token) {
  const stem = derivativeStem(token);
  if (!stem) return [];
  const dir = path.dirname(token);
  const prefix = dir === '.' ? '' : `${dir}/`;
  const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.JPG', '.JPEG', '.PNG'];
  return extensions.map((ext) => `${prefix}${stem}${ext}`);
}

/**
 * @param {string} mediaDir
 * @param {string} token
 * @returns {Promise<string | null>}
 */
export async function findOriginal(mediaDir, token) {
  for (const candidate of originalCandidates(token)) {
    const full = path.join(mediaDir, candidate);
    try {
      await stat(full);
      return full;
    } catch {
      // try next extension
    }
  }
  return null;
}

/**
 * @param {string} originalPath
 * @param {'thumb' | 'preview'} kind
 * @returns {Promise<Buffer>}
 */
export async function generateDerivativeBuffer(originalPath, kind) {
  const size = kind === 'thumb' ? THUMB_SIZE : PREVIEW_SIZE;
  const { default: sharp } = await import('sharp');
  return sharp(originalPath)
    .rotate()
    .resize({ width: size, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
}
