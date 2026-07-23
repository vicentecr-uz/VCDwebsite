#!/usr/bin/env node
/**
 * One-shot migration: legacy crop variants -> frame/content rect model.
 *
 *   { aspectRatio, x, y, zoom }  ->  { aspect, cx, cy, w }
 *
 * Legacy `x`/`y`/`zoom` were interpreted against the *rendered frame*, so the
 * same stored numbers meant different slices at different frame sizes. The new
 * fields are anchored to the source image instead:
 *
 *   cx, cy  source point (0..1 of natural dims) that sits at the frame centre
 *   w       fraction of the source WIDTH that the frame spans
 *
 * The conversion is closed form and frame-independent — no rendering needed:
 *
 *   A_src = naturalW / naturalH
 *   A_f   = frame aspect ('original' => A_src)
 *   w     = min(1, A_f / A_src) / zoom
 *   h     = w * A_src / A_f
 *   cx    = 0.5 - (x / 100) * w
 *   cy    = 0.5 - (y / 100) * h
 *
 * Also stamps `srcWidth` / `srcHeight` onto every image node so frames can be
 * sized server-side (needed for `aspect: "original"`, and later for srcset/LQIP).
 *
 * Additive by default: legacy fields are kept so the current renderer keeps
 * working. Pass --drop-legacy once the new renderer has landed and verified.
 *
 *   node scripts/migrate-crop-rects.mjs [--dry] [--drop-legacy]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'src/content/projects');
const PUBLIC_IMAGES = path.join(ROOT, 'public/images');
const DRAFT_MEDIA = path.join(ROOT, 'src/content/drafts/media');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const DROP_LEGACY = args.has('--drop-legacy');

const VIEWPORTS = ['desktop', 'tablet', 'mobile'];
// 6dp: at 4dp the rounding alone shifts a 500px frame by ~0.1px. 6dp keeps the
// error at ~1.6e-3 px — invisible, and the values stay hand-editable.
const round = (n, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** Mirrors projectImage() in src/lib/images.ts, but resolves to a disk path. */
function resolveImagePath(src) {
  if (typeof src !== 'string' || !src) return null;
  // Embeds (YouTube etc.) also carry `src` — not images, nothing to measure.
  if (/^https?:\/\//i.test(src)) return null;
  if (src.startsWith('draft:')) return path.join(DRAFT_MEDIA, src.slice('draft:'.length));
  if (src.startsWith('/')) return path.join(ROOT, 'public', src.replace(/^\//, ''));
  return path.join(PUBLIC_IMAGES, src);
}

const dimsCache = new Map();
async function naturalDims(src) {
  if (dimsCache.has(src)) return dimsCache.get(src);
  const file = resolveImagePath(src);
  let result = null;
  if (file && existsSync(file)) {
    try {
      const { width, height, orientation } = await sharp(file).metadata();
      if (width && height) {
        // sharp reports STORED dimensions; browsers honour the EXIF orientation
        // flag and rotate. Orientations 5-8 are the 90deg cases, where the
        // rendered image is the transpose. Phone photos hit this constantly.
        const rotated = typeof orientation === 'number' && orientation >= 5 && orientation <= 8;
        result = rotated ? { width: height, height: width } : { width, height };
      }
    } catch {
      result = null;
    }
  }
  dimsCache.set(src, result);
  return result;
}

function aspectNumber(aspect, srcAspect) {
  if (!aspect || aspect === 'original') return srcAspect;
  const [w, h] = String(aspect).split(':').map(Number);
  return w > 0 && h > 0 ? w / h : srcAspect;
}

/** Legacy {aspectRatio,x,y,zoom} -> {aspect,cx,cy,w}. Frame-independent. */
function convertVariant(legacy, srcAspect) {
  const aspect = legacy.aspectRatio ?? 'original';
  const x = Number(legacy.x) || 0;
  const y = Number(legacy.y) || 0;
  const zoom = Number(legacy.zoom) || 1;
  const frameAspect = aspectNumber(aspect, srcAspect);

  const w = clamp01(Math.min(1, frameAspect / srcAspect) / zoom);
  const h = clamp01((w * srcAspect) / frameAspect);
  return {
    aspect,
    cx: round(clamp01(0.5 - (x / 100) * w)),
    cy: round(clamp01(0.5 - (y / 100) * h)),
    w: round(w),
  };
}

const isLegacyVariant = (v) => !!v && typeof v === 'object'
  && ('aspectRatio' in v || 'x' in v || 'y' in v || 'zoom' in v);

/**
 * Prove a conversion by rendering both models into the same frame and comparing.
 * Legacy sizes the bitmap to cover the frame then pans by % of frame; the rect
 * model derives size and position from the source-anchored fields. If they agree
 * for every real variant, the migration preserves what is on screen today.
 */
function verifyVariant(legacy, next, srcAspect, frameWidth = 500) {
  const frameAspect = aspectNumber(next.aspect, srcAspect);
  const FW = frameWidth;
  const FH = FW / frameAspect;
  // Natural dims in arbitrary units — only ratios matter here.
  const NW = 1000;
  const NH = NW / srcAspect;

  const zoom = Number(legacy.zoom) || 1;
  const S = Math.max(FW / NW, FH / NH);
  const oldW = NW * S * zoom;
  const oldH = NH * S * zoom;
  const oldLeft = FW * (0.5 + (Number(legacy.x) || 0) / 100) - oldW / 2;
  const oldTop = FH * (0.5 + (Number(legacy.y) || 0) / 100) - oldH / 2;

  const newW = FW / next.w;
  const newH = newW / srcAspect;
  const newLeft = FW / 2 - next.cx * newW;
  const newTop = FH / 2 - next.cy * newH;

  return Math.max(
    Math.abs(oldW - newW),
    Math.abs(oldH - newH),
    Math.abs(oldLeft - newLeft),
    Math.abs(oldTop - newTop),
  );
}

const stats = { files: 0, nodes: 0, variants: 0, dimsAdded: 0, missing: [], worstDelta: 0, worstAt: null };

/** Any object carrying a string `src` is treated as an image node. */
async function migrateNode(node) {
  if (/^https?:\/\//i.test(node.src)) return false;
  const dims = await naturalDims(node.src);
  if (!dims) {
    stats.missing.push(node.src);
    return false;
  }
  let touched = false;

  if (node.srcWidth !== dims.width || node.srcHeight !== dims.height) {
    node.srcWidth = dims.width;
    node.srcHeight = dims.height;
    stats.dimsAdded += 1;
    touched = true;
  }

  const srcAspect = dims.width / dims.height;

  // Legacy single-viewport `crop` was normalised into desktop at render time.
  const legacyCrop = node.crop && typeof node.crop === 'object' ? node.crop : null;

  if (node.variants && typeof node.variants === 'object') {
    for (const viewport of VIEWPORTS) {
      const variant = node.variants[viewport];
      if (!isLegacyVariant(variant)) continue;
      const merged = legacyCrop ? { ...legacyCrop, ...variant } : variant;
      const next = convertVariant(merged, srcAspect);

      const delta = verifyVariant(merged, next, srcAspect);
      if (delta > stats.worstDelta) {
        stats.worstDelta = delta;
        stats.worstAt = `${node.src} [${viewport}] ${merged.aspectRatio} x${merged.x ?? 0} y${merged.y ?? 0} z${merged.zoom ?? 1}`;
      }

      node.variants[viewport] = DROP_LEGACY
        ? next
        : { ...variant, ...next };
      stats.variants += 1;
      touched = true;
    }
  }

  if (DROP_LEGACY) {
    for (const viewport of VIEWPORTS) {
      const v = node.variants?.[viewport];
      if (!v) continue;
      delete v.aspectRatio;
      delete v.x;
      delete v.y;
      delete v.zoom;
    }
    if (node.crop) {
      delete node.crop;
      touched = true;
    }
  }

  if (touched) stats.nodes += 1;
  return touched;
}

async function walk(node) {
  if (Array.isArray(node)) {
    for (const child of node) await walk(child);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.src === 'string' && node.src) await migrateNode(node);
  for (const value of Object.values(node)) await walk(value);
}

const { readdir } = await import('node:fs/promises');
const files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const full = path.join(CONTENT_DIR, file);
  const raw = await readFile(full, 'utf8');
  const data = JSON.parse(raw);
  await walk(data);
  const next = `${JSON.stringify(data, null, 2)}\n`;
  if (next !== raw) {
    stats.files += 1;
    if (!DRY) await writeFile(full, next, 'utf8');
    console.log(`${DRY ? 'would update' : 'updated'}  ${file}`);
  }
}

console.log('\n--- migrate-crop-rects ---');
console.log(`mode          ${DRY ? 'dry run' : 'write'}${DROP_LEGACY ? ' + drop legacy' : ' (additive)'}`);
console.log(`files changed ${stats.files}`);
console.log(`image nodes   ${stats.nodes}`);
console.log(`variants      ${stats.variants}`);
console.log(`dims stamped  ${stats.dimsAdded}`);
console.log(`worst delta   ${stats.worstDelta.toFixed(4)}px in a 500px frame`);
if (stats.worstAt) console.log(`  at          ${stats.worstAt}`);
if (stats.worstDelta > 0.01) {
  console.error('\nFAIL: conversion does not reproduce current geometry.');
  process.exitCode = 1;
}
if (stats.missing.length) {
  const unique = [...new Set(stats.missing)];
  console.log(`\nMISSING FILES (${unique.length}) — left untouched:`);
  unique.forEach((s) => console.log(`  ${s}`));
}
