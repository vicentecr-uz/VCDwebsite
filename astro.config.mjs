// @ts-check
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import {
  buildImageGridSection,
  buildImageSection,
  buildPlaceholderImageSection,
  draftMediaDevServer,
  devViewSwitcher,
  listingOrderDevWriter,
  projectCreateDevWriter,
  projectDeleteDevWriter,
  projectRenameDevWriter,
  projectSettingsDevWriter,
  publishMediaDevWriter,
  insertViewSection,
  deleteViewSection,
  readDevDocument,
  resolveDevFieldTarget,
  resolveEditableDocument,
  uploadDevWriter,
  viewIdFromRequest,
  writeDevDocument,
} from './scripts/dev-api-plugins.mjs';
import { contentHmrGate, suppressContentHmr } from './scripts/content-hmr-gate.mjs';

/** Dev-only: the employer view Alt+V has switched to (written to .dev-session/active-view). */
function resolveDevViewIdFromFile() {
  try {
    return readFileSync(path.join(process.cwd(), '.dev-session/active-view'), 'utf8').trim();
  } catch {
    return '';
  }
}

const GLOBAL_STYLES = 'src/styles/global.css';
const isSafePathPart = (part) => (
  (typeof part === 'string' || typeof part === 'number') &&
  part !== '__proto__' &&
  part !== 'prototype' &&
  part !== 'constructor'
);
const EDITABLE_COLOR_TOKENS = new Set([
  '--color-bg',
  '--color-surface-soft',
  '--color-surface-strong',
  '--color-text',
  '--color-text-soft',
  '--color-text-muted',
  '--color-border',
]);
const IMAGE_VIEWPORTS = new Set(['desktop', 'tablet', 'mobile']);
/** Presets plus freeform `W:H` from the crop-frame handles. */
const isAllowedAspectRatio = (value) => {
  if (value === 'original') return true;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(value));
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
};

const clampRound = (value, min, max, decimals) => {
  const bounded = Math.min(max, Math.max(min, value));
  const factor = 10 ** decimals;
  return Math.round(bounded * factor) / factor;
};

/**
 * Dev-only writer for project image crops. `apply: 'serve'` means this plugin
 * is active only under `astro dev` — it is never part of the static production
 * build, so nothing is emitted to `dist/` and the live site has no such route.
 * The crop tuner POSTs a document key, a JSON path to the image node, and a
 * set of viewport crops; we persist `variants` onto that node so committing
 * the project file publishes the crop.
 *
 * @returns {import('vite').Plugin}
 */
function imageCropDevWriter() {
  return {
    name: 'image-crop-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/image-crop', async (req, res, next) => {
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

          const documentKey = String(body.document || '');
          const viewId = viewIdFromRequest(req, body);
          const fieldPath = body.path;
          if (
            !resolveEditableDocument(documentKey) ||
            !Array.isArray(fieldPath) ||
            !fieldPath.length ||
            fieldPath.length > 8 ||
            !fieldPath.every(isSafePathPart)
          ) {
            send(400, { error: 'That image is not editable.' });
            return;
          }

          let targetInfo;
          try {
            targetInfo = resolveDevFieldTarget(documentKey, viewId, fieldPath);
          } catch (error) {
            send(400, { error: error instanceof Error ? error.message : 'That image is not editable.' });
            return;
          }

          const data = await readDevDocument(targetInfo.relativeFile, {
            ensureOverlay: targetInfo.ensureOverlay,
          });

          let target = data;
          for (const part of targetInfo.path) {
            if (
              target === null ||
              typeof target !== 'object' ||
              !Object.prototype.hasOwnProperty.call(target, part)
            ) {
              send(404, { error: 'That image path no longer exists.' });
              return;
            }
            target = target[part];
          }
          if (target === null || typeof target !== 'object' || Array.isArray(target)) {
            send(404, { error: 'That image path does not point to an image.' });
            return;
          }

          if (body.clearVariants === true) {
            delete target.variants;
            delete target.crop;
            await writeDevDocument(targetInfo.relativeFile, data);
            send(200, { ok: true, document: documentKey, cleared: true });
            return;
          }

          const requestedVariants = body.variants && typeof body.variants === 'object'
            ? body.variants
            : {};
          /** @type {Record<string, { aspectRatio: string, x: number, y: number, zoom: number }>} */
          const variants = {};
          for (const [viewport, requested] of Object.entries(requestedVariants)) {
            const x = Number(requested?.x);
            const y = Number(requested?.y);
            const zoom = Number(requested?.zoom);
            const aspectRatio = String(requested?.aspectRatio || '');
            if (
              !IMAGE_VIEWPORTS.has(viewport) ||
              !isAllowedAspectRatio(aspectRatio) ||
              ![x, y, zoom].every(Number.isFinite)
            ) {
              send(400, { error: 'Use supported viewports, aspect ratios and crop values.' });
              return;
            }
            variants[viewport] = {
              aspectRatio,
              x: clampRound(x, -100, 100, 1),
              y: clampRound(y, -100, 100, 1),
              zoom: clampRound(zoom, 1, 1.5, 2),
            };
          }
          if (!Object.keys(variants).length) {
            send(400, { error: 'No crop data was provided.' });
            return;
          }

          target.variants ||= {};
          Object.assign(target.variants, variants);
          delete target.crop;
          await writeDevDocument(targetInfo.relativeFile, data);
          send(200, { ok: true, document: documentKey, variants });
        } catch {
          send(400, { error: 'Could not parse or write the crop.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for image-grid settings (per-breakpoint columns,
 * constrained width, default aspect, and visible/parking layouts with
 * waterfall inheritance).
 *
 * @returns {import('vite').Plugin}
 */
function imageGridDevWriter() {
  return {
    name: 'image-grid-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/image-grid', async (req, res, next) => {
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

          const viewId = viewIdFromRequest(req, body);
          const documentKey = String(body.document || '');
          const fieldPath = body.path;
          const target = resolveDevFieldTarget(documentKey, viewId, fieldPath);
          if (
            !target?.relativeFile ||
            !Array.isArray(target.path) ||
            !target.path.length ||
            target.path.length > 8 ||
            !target.path.every(isSafePathPart)
          ) {
            send(400, { error: 'That grid is not editable.' });
            return;
          }

          const requestedColumns = body.columns && typeof body.columns === 'object'
            ? body.columns
            : {};
          /** @type {Record<string, number>} */
          const columns = {};
          for (const viewport of IMAGE_VIEWPORTS) {
            const count = Number(requestedColumns[viewport]);
            if (!Number.isFinite(count) || count < 1 || count > 6) {
              send(400, { error: 'Use 1–6 columns for each display width.' });
              return;
            }
            columns[viewport] = Math.round(count);
          }

          const requestedConstrained = body.constrained && typeof body.constrained === 'object'
            ? body.constrained
            : {};
          /** @type {Record<string, number>} */
          const constrained = {};
          for (const viewport of IMAGE_VIEWPORTS) {
            const raw = requestedConstrained[viewport];
            if (raw === true) {
              constrained[viewport] = 80;
              continue;
            }
            if (raw === false || raw === null || raw === undefined) {
              constrained[viewport] = 100;
              continue;
            }
            const n = Math.round(Number(raw));
            if (!Number.isFinite(n) || n >= 100) {
              constrained[viewport] = 100;
              continue;
            }
            const stepped = Math.round(n / 10) * 10;
            if (stepped < 30 || stepped > 90) {
              send(400, { error: 'Use a constrain width of 30–90% (or None).' });
              return;
            }
            constrained[viewport] = stepped;
          }

          const defaultAspectRatio = String(body.defaultAspectRatio || '');
          if (!isAllowedAspectRatio(defaultAspectRatio)) {
            send(400, { error: 'Use a supported default aspect ratio.' });
            return;
          }

          const data = await readDevDocument(target.relativeFile);

          let node = data;
          for (const part of target.path) {
            if (
              node === null ||
              typeof node !== 'object' ||
              !Object.prototype.hasOwnProperty.call(node, part)
            ) {
              send(404, { error: 'That grid path no longer exists.' });
              return;
            }
            node = node[part];
          }
          if (node === null || typeof node !== 'object' || Array.isArray(node)) {
            send(404, { error: 'That path does not point to a grid.' });
            return;
          }

          const itemIds = Array.isArray(node.items)
            ? node.items.map((item, index) => String(item?.id || `item-${index}`))
            : [];
          const knownIds = new Set(itemIds);
          /** @type {Record<string, { visible: string[] }>} */
          const layouts = {};
          const requestedLayouts = body.layouts && typeof body.layouts === 'object'
            ? body.layouts
            : {};
          for (const viewport of IMAGE_VIEWPORTS) {
            const visible = requestedLayouts[viewport]?.visible;
            if (!Array.isArray(visible)) continue;
            const seen = new Set();
            const cleaned = [];
            for (const rawId of visible) {
              const id = String(rawId || '');
              if (!knownIds.has(id) || seen.has(id)) continue;
              seen.add(id);
              cleaned.push(id);
            }
            layouts[viewport] = { visible: cleaned };
          }

          node.columns = columns;
          node.constrained = constrained;
          node.defaultAspectRatio = defaultAspectRatio;
          if (Object.keys(layouts).length) {
            node.layouts = layouts;
          } else {
            delete node.layouts;
          }
          // Prefer layouts over legacy per-item hide flags.
          if (Array.isArray(node.items)) {
            for (const item of node.items) {
              if (item && typeof item === 'object') delete item.hideOnMobile;
            }
          }
          await writeDevDocument(target.relativeFile, data);
          send(200, {
            ok: true,
            document: documentKey,
            columns,
            constrained,
            defaultAspectRatio,
            layouts,
          });
        } catch {
          send(400, { error: 'Could not parse or write the grid settings.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for literal colour tokens in global.css.
 *
 * @returns {import('vite').Plugin}
 */
function styleTokenDevWriter() {
  return {
    name: 'style-token-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/style-token', async (req, res, next) => {
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
          const token = String(body.token || '');
          const rawValue = String(body.value || '').trim();

          if (!EDITABLE_COLOR_TOKENS.has(token)) {
            send(400, { error: 'That colour token is not editable.' });
            return;
          }

          const shortHex = /^#([0-9a-f]{3})$/i.exec(rawValue);
          const longHex = /^#([0-9a-f]{6})$/i.exec(rawValue);
          if (!shortHex && !longHex) {
            send(400, { error: 'Use a 3- or 6-digit hex colour.' });
            return;
          }

          const value = shortHex
            ? `#${[...shortHex[1]].map((digit) => digit.repeat(2)).join('')}`.toLowerCase()
            : rawValue.toLowerCase();
          const file = path.join(process.cwd(), GLOBAL_STYLES);
          const source = await readFile(file, 'utf8');
          const declaration = new RegExp(`(^\\s*${token}:\\s*)(#[0-9a-fA-F]{3,6})(\\s*;)`, 'm');

          if (!declaration.test(source)) {
            send(500, { error: `Could not find ${token} in global.css.` });
            return;
          }

          await writeFile(file, source.replace(declaration, `$1${value}$3`), 'utf8');
          send(200, { ok: true, token, value });
        } catch {
          send(400, { error: 'Could not parse or write the colour token.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for text fields explicitly exposed by page components.
 *
 * @returns {import('vite').Plugin}
 */
function contentTextDevWriter() {
  return {
    name: 'content-text-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-text', async (req, res, next) => {
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
            if (size > 100_000) {
              send(413, { error: 'The text update is too large.' });
              return;
            }
            chunks.push(chunk);
          }

          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const viewId = viewIdFromRequest(req, body);
          const changes = Array.isArray(body.changes) ? body.changes : [];
          if (!changes.length) {
            send(400, { error: 'No text changes were provided.' });
            return;
          }

          const grouped = new Map();
          for (const change of changes) {
            const documentKey = String(change.document || '');
            const fieldPath = change.path;
            const value = change.value;
            const valueIsText = typeof value === 'string' && value.length <= 20_000;
            const valueIsParagraphs = (
              Array.isArray(value) &&
              value.every((paragraph) => typeof paragraph === 'string') &&
              value.join('').length <= 20_000
            );
            const target = resolveDevFieldTarget(documentKey, viewId, fieldPath);
            if (
              !target?.relativeFile ||
              !Array.isArray(target.path) ||
              !target.path.length ||
              target.path.length > 8 ||
              (!valueIsText && !valueIsParagraphs) ||
              target.path.some((part) => (
                (typeof part !== 'string' && typeof part !== 'number') ||
                part === '__proto__' ||
                part === 'prototype' ||
                part === 'constructor'
              ))
            ) {
              send(400, { error: 'One or more text fields are not editable.' });
              return;
            }
            const documentChanges = grouped.get(target.relativeFile) || [];
            documentChanges.push({ path: target.path, value });
            grouped.set(target.relativeFile, documentChanges);
          }

          for (const [relativeFile, documentChanges] of grouped) {
            const data = await readDevDocument(relativeFile);

            for (const change of documentChanges) {
              let target = data;
              for (const part of change.path.slice(0, -1)) {
                if (
                  target === null ||
                  typeof target !== 'object' ||
                  !Object.prototype.hasOwnProperty.call(target, part)
                ) {
                  send(400, { error: 'An editable text path no longer exists.' });
                  return;
                }
                target = target[part];
              }

              const field = change.path.at(-1);
              const currentValue = target?.[field];
              if (
                target === null ||
                typeof target !== 'object' ||
                !Object.prototype.hasOwnProperty.call(target, field) ||
                (
                  typeof currentValue !== 'string' &&
                  !(Array.isArray(currentValue) && currentValue.every((item) => typeof item === 'string'))
                ) ||
                (typeof currentValue === 'string') !== (typeof change.value === 'string')
              ) {
                send(400, { error: 'An editable text field no longer exists.' });
                return;
              }
              target[field] = change.value;
            }

            await writeDevDocument(relativeFile, data);
          }

          send(200, { ok: true, count: changes.length });
        } catch {
          send(400, { error: 'Could not parse or write the text changes.' });
        }
      });
    },
  };
}

const EDITABLE_SPACING_VALUES = new Set(['related', 'group', 'section', 'major', 'none']);

/**
 * Resolve a JSON path against a document root. Returns null when missing.
 * @param {unknown} data
 * @param {Array<string | number>} fieldPath
 */
const resolvePathTarget = (data, fieldPath) => {
  let target = data;
  for (const part of fieldPath) {
    if (
      target === null ||
      typeof target !== 'object' ||
      !Object.prototype.hasOwnProperty.call(target, part)
    ) {
      return null;
    }
    target = target[part];
  }
  return target;
};

/**
 * Apply one image-crop mutation onto an in-memory document node.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
const applyCropChange = (data, change) => {
  const fieldPath = change.path;
  if (!Array.isArray(fieldPath) || !fieldPath.length || fieldPath.length > 8 || !fieldPath.every(isSafePathPart)) {
    return { ok: false, error: 'That image is not editable.' };
  }
  const target = resolvePathTarget(data, fieldPath);
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, error: 'That image path no longer exists.' };
  }

  if (change.clearVariants === true) {
    delete target.variants;
    delete target.crop;
    return { ok: true };
  }

  const requestedVariants = change.variants && typeof change.variants === 'object'
    ? change.variants
    : {};
  /** @type {Record<string, { aspectRatio: string, x: number, y: number, zoom: number }>} */
  const variants = {};
  for (const [viewport, requested] of Object.entries(requestedVariants)) {
    const x = Number(requested?.x);
    const y = Number(requested?.y);
    const zoom = Number(requested?.zoom);
    const aspectRatio = String(requested?.aspectRatio || '');
    if (
      !IMAGE_VIEWPORTS.has(viewport) ||
      !isAllowedAspectRatio(aspectRatio) ||
      ![x, y, zoom].every(Number.isFinite)
    ) {
      return { ok: false, error: 'Use supported viewports, aspect ratios and crop values.' };
    }
    variants[viewport] = {
      aspectRatio,
      x: clampRound(x, -100, 100, 1),
      y: clampRound(y, -100, 100, 1),
      zoom: clampRound(zoom, 1, 1.5, 2),
    };
  }
  if (!Object.keys(variants).length) {
    return { ok: false, error: 'No crop data was provided.' };
  }

  target.variants ||= {};
  Object.assign(target.variants, variants);
  delete target.crop;
  return { ok: true };
};

/**
 * Apply one image-grid mutation onto an in-memory document node.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
const applyGridChange = (data, change) => {
  const fieldPath = change.path;
  if (!Array.isArray(fieldPath) || !fieldPath.length || fieldPath.length > 8 || !fieldPath.every(isSafePathPart)) {
    return { ok: false, error: 'That grid is not editable.' };
  }
  const target = resolvePathTarget(data, fieldPath);
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, error: 'That grid path no longer exists.' };
  }

  const requestedColumns = change.columns && typeof change.columns === 'object'
    ? change.columns
    : {};
  /** @type {Record<string, number>} */
  const columns = {};
  for (const viewport of IMAGE_VIEWPORTS) {
    const count = Number(requestedColumns[viewport]);
    if (!Number.isFinite(count) || count < 1 || count > 6) {
      return { ok: false, error: 'Use 1–6 columns for each display width.' };
    }
    columns[viewport] = Math.round(count);
  }

  const requestedConstrained = change.constrained && typeof change.constrained === 'object'
    ? change.constrained
    : {};
  /** @type {Record<string, number>} */
  const constrained = {};
  for (const viewport of IMAGE_VIEWPORTS) {
    const raw = requestedConstrained[viewport];
    if (raw === true) {
      constrained[viewport] = 80;
      continue;
    }
    if (raw === false || raw === null || raw === undefined) {
      constrained[viewport] = 100;
      continue;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n >= 100) {
      constrained[viewport] = 100;
      continue;
    }
    const stepped = Math.round(n / 10) * 10;
    if (stepped < 30 || stepped > 90) {
      return { ok: false, error: 'Use a constrain width of 30–90% (or None).' };
    }
    constrained[viewport] = stepped;
  }

  const defaultAspectRatio = String(change.defaultAspectRatio || '');
  if (!isAllowedAspectRatio(defaultAspectRatio)) {
    return { ok: false, error: 'Use a supported default aspect ratio.' };
  }

  const itemIds = Array.isArray(target.items)
    ? target.items.map((item, index) => String(item?.id || `item-${index}`))
    : [];
  const knownIds = new Set(itemIds);
  /** @type {Record<string, { visible: string[] }>} */
  const layouts = {};
  const requestedLayouts = change.layouts && typeof change.layouts === 'object'
    ? change.layouts
    : {};
  for (const viewport of IMAGE_VIEWPORTS) {
    const visible = requestedLayouts[viewport]?.visible;
    if (!Array.isArray(visible)) continue;
    const seen = new Set();
    const cleaned = [];
    for (const rawId of visible) {
      const id = String(rawId || '');
      if (!knownIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      cleaned.push(id);
    }
    layouts[viewport] = { visible: cleaned };
  }

  target.columns = columns;
  target.constrained = constrained;
  target.defaultAspectRatio = defaultAspectRatio;
  if (Object.keys(layouts).length) {
    target.layouts = layouts;
  } else {
    delete target.layouts;
  }
  if (Array.isArray(target.items)) {
    for (const item of target.items) {
      if (item && typeof item === 'object') delete item.hideOnMobile;
    }
  }
  return { ok: true };
};

/**
 * Apply one image-caption mutation onto an in-memory document node.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
const applyCaptionChange = (data, change) => {
  const fieldPath = change.path;
  if (!Array.isArray(fieldPath) || !fieldPath.length || fieldPath.length > 8 || !fieldPath.every(isSafePathPart)) {
    return { ok: false, error: 'That image is not editable.' };
  }
  const target = resolvePathTarget(data, fieldPath);
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, error: 'That image path no longer exists.' };
  }

  if (change.clear === true) {
    delete target.caption;
    delete target.captions;
    delete target.captionStyle;
    delete target.captionPosition;
    delete target.captionReveal;
    return { ok: true };
  }

  const CAPTION_STYLES = new Set(['white', 'black', 'default']);
  const CAPTION_POSITIONS = new Set(['bottom-left', 'top-left', 'bottom-right', 'top-right']);
  const CAPTION_REVEALS = new Set(['hover', 'always']);
  const rawStyle = String(change.captionStyle || 'white');
  const captionStyle = rawStyle === 'default' ? 'white' : rawStyle;
  if (!CAPTION_STYLES.has(captionStyle)) {
    return { ok: false, error: 'Use a supported caption style.' };
  }
  const captionPosition = String(change.captionPosition || 'bottom-left');
  if (!CAPTION_POSITIONS.has(captionPosition)) {
    return { ok: false, error: 'Use a supported caption location.' };
  }

  const requested = change.captions && typeof change.captions === 'object'
    ? change.captions
    : {};
  /** @type {Record<string, string>} */
  const captions = {};
  for (const viewport of IMAGE_VIEWPORTS) {
    const text = String(requested[viewport] ?? '');
    if (text.length > 500) {
      return { ok: false, error: 'Caption text is too long.' };
    }
    captions[viewport] = text.replaceAll('\u00a0', ' ');
  }
  if (![...IMAGE_VIEWPORTS].some((viewport) => captions[viewport].trim())) {
    delete target.caption;
    delete target.captions;
    delete target.captionStyle;
    delete target.captionPosition;
    delete target.captionReveal;
    return { ok: true };
  }

  const requestedReveal = change.captionReveal;
  /** @type {Record<string, string>} */
  const captionReveal = {};
  if (typeof requestedReveal === 'string' && CAPTION_REVEALS.has(requestedReveal)) {
    for (const viewport of IMAGE_VIEWPORTS) {
      captionReveal[viewport] = requestedReveal;
    }
  } else if (requestedReveal && typeof requestedReveal === 'object') {
    let previous = 'hover';
    for (const viewport of IMAGE_VIEWPORTS) {
      const value = String(requestedReveal[viewport] || previous);
      if (!CAPTION_REVEALS.has(value)) {
        return { ok: false, error: 'Use hover or always for caption reveal.' };
      }
      captionReveal[viewport] = value;
      previous = value;
    }
  } else {
    captionReveal.desktop = 'hover';
    captionReveal.tablet = 'always';
    captionReveal.mobile = 'always';
  }

  target.captions = captions;
  // Keep legacy single caption in sync with desktop for older readers.
  target.caption = captions.desktop;
  target.captionReveal = captionReveal;
  if (captionStyle === 'white') {
    delete target.captionStyle;
  } else {
    target.captionStyle = captionStyle;
  }
  if (captionPosition === 'bottom-left') {
    delete target.captionPosition;
  } else {
    target.captionPosition = captionPosition;
  }
  return { ok: true };
};

/**
 * Dev-only batch writer so staged image/grid/text/spacing edits hit disk in one
 * write per document (avoids mid-save HMR wiping later changes).
 *
 * @returns {import('vite').Plugin}
 */
function contentBatchDevWriter() {
  return {
    name: 'content-batch-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-batch', async (req, res, next) => {
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
            if (size > 500_000) {
              send(413, { error: 'The batch update is too large.' });
              return;
            }
            chunks.push(chunk);
          }

          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const viewId = viewIdFromRequest(req, body);
          const crops = Array.isArray(body.crops) ? body.crops : [];
          const grids = Array.isArray(body.grids) ? body.grids : [];
          const captions = Array.isArray(body.captions) ? body.captions : [];
          const textChanges = Array.isArray(body.text) ? body.text : [];
          const spacingChanges = Array.isArray(body.spacing) ? body.spacing : [];
          if (
            !crops.length &&
            !grids.length &&
            !captions.length &&
            !textChanges.length &&
            !spacingChanges.length
          ) {
            send(400, { error: 'No changes were provided.' });
            return;
          }

          /** @type {Map<string, { crops: any[], grids: any[], captions: any[], text: any[], spacing: any[] }>} */
          const grouped = new Map();
          const resolveBatchChange = (documentKey, fieldPath) => {
            const target = resolveDevFieldTarget(documentKey, viewId, fieldPath);
            if (!target?.relativeFile) return null;
            let group = grouped.get(target.relativeFile);
            if (!group) {
              group = { crops: [], grids: [], captions: [], text: [], spacing: [] };
              grouped.set(target.relativeFile, group);
            }
            return { group, path: target.path };
          };

          for (const change of crops) {
            const documentKey = String(change?.document || '');
            const resolved = resolveBatchChange(documentKey, change?.path);
            if (!resolved) {
              send(400, { error: 'That image is not editable.' });
              return;
            }
            resolved.group.crops.push({ ...change, path: resolved.path });
          }
          for (const change of grids) {
            const documentKey = String(change?.document || '');
            const resolved = resolveBatchChange(documentKey, change?.path);
            if (!resolved) {
              send(400, { error: 'That grid is not editable.' });
              return;
            }
            resolved.group.grids.push({ ...change, path: resolved.path });
          }
          for (const change of captions) {
            const documentKey = String(change?.document || '');
            const resolved = resolveBatchChange(documentKey, change?.path);
            if (!resolved) {
              send(400, { error: 'That image is not editable.' });
              return;
            }
            resolved.group.captions.push({ ...change, path: resolved.path });
          }
          for (const change of textChanges) {
            const documentKey = String(change?.document || '');
            const fieldPath = change?.path;
            const value = change?.value;
            const valueIsText = typeof value === 'string' && value.length <= 20_000;
            const valueIsParagraphs = (
              Array.isArray(value) &&
              value.every((paragraph) => typeof paragraph === 'string') &&
              value.join('').length <= 20_000
            );
            const resolved = resolveBatchChange(documentKey, fieldPath);
            if (
              !resolved ||
              !Array.isArray(resolved.path) ||
              !resolved.path.length ||
              resolved.path.length > 8 ||
              (!valueIsText && !valueIsParagraphs) ||
              resolved.path.some((part) => !isSafePathPart(part))
            ) {
              send(400, { error: 'One or more text fields are not editable.' });
              return;
            }
            resolved.group.text.push({ ...change, path: resolved.path });
          }
          for (const change of spacingChanges) {
            const documentKey = String(change?.document || '');
            const fieldPath = change?.path;
            const value = change?.value;
            const resolved = resolveBatchChange(documentKey, fieldPath);
            if (
              !resolved ||
              !Array.isArray(resolved.path) ||
              resolved.path.length < 2 ||
              resolved.path.length > 8 ||
              resolved.path.at(-1) !== 'spacing' ||
              !EDITABLE_SPACING_VALUES.has(value) ||
              resolved.path.some((part) => !isSafePathPart(part))
            ) {
              send(400, { error: 'One or more spacing fields are not editable.' });
              return;
            }
            resolved.group.spacing.push({ ...change, path: resolved.path });
          }

          for (const [relativeFile, group] of grouped) {
            const data = await readDevDocument(relativeFile);

            for (const change of group.crops) {
              const result = applyCropChange(data, change);
              if (!result.ok) {
                send(400, { error: result.error });
                return;
              }
            }
            for (const change of group.grids) {
              const result = applyGridChange(data, change);
              if (!result.ok) {
                send(400, { error: result.error });
                return;
              }
            }
            for (const change of group.captions) {
              const result = applyCaptionChange(data, change);
              if (!result.ok) {
                send(400, { error: result.error });
                return;
              }
            }
            for (const change of group.text) {
              let target = data;
              for (const part of change.path.slice(0, -1)) {
                if (
                  target === null ||
                  typeof target !== 'object' ||
                  !Object.prototype.hasOwnProperty.call(target, part)
                ) {
                  send(400, { error: 'An editable text path no longer exists.' });
                  return;
                }
                target = target[part];
              }
              const field = change.path.at(-1);
              const currentValue = target?.[field];
              if (
                target === null ||
                typeof target !== 'object' ||
                !Object.prototype.hasOwnProperty.call(target, field) ||
                (
                  typeof currentValue !== 'string' &&
                  !(Array.isArray(currentValue) && currentValue.every((item) => typeof item === 'string'))
                ) ||
                (typeof currentValue === 'string') !== (typeof change.value === 'string')
              ) {
                send(400, { error: 'An editable text field no longer exists.' });
                return;
              }
              target[field] = change.value;
            }
            for (const change of group.spacing) {
              let target = data;
              for (const part of change.path.slice(0, -1)) {
                if (
                  target === null ||
                  typeof target !== 'object' ||
                  !Object.prototype.hasOwnProperty.call(target, part)
                ) {
                  send(400, { error: 'A spacing path no longer exists.' });
                  return;
                }
                target = target[part];
              }
              if (target === null || typeof target !== 'object' || Array.isArray(target)) {
                send(400, { error: 'A spacing path no longer exists.' });
                return;
              }
              target.spacing = change.value;
            }

            await writeDevDocument(relativeFile, data);
          }

          send(200, {
            ok: true,
            crops: crops.length,
            grids: grids.length,
            captions: captions.length,
            text: textChanges.length,
            spacing: spacingChanges.length,
          });
        } catch {
          send(400, { error: 'Could not parse or write the batch changes.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for project section spacing tokens. Same document allowlist
 * as text edits; creates `spacing` on the section node when missing.
 *
 * @returns {import('vite').Plugin}
 */
const INSERTABLE_SECTION_TYPES = new Set(['bodyText', 'sectionTitle', 'image', 'imageGrid', 'placeholder']);

const outlineAnchorId = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  const anchor = typeof entry.anchor === 'string' ? entry.anchor.trim() : '';
  if (anchor) return anchor;
  return typeof entry.id === 'string' ? entry.id : '';
};

/** Keep project outline in sync with sectionTitle insert/delete in one write. */
const syncOutlineForSectionMutation = (data, { action, section }) => {
  if (!data || typeof data !== 'object') return;
  if (!Array.isArray(data.outline)) data.outline = [];

  if (action === 'insert' && section?.type === 'sectionTitle') {
    const anchor = String(section.sectionId || section.id || '').trim();
    if (!anchor) return;
    section.sectionId = section.sectionId || anchor;
    const label = String(section.title || 'Section title').trim() || 'Section title';
    data.outline = data.outline.filter(
      (entry) => outlineAnchorId(entry) !== anchor && entry?.id !== anchor,
    );
    data.outline.push({
      kind: 'section',
      id: anchor,
      label,
      anchor,
    });
    return;
  }

  if (action === 'delete' && section) {
    const anchors = new Set(
      [String(section.sectionId || ''), String(section.id || '')]
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (!anchors.size) return;
    data.outline = data.outline.filter(
      (entry) => !anchors.has(outlineAnchorId(entry)) && !anchors.has(String(entry?.id || '')),
    );
  }
};

const writeContentJson = async (file, data) => {
  suppressContentHmr();
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

/**
 * Dev-only writer that inserts or deletes sections in a project document's
 * `sections` array (used by the on-page “+” / delete controls).
 *
 * @returns {import('vite').Plugin}
 */
function contentSectionDevWriter() {
  return {
    name: 'content-section-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-section', async (req, res, next) => {
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
            if (size > 10_000) {
              send(413, { error: 'The section update is too large.' });
              return;
            }
            chunks.push(chunk);
          }

          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const documentKey = String(body.document || '');
          const viewId = viewIdFromRequest(req, body);
          const relativeFile = resolveEditableDocument(documentKey);
          const action = body.action === 'delete' ? 'delete' : 'insert';
          const index = Number(body.index);

          if (!relativeFile || !Number.isInteger(index) || index < 0) {
            send(400, { error: 'That section cannot be updated.' });
            return;
          }

          if (viewId) {
            if (action === 'delete') {
              const result = await deleteViewSection(documentKey, viewId, index);
              send(200, { ok: true, action: 'delete', index, ...result });
              return;
            }

            const type = String(body.type || '');
            const filenames = Array.isArray(body.filenames)
              ? body.filenames.map((value) => String(value || '').trim()).filter(Boolean)
              : [];
            if (!INSERTABLE_SECTION_TYPES.has(type)) {
              send(400, { error: 'That section cannot be inserted.' });
              return;
            }

            let section;
            if (type === 'sectionTitle') {
              const id = `title-${Date.now().toString(36)}`;
              section = {
                type: 'sectionTitle',
                id,
                sectionId: id,
                title: 'Section title',
                spacing: 'section',
                tightBottom: false,
              };
            } else if (type === 'bodyText') {
              section = {
                type: 'bodyText',
                id: `body-${Date.now().toString(36)}`,
                spacing: 'section',
                paragraphs: [''],
              };
            } else if (type === 'image') {
              if (!filenames.length) {
                send(400, { error: 'An image file is required.' });
                return;
              }
              section = buildImageSection(documentKey, filenames.slice(0, 1));
            } else if (type === 'imageGrid') {
              if (!filenames.length) {
                send(400, { error: 'At least one image file is required.' });
                return;
              }
              section = buildImageGridSection(documentKey, filenames);
            } else if (type === 'placeholder') {
              section = buildPlaceholderImageSection();
            }

            if (!section) {
              send(400, { error: 'That section cannot be inserted.' });
              return;
            }

            await insertViewSection(documentKey, viewId, index, section);
            send(200, { ok: true, action: 'insert', index, id: section.id, type: section.type, section });
            return;
          }

          const file = path.join(process.cwd(), relativeFile);
          const data = JSON.parse(await readFile(file, 'utf8'));
          if (!Array.isArray(data.sections)) {
            send(400, { error: 'The sections list is out of date. Refresh and try again.' });
            return;
          }

          if (action === 'delete') {
            if (index >= data.sections.length) {
              send(400, { error: 'The sections list is out of date. Refresh and try again.' });
              return;
            }
            const existing = data.sections[index];
            const existingType =
              existing && typeof existing === 'object' && !Array.isArray(existing)
                ? String(existing.type || '')
                : '';
            if (!INSERTABLE_SECTION_TYPES.has(existingType)) {
              send(400, { error: 'That section type cannot be deleted here.' });
              return;
            }
            syncOutlineForSectionMutation(data, { action: 'delete', section: existing });
            data.sections.splice(index, 1);
            await writeContentJson(file, data);
            send(200, { ok: true, action: 'delete', index, type: existingType, section: existing });
            return;
          }

          const type = String(body.type || '');
          const filenames = Array.isArray(body.filenames)
            ? body.filenames.map((value) => String(value || '').trim()).filter(Boolean)
            : [];

          if (!INSERTABLE_SECTION_TYPES.has(type) || index > data.sections.length) {
            send(400, { error: 'That section cannot be inserted.' });
            return;
          }

          let section;
          if (type === 'sectionTitle') {
            const id = `title-${Date.now().toString(36)}`;
            section = {
              type: 'sectionTitle',
              id,
              sectionId: id,
              title: 'Section title',
              spacing: 'section',
              tightBottom: false,
            };
          } else if (type === 'bodyText') {
            const id = `body-${Date.now().toString(36)}`;
            section = {
              type: 'bodyText',
              id,
              spacing: 'section',
              paragraphs: [''],
            };
          } else if (type === 'image') {
            if (!filenames.length) {
              send(400, { error: 'An image file is required.' });
              return;
            }
            section = buildImageSection(documentKey, filenames.slice(0, 1));
          } else if (type === 'imageGrid') {
            if (!filenames.length) {
              send(400, { error: 'At least one image file is required.' });
              return;
            }
            section = buildImageGridSection(documentKey, filenames);
          } else if (type === 'placeholder') {
            section = buildPlaceholderImageSection();
          }

          if (!section) {
            send(400, { error: 'That section cannot be inserted.' });
            return;
          }

          data.sections.splice(index, 0, section);
          syncOutlineForSectionMutation(data, { action: 'insert', section });

          await writeContentJson(file, data);
          send(200, { ok: true, action: 'insert', index, id: section.id, type: section.type, section });
        } catch {
          send(400, { error: 'Could not parse or write the section update.' });
        }
      });
    },
  };
}

function contentSpacingDevWriter() {
  return {
    name: 'content-spacing-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-spacing', async (req, res, next) => {
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
            if (size > 20_000) {
              send(413, { error: 'The spacing update is too large.' });
              return;
            }
            chunks.push(chunk);
          }

          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const viewId = viewIdFromRequest(req, body);
          const changes = Array.isArray(body.changes) ? body.changes : [];
          if (!changes.length) {
            send(400, { error: 'No spacing changes were provided.' });
            return;
          }

          const grouped = new Map();
          for (const change of changes) {
            const documentKey = String(change.document || '');
            const fieldPath = change.path;
            const value = change.value;
            const target = resolveDevFieldTarget(documentKey, viewId, fieldPath);
            if (
              !target?.relativeFile ||
              !Array.isArray(target.path) ||
              target.path.length < 2 ||
              target.path.length > 8 ||
              target.path.at(-1) !== 'spacing' ||
              !EDITABLE_SPACING_VALUES.has(value) ||
              target.path.some((part) => !isSafePathPart(part))
            ) {
              send(400, { error: 'One or more spacing fields are not editable.' });
              return;
            }
            const documentChanges = grouped.get(target.relativeFile) || [];
            documentChanges.push({ path: target.path, value });
            grouped.set(target.relativeFile, documentChanges);
          }

          for (const [relativeFile, documentChanges] of grouped) {
            const data = await readDevDocument(relativeFile);

            for (const change of documentChanges) {
              let target = data;
              for (const part of change.path.slice(0, -1)) {
                if (
                  target === null ||
                  typeof target !== 'object' ||
                  !Object.prototype.hasOwnProperty.call(target, part)
                ) {
                  send(400, { error: 'A spacing path no longer exists.' });
                  return;
                }
                target = target[part];
              }

              const field = change.path.at(-1);
              if (target === null || typeof target !== 'object' || Array.isArray(target)) {
                send(400, { error: 'A spacing path no longer exists.' });
                return;
              }
              target[field] = change.value;
              if (Object.prototype.hasOwnProperty.call(target, 'tightTop')) {
                delete target.tightTop;
              }
            }

            await writeDevDocument(relativeFile, data);
          }

          send(200, { ok: true, count: changes.length });
        } catch {
          send(400, { error: 'Could not parse or write the spacing changes.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for project section nav trees + sectionId / showTitle patches.
 *
 * @returns {import('vite').Plugin}
 */
function contentNavDevWriter() {
  const slugify = (label) => {
    const base = String(label)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || `section-${Date.now().toString(36)}`;
  };

  const isValidNavLink = (item) => (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    item.id.length <= 80 &&
    typeof item.label === 'string' &&
    item.label.length > 0 &&
    item.label.length <= 120
  );

  const isValidNavGroup = (item) => (
    item &&
    typeof item === 'object' &&
    typeof item.label === 'string' &&
    item.label.length > 0 &&
    item.label.length <= 120 &&
    Array.isArray(item.children) &&
    item.children.length <= 40 &&
    item.children.every(isValidNavLink) &&
    (item.defaultOpen === undefined || typeof item.defaultOpen === 'boolean')
  );

  const isValidNav = (nav) => (
    Array.isArray(nav) &&
    nav.length <= 60 &&
    nav.every((item) => isValidNavLink(item) || isValidNavGroup(item))
  );

  const isValidOutlineEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const base = (
      typeof entry.id === 'string' &&
      entry.id.length > 0 &&
      entry.id.length <= 80 &&
      typeof entry.label === 'string' &&
      entry.label.length > 0 &&
      entry.label.length <= 120 &&
      (entry.anchor === undefined || (
        typeof entry.anchor === 'string' &&
        entry.anchor.length > 0 &&
        entry.anchor.length <= 80
      ))
    );
    if (!base) return false;
    if (entry.kind === 'group') {
      return entry.defaultOpen === undefined || typeof entry.defaultOpen === 'boolean';
    }
    if (entry.kind === 'section') {
      // New: scroll-target section. Legacy group used kind:section + defaultOpen.
      return true;
    }
    // Legacy kinds still accepted, normalized on write.
    if (entry.kind === 'subsection') return true;
    return false;
  };

  const isValidOutline = (outline) => (
    Array.isArray(outline) &&
    outline.length <= 120 &&
    outline.every(isValidOutlineEntry)
  );

  const normalizeOutlineForWrite = (outline) => outline.map((entry) => {
    if (entry.kind === 'group') {
      return {
        kind: 'group',
        id: entry.id,
        label: entry.label,
        defaultOpen: entry.defaultOpen !== false,
        ...(entry.anchor ? { anchor: entry.anchor } : {}),
      };
    }
    if (entry.kind === 'subsection') {
      return {
        kind: 'section',
        id: entry.id,
        label: entry.label,
        ...(entry.anchor ? { anchor: entry.anchor } : {}),
      };
    }
    if (entry.kind === 'section' && Object.prototype.hasOwnProperty.call(entry, 'defaultOpen')) {
      return {
        kind: 'group',
        id: entry.id,
        label: entry.label,
        defaultOpen: entry.defaultOpen !== false,
        ...(entry.anchor ? { anchor: entry.anchor } : {}),
      };
    }
    return {
      kind: 'section',
      id: entry.id,
      label: entry.label,
      ...(entry.anchor ? { anchor: entry.anchor } : {}),
    };
  });

  /** Legacy nested nav → flat outline (group + section). */
  const outlineFromNav = (nav) => {
    const outline = [];
    for (const item of nav) {
      if (item && typeof item === 'object' && Array.isArray(item.children)) {
        const first = item.children[0];
        outline.push({
          kind: 'group',
          id: slugify(item.label),
          label: item.label,
          defaultOpen: item.defaultOpen !== false,
          ...(first ? { anchor: first.id } : {}),
        });
        for (const child of item.children) {
          outline.push({
            kind: 'section',
            id: child.id,
            label: child.label,
            anchor: child.id,
          });
        }
        continue;
      }
      outline.push({
        kind: 'section',
        id: item.id,
        label: item.label,
        anchor: item.id,
      });
    }
    return outline;
  };

  const isValidShowTitle = (value) => (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['desktop', 'tablet', 'mobile'].every((key) => typeof value[key] === 'boolean') &&
    Object.keys(value).every((key) => key === 'desktop' || key === 'tablet' || key === 'mobile')
  );

  return {
    name: 'content-nav-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-nav', async (req, res, next) => {
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
            if (size > 100_000) {
              send(413, { error: 'The nav update is too large.' });
              return;
            }
            chunks.push(chunk);
          }

          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const documentKey = String(body.document || '');
          const relativeFile = resolveEditableDocument(documentKey);
          const nav = body.nav;
          const outlineInput = body.outline;
          const sectionIds = body.sectionIds && typeof body.sectionIds === 'object'
            ? body.sectionIds
            : null;
          const showTitles = body.showTitles && typeof body.showTitles === 'object'
            ? body.showTitles
            : null;

          let outline = null;
          if (isValidOutline(outlineInput)) {
            outline = normalizeOutlineForWrite(outlineInput);
          } else if (isValidNav(nav)) {
            outline = outlineFromNav(nav);
          }

          if (!relativeFile || !outline) {
            send(400, { error: 'That section outline cannot be updated.' });
            return;
          }

          const file = path.join(process.cwd(), relativeFile);
          const data = JSON.parse(await readFile(file, 'utf8'));
          if (!Array.isArray(data.sections)) {
            send(400, { error: 'The project content is out of date. Refresh and try again.' });
            return;
          }

          data.outline = outline;
          delete data.nav;

          if (sectionIds) {
            for (const [rawIndex, rawId] of Object.entries(sectionIds)) {
              const index = Number(rawIndex);
              if (!Number.isInteger(index) || index < 0 || index >= data.sections.length) {
                send(400, { error: 'A section id target is out of date.' });
                return;
              }
              const section = data.sections[index];
              if (!section || typeof section !== 'object' || Array.isArray(section)) {
                send(400, { error: 'A section id target is invalid.' });
                return;
              }
              if (rawId === null || rawId === '') {
                delete section.sectionId;
              } else if (typeof rawId === 'string' && rawId.length > 0 && rawId.length <= 80) {
                section.sectionId = rawId;
              } else {
                send(400, { error: 'A section id value is invalid.' });
                return;
              }
            }
          }

          if (showTitles) {
            for (const [rawIndex, value] of Object.entries(showTitles)) {
              const index = Number(rawIndex);
              if (!Number.isInteger(index) || index < 0 || index >= data.sections.length) {
                send(400, { error: 'A title visibility target is out of date.' });
                return;
              }
              const section = data.sections[index];
              if (
                !section ||
                typeof section !== 'object' ||
                Array.isArray(section) ||
                section.type !== 'sectionTitle' ||
                !isValidShowTitle(value)
              ) {
                send(400, { error: 'A title visibility value is invalid.' });
                return;
              }
              section.showTitle = value;
              delete section.hideWhenSidebarVisible;
            }
          }

          await writeContentJson(file, data);
          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not parse or write the nav update.' });
        }
      });
    },
  };
}

// Prod view builds pin VIEW_ID via env; only the `astro dev` server reads the
// Alt+V active-view file (a local build should never pick up a stale dev view).
const isDevServe = process.argv.includes('dev');
const activeViewId = process.env.VIEW_ID || (isDevServe ? resolveDevViewIdFromFile() : '');

// https://astro.build/config
export default defineConfig({
  devToolbar: { enabled: false },
  vite: {
    define: {
      'import.meta.env.VIEW_ID': JSON.stringify(activeViewId),
      'import.meta.env.PUBLIC_TEASER_PASSWORD': JSON.stringify(process.env.PUBLIC_TEASER_PASSWORD || 'preview'),
    },
    plugins: [
      tailwindcss(),
      contentHmrGate(),
      draftMediaDevServer(),
      devViewSwitcher(),
      uploadDevWriter(),
      projectCreateDevWriter(),
      projectDeleteDevWriter(),
      projectRenameDevWriter(),
      listingOrderDevWriter(),
      projectSettingsDevWriter(),
      publishMediaDevWriter(),
      imageCropDevWriter(),
      imageGridDevWriter(),
      styleTokenDevWriter(),
      contentTextDevWriter(),
      contentSpacingDevWriter(),
      contentSectionDevWriter(),
      contentBatchDevWriter(),
      contentNavDevWriter(),
    ],
    optimizeDeps: {
      include: ['gsap', 'color-dialog-box'],
    },
    server: {
      watch: {
        ignored: ['**/ROADMAP.md', '**/sitemap/**']
      }
    }
  }
});
