// @ts-check
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { isVideoSrc } from '../src/lib/imageUpload.mjs';

export const THUMB_SIZE = 640;
export const PREVIEW_SIZE = 2560;

const THUMB_SUFFIX = '.thumb.webp';
const PREVIEW_SUFFIX = '.preview.webp';
const POSTER_SUFFIX = '.poster.webp';
const execFileAsync = promisify(execFile);

/** @param {string} token */
export function isDerivativeToken(token) {
  const base = path.basename(token);
  return base.endsWith(THUMB_SUFFIX) || base.endsWith(PREVIEW_SUFFIX)
    || (base.endsWith(POSTER_SUFFIX) && isVideoSrc(derivativeStem(token) ?? ''));
}

/** @param {string} token @returns {'thumb' | 'preview' | 'poster' | null} */
export function derivativeKind(token) {
  const base = path.basename(token);
  if (base.endsWith(THUMB_SUFFIX)) return 'thumb';
  if (base.endsWith(PREVIEW_SUFFIX)) return 'preview';
  if (base.endsWith(POSTER_SUFFIX) && isVideoSrc(derivativeStem(token) ?? '')) return 'poster';
  return null;
}

/** @param {string} token @returns {string | null} */
function derivativeStem(token) {
  const base = path.basename(token);
  if (base.endsWith(THUMB_SUFFIX)) return base.slice(0, -THUMB_SUFFIX.length);
  if (base.endsWith(PREVIEW_SUFFIX)) return base.slice(0, -PREVIEW_SUFFIX.length);
  if (base.endsWith(POSTER_SUFFIX)) return base.slice(0, -POSTER_SUFFIX.length);
  return null;
}

/** @param {string} token @returns {string[]} */
export function originalCandidates(token) {
  const stem = derivativeStem(token);
  if (!stem) return [];
  const dir = path.dirname(token);
  const prefix = dir === '.' ? '' : `${dir}/`;
  if (derivativeKind(token) === 'poster') {
    return isVideoSrc(stem) ? [`${prefix}${stem}`] : [];
  }
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
 * @param {'thumb' | 'preview' | 'poster'} kind
 * @returns {Promise<Buffer>}
 */
export async function generateDerivativeBuffer(originalPath, kind) {
  if (kind === 'poster') return generatePosterBuffer(originalPath);
  const size = kind === 'thumb' ? THUMB_SIZE : PREVIEW_SIZE;
  // `inside` = long edge, matching Immich `size` (width-only would oversize portraits).
  return sharp(originalPath)
    .rotate()
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

/**
 * Decode only the first video frame, then use the same bounded preview sizing
 * as images. FFmpeg is bundled so builds do not depend on a host executable.
 * @param {string} originalPath
 * @returns {Promise<Buffer>}
 */
export async function generatePosterBuffer(originalPath) {
  const { stdout } = await execFileAsync(ffmpeg.path, [
    '-v', 'error',
    '-i', originalPath,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1',
  ], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' });
  return sharp(stdout)
    .rotate()
    .resize({ width: PREVIEW_SIZE, height: PREVIEW_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}
