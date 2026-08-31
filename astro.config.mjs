// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import {
  buildImageCarouselSection,
  buildImageCarouselSectionFromSrcs,
  buildImageGridSection,
  buildImageGridSectionFromSrcs,
  buildImageSection,
  buildImageSectionFromSrcs,
  buildPlaceholderImageSection,
  mediaDevServer,
  fillPlaceholderImageSection,
  listingOrderDevWriter,
  galleryMembershipDevWriter,
  sectionOrderDevWriter,
  projectCreateDevWriter,
  projectDeleteDevWriter,
  projectRenameDevWriter,
  projectSettingsDevWriter,
  readDevDocument,
  resolveDevFieldTarget,
  resolveEditableDocument,
  uploadDevWriter,
  writeDevDocument,
} from './scripts/dev-api-plugins.mjs';
import {
  assetsDevWriter,
  normalizeAssetSrc,
  removeMediaItemFromDocument,
} from './scripts/dev-assets.mjs';
import { contentHmrGate, suppressContentHmr } from './scripts/content-hmr-gate.mjs';
import { publishDevWriter } from './scripts/dev-publish.mjs';
import { issueDevWriter } from './scripts/dev-issue.mjs';
import { commitEngineDevWriter } from './scripts/dev-commit-engine.mjs';
import { mediaCollectorIntegration } from './scripts/collect-shipped-assets.mjs';
import {
  TOKENS_RELATIVE_PATH,
  CSS_RELATIVE_PATH,
  generateTokenBlock,
  applyTokenBlock,
} from './scripts/build-tokens.mjs';

const isSafePathPart = (part) => (
  (typeof part === 'string' || typeof part === 'number') &&
  part !== '__proto__' &&
  part !== 'prototype' &&
  part !== 'constructor'
);

/**
 * Only `ref` tokens hold literal hex — `sys` and `comp` are aliases that
 * inherit whatever their referenced `ref` token resolves to. Walk the `ref`
 * branch of the token tree to build the editable set fresh on every request,
 * so a hand-edit to the JSON is picked up without restarting the dev server.
 */
const collectRefTokenEntries = (refNode) => {
  /** @type {Map<string, Array<string | number>>} */
  const entries = new Map();
  const walk = (node, pathParts) => {
    if (node && typeof node === 'object' && !Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, '$value')) {
      entries.set(`--${pathParts.join('-')}`, pathParts);
      return;
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const key of Object.keys(node)) walk(node[key], [...pathParts, key]);
    }
  };
  walk(refNode, ['ref']);
  return entries;
};
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
          const fieldPath = body.path;
          if (
            !resolveEditableDocument(documentKey) ||
            !Array.isArray(fieldPath) ||
            fieldPath.length > 8 ||
            !fieldPath.every(isSafePathPart) ||
            fieldPath.length === 0
          ) {
            send(400, { error: 'That image is not editable.' });
            return;
          }

          let targetInfo;
          try {
            targetInfo = resolveDevFieldTarget(documentKey, '', fieldPath);
          } catch (error) {
            send(400, { error: error instanceof Error ? error.message : 'That image is not editable.' });
            return;
          }

          const data = await readDevDocument(targetInfo.relativeFile);
          const result = applyCropChange(data, body);
          if (!result.ok) {
            send(400, { error: result.error });
            return;
          }

          await writeDevDocument(targetInfo.relativeFile, data);
          send(200, {
            ok: true,
            document: documentKey,
            ...(body.clearVariants === true ? { cleared: true } : {}),
            ...(body.variants ? { variants: body.variants } : {}),
            ...(typeof body.constrained === 'boolean' ? { constrained: body.constrained } : {}),
            ...(typeof body.centered === 'boolean' ? { centered: body.centered } : {}),
          });
        } catch {
          send(400, { error: 'Could not parse or write the crop.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for image-grid settings (per-breakpoint columns,
 * constrained width, default aspect, match-height, and visible/parking
 * layouts with waterfall inheritance).
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

                    const documentKey = String(body.document || '');
          const fieldPath = body.path;
          const target = resolveDevFieldTarget(documentKey, '', fieldPath);
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
          if (body.matchHeight === true) {
            node.matchHeight = true;
          } else {
            delete node.matchHeight;
          }
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
            matchHeight: body.matchHeight === true,
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
 * Dev-only writer for literal (ref-tier) colour tokens. Writes the new hex
 * into tokens/design-tokens.json at the token's path, then regenerates
 * global.css from it — the JSON stays the single source of truth.
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

          const tokensFile = path.join(process.cwd(), TOKENS_RELATIVE_PATH);
          const tokensJson = JSON.parse(await readFile(tokensFile, 'utf8'));
          const editableTokens = collectRefTokenEntries(tokensJson.ref);
          const tokenPath = editableTokens.get(token);

          if (!tokenPath) {
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

          let node = tokensJson;
          for (const part of tokenPath.slice(0, -1)) node = node[part];
          node[tokenPath.at(-1)].$value = value;

          const cssFile = path.join(process.cwd(), CSS_RELATIVE_PATH);
          const cssSource = await readFile(cssFile, 'utf8');
          const block = generateTokenBlock(tokensJson);
          const { next: nextCss } = applyTokenBlock(cssSource, block);

          // Live preview already applied the colour — skip CSS HMR invalidation
          // so is-dev-mode and the save bar stay up (full-reload is always blocked).
          suppressContentHmr();
          await writeFile(tokensFile, `${JSON.stringify(tokensJson, null, 2)}\n`, 'utf8');
          await writeFile(cssFile, nextCss, 'utf8');
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
            const target = resolveDevFieldTarget(documentKey, '', fieldPath);
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
 * Apply standalone image width/centering flags onto a crop target node.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} change
 */
const applyImageWidthFlags = (target, change) => {
  let touched = false;
  if (typeof change.constrained === 'boolean') {
    if (change.constrained) target.constrained = true;
    else delete target.constrained;
    touched = true;
  } else if (change.constrained && typeof change.constrained === 'object' && !Array.isArray(change.constrained)) {
    const requestedConstrained = change.constrained;
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
        constrained[viewport] = 100;
        continue;
      }
      constrained[viewport] = stepped;
    }
    const allFull = [...IMAGE_VIEWPORTS].every((viewport) => constrained[viewport] === 100);
    const allEighty = [...IMAGE_VIEWPORTS].every((viewport) => constrained[viewport] === 80);
    if (allFull) {
      delete target.constrained;
    } else if (allEighty) {
      target.constrained = true;
    } else {
      target.constrained = constrained;
    }
    touched = true;
  }
  if (typeof change.centered === 'boolean') {
    if (change.centered) target.centered = true;
    else delete target.centered;
    touched = true;
  }
  if (Object.prototype.hasOwnProperty.call(change, 'maxVh') || typeof change.max80 === 'boolean') {
    const raw = Object.prototype.hasOwnProperty.call(change, 'maxVh') ? change.maxVh : (change.max80 ? 80 : 0);
    const n = Math.round(Number(raw));
    const allowed = new Set([90, 80, 70, 60, 50, 40, 30]);
    if (allowed.has(n)) {
      target.maxVh = n;
    } else {
      delete target.maxVh;
    }
    delete target.max80;
    touched = true;
  }
  return touched;
};

/**
 * Apply one image-crop mutation onto an in-memory document node.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
const applyCropChange = (data, change) => {
  const fieldPath = change.path;
  if (!Array.isArray(fieldPath) || fieldPath.length > 8 || !fieldPath.every(isSafePathPart)) {
    return { ok: false, error: 'That image is not editable.' };
  }
  const target = fieldPath.length === 0 ? data : resolvePathTarget(data, fieldPath);
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, error: 'That image path no longer exists.' };
  }

  if (change.clearVariants === true) {
    delete target.variants;
    delete target.crop;
    applyImageWidthFlags(target, change);
    return { ok: true };
  }

  const requestedSrc = typeof change.src === 'string' ? normalizeAssetSrc(change.src) : '';
  const hoverSlot = change.slot === 'hoverImage';
  if (typeof change.src === 'string' && !requestedSrc) {
    return { ok: false, error: 'That image file is not valid.' };
  }
  if (requestedSrc) {
    if (hoverSlot) {
      target.hoverImage = requestedSrc;
    } else if (
      Object.prototype.hasOwnProperty.call(target, 'image')
      && !Object.prototype.hasOwnProperty.call(target, 'src')
    ) {
      target.image = requestedSrc;
      const srcWidth = Number(change.srcWidth);
      const srcHeight = Number(change.srcHeight);
      if (Number.isFinite(srcWidth) && srcWidth > 0) {
        target.srcWidth = Math.round(srcWidth);
      } else {
        delete target.srcWidth;
      }
      if (Number.isFinite(srcHeight) && srcHeight > 0) {
        target.srcHeight = Math.round(srcHeight);
      } else {
        delete target.srcHeight;
      }
    } else {
      target.src = requestedSrc;
      const srcWidth = Number(change.srcWidth);
      const srcHeight = Number(change.srcHeight);
      if (Number.isFinite(srcWidth) && srcWidth > 0) {
        target.srcWidth = Math.round(srcWidth);
      } else {
        delete target.srcWidth;
      }
      if (Number.isFinite(srcHeight) && srcHeight > 0) {
        target.srcHeight = Math.round(srcHeight);
      } else {
        delete target.srcHeight;
      }
    }
  }

  const parseVariantBlob = (blob) => {
    /** @type {Record<string, { aspect: string, cx: number, cy: number, w: number }>} */
    const variants = {};
    for (const [viewport, requested] of Object.entries(blob)) {
      const cx = Number(requested?.cx);
      const cy = Number(requested?.cy);
      const w = Number(requested?.w);
      const aspect = String(requested?.aspect || '');
      // Accept w slightly above 1 (float / linked-hover reshape) and clamp —
      // rejecting broke Save after cover-handle resize while hover was still
      // on an undercover seed (`w: 1` with zoom < 1 → write-back w > 1).
      if (
        !IMAGE_VIEWPORTS.has(viewport) ||
        !isAllowedAspectRatio(aspect) ||
        ![cx, cy, w].every(Number.isFinite) ||
        w <= 0
      ) {
        return { ok: false, error: 'Use supported viewports, aspect ratios and crop values.' };
      }
      variants[viewport] = {
        aspect,
        cx: clampRound(cx, -1, 2, 6),
        cy: clampRound(cy, -1, 2, 6),
        w: clampRound(w, 0.01, 1, 6),
      };
    }
    if (!Object.keys(variants).length) {
      return { ok: false, error: 'No crop data was provided.' };
    }
    return { ok: true, variants };
  };

  const requestedHoverVariants = change.hoverVariants && typeof change.hoverVariants === 'object'
    ? change.hoverVariants
    : null;
  const requestedVariants = change.variants && typeof change.variants === 'object'
    ? change.variants
    : null;
  const hasWidthFlags = typeof change.constrained === 'boolean'
    || (change.constrained && typeof change.constrained === 'object' && !Array.isArray(change.constrained))
    || typeof change.centered === 'boolean'
    || Object.prototype.hasOwnProperty.call(change, 'maxVh')
    || typeof change.max80 === 'boolean';

  if (requestedHoverVariants) {
    const parsed = parseVariantBlob(requestedHoverVariants);
    if (!parsed.ok) return parsed;
    target.hoverVariants ||= {};
    for (const [viewport, next] of Object.entries(parsed.variants)) {
      const prev = target.hoverVariants[viewport] ?? {};
      target.hoverVariants[viewport] = { ...prev, ...next };
    }
    // Linked aspect: hover aspect change updates cover frame too.
    target.variants ||= {};
    for (const [viewport, next] of Object.entries(parsed.variants)) {
      target.variants[viewport] ||= {};
      target.variants[viewport].aspect = next.aspect;
    }
    delete target.crop;
  }

  if (requestedVariants) {
    const parsed = parseVariantBlob(requestedVariants);
    if (!parsed.ok) return parsed;

    target.variants ||= {};
    for (const [viewport, next] of Object.entries(parsed.variants)) {
      target.variants[viewport] = next;
    }
    // Linked aspect: cover aspect change updates hover when hoverVariants exist.
    if (target.hoverVariants && typeof target.hoverVariants === 'object') {
      for (const [viewport, next] of Object.entries(parsed.variants)) {
        if (target.hoverVariants[viewport]) {
          target.hoverVariants[viewport].aspect = next.aspect;
        }
      }
    }
    delete target.crop;
  } else if (!requestedHoverVariants && !hasWidthFlags && !requestedSrc) {
    return { ok: false, error: 'No crop data was provided.' };
  }

  applyImageWidthFlags(target, change);
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
  if (change.matchHeight === true) {
    target.matchHeight = true;
  } else {
    delete target.matchHeight;
  }
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

const CAROUSEL_ORIENTATIONS = new Set(['horizontal', 'vertical']);
const CAROUSEL_HEIGHT_MODES = new Set(['dynamic', 'tallest']);
const CAROUSEL_DOTS_PLACEMENTS = new Set(['outside', 'over', 'hidden']);
/** Matches MAX_VH_PERCENTS in src/lib/projectImageFrame.ts. */
const CAROUSEL_MAX_VH = new Set([90, 80, 70, 60, 50, 40, 30]);
const CAROUSEL_BREAKPOINTS = new Set(['tablet', 'mobile']);

const sanitizeCarouselVisibleIds = (itemIds, requested) => {
  const knownIds = new Set(itemIds);
  const seen = new Set();
  const visible = [];
  for (const rawId of Array.isArray(requested) ? requested : []) {
    const id = String(rawId || '');
    if (!knownIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    visible.push(id);
  }
  return visible.length ? visible : [...itemIds];
};

const parseCarouselBreakpointOverride = (raw, itemIds) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Use a supported carousel breakpoint override.' };
  }
  const out = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'heightMode')) {
    const heightMode = String(raw.heightMode || '');
    if (!CAROUSEL_HEIGHT_MODES.has(heightMode)) {
      return { ok: false, error: 'Use a supported carousel height mode.' };
    }
    out.heightMode = heightMode;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'dotsPlacement')) {
    const dotsPlacement = String(raw.dotsPlacement || 'outside');
    if (!CAROUSEL_DOTS_PLACEMENTS.has(dotsPlacement)) {
      return { ok: false, error: 'Use a supported position-dot placement.' };
    }
    out.dotsPlacement = dotsPlacement;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'maxHeightVh')) {
    const maxHeightVh = Math.round(Number(raw.maxHeightVh));
    if (CAROUSEL_MAX_VH.has(maxHeightVh)) out.maxHeightVh = maxHeightVh;
    else if (raw.maxHeightVh === null || raw.maxHeightVh === 0 || raw.maxHeightVh === '') {
      out.maxHeightVh = null;
    } else {
      return { ok: false, error: 'Use a supported max height.' };
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'scrollPinned')) {
    out.scrollPinned = raw.scrollPinned === true;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'visible')) {
    out.visible = sanitizeCarouselVisibleIds(itemIds, raw.visible);
  }
  return { ok: true, value: out };
};

/**
 * Apply one image-carousel settings mutation onto an in-memory document node.
 * Items are left alone — only block-level settings are written here.
 * Desktop values stay on top-level fields; tablet/mobile land in `breakpoints`.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
const applyCarouselChange = (data, change) => {
  const fieldPath = change.path;
  if (!Array.isArray(fieldPath) || !fieldPath.length || fieldPath.length > 8 || !fieldPath.every(isSafePathPart)) {
    return { ok: false, error: 'That carousel is not editable.' };
  }
  const target = resolvePathTarget(data, fieldPath);
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, error: 'That carousel path no longer exists.' };
  }

  const itemIds = Array.isArray(target.items)
    ? target.items.map((item, index) => String(item?.id || `item-${index}`))
    : [];

  const orientation = String(change.orientation || '');
  if (!CAROUSEL_ORIENTATIONS.has(orientation)) {
    return { ok: false, error: 'Use a horizontal or vertical carousel.' };
  }

  const heightMode = String(change.heightMode || 'dynamic');
  if (!CAROUSEL_HEIGHT_MODES.has(heightMode)) {
    return { ok: false, error: 'Use a supported carousel height mode.' };
  }

  const dotsPlacement = String(change.dotsPlacement || 'outside');
  if (!CAROUSEL_DOTS_PLACEMENTS.has(dotsPlacement)) {
    return { ok: false, error: 'Use a supported position-dot placement.' };
  }

  target.orientation = orientation;
  if (heightMode === 'dynamic') delete target.heightMode;
  else target.heightMode = heightMode;
  if (dotsPlacement === 'outside') delete target.dotsPlacement;
  else target.dotsPlacement = dotsPlacement;

  const maxHeightVh = Math.round(Number(change.maxHeightVh));
  if (CAROUSEL_MAX_VH.has(maxHeightVh)) {
    target.maxHeightVh = maxHeightVh;
  } else if (change.maxHeightVh && change.maxHeightVh !== 0) {
    return { ok: false, error: 'Use a supported max height.' };
  } else {
    delete target.maxHeightVh;
  }

  if (change.scrollPinned === true) target.scrollPinned = true;
  else delete target.scrollPinned;

  // Desktop visible order — items themselves stay put so crop paths remain stable.
  if (Object.prototype.hasOwnProperty.call(change, 'visible')) {
    const visible = sanitizeCarouselVisibleIds(itemIds, change.visible);
    const isDefault = visible.length === itemIds.length
      && visible.every((id, index) => id === itemIds[index]);
    if (isDefault) delete target.visible;
    else target.visible = visible;
  }

  // Sparse tablet/mobile overrides (settings below orientation).
  if (Object.prototype.hasOwnProperty.call(change, 'breakpoints')) {
    const rawBreakpoints = change.breakpoints;
    if (rawBreakpoints == null) {
      delete target.breakpoints;
    } else if (typeof rawBreakpoints !== 'object' || Array.isArray(rawBreakpoints)) {
      return { ok: false, error: 'Use a supported carousel breakpoints map.' };
    } else {
      const next = {};
      for (const key of Object.keys(rawBreakpoints)) {
        if (!CAROUSEL_BREAKPOINTS.has(key)) {
          return { ok: false, error: 'Use tablet or mobile carousel breakpoints.' };
        }
        const parsed = parseCarouselBreakpointOverride(rawBreakpoints[key], itemIds);
        if (!parsed.ok) return parsed;
        if (Object.keys(parsed.value).length) next[key] = parsed.value;
      }
      if (Object.keys(next).length) target.breakpoints = next;
      else delete target.breakpoints;
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

  const CAPTION_STYLES = new Set(['white', 'black', 'below', 'default']);
  const CAPTION_POSITIONS = new Set([
    'left',
    'center',
    'right',
    'bottom-left',
    'top-left',
    'bottom-right',
    'top-right',
  ]);
  const normalizeCaptionPosition = (value, style) => {
    if (style === 'below') {
      switch (value) {
        case 'left':
        case 'center':
        case 'right':
          return value;
        case 'bottom-left':
        case 'top-left':
          return 'left';
        case 'bottom-right':
        case 'top-right':
          return 'right';
        default:
          return 'left';
      }
    }
    switch (value) {
      case 'bottom-left':
      case 'top-left':
      case 'bottom-right':
      case 'top-right':
        return value;
      case 'left':
        return 'bottom-left';
      case 'right':
        return 'bottom-right';
      case 'center':
        return 'bottom-left';
      default:
        return 'bottom-left';
    }
  };
  const CAPTION_REVEALS = new Set(['hover', 'always']);
  const rawStyle = String(change.captionStyle || 'white');
  let captionStyle = rawStyle;
  if (!CAPTION_STYLES.has(captionStyle)) {
    return { ok: false, error: 'Use a supported caption style.' };
  }
  if (captionStyle === 'black' || captionStyle === 'default') captionStyle = 'white';
  const defaultRawPosition = captionStyle === 'below' ? 'left' : 'bottom-left';
  const rawCaptionPosition = String(change.captionPosition || defaultRawPosition);
  if (!CAPTION_POSITIONS.has(rawCaptionPosition)) {
    return { ok: false, error: 'Use a supported caption position.' };
  }
  const captionPosition = normalizeCaptionPosition(rawCaptionPosition, captionStyle);

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
  const defaultPosition = captionStyle === 'below' ? 'left' : 'bottom-left';
  if (captionPosition === defaultPosition) {
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
                    const crops = Array.isArray(body.crops) ? body.crops : [];
          const grids = Array.isArray(body.grids) ? body.grids : [];
          const carousels = Array.isArray(body.carousels) ? body.carousels : [];
          const captions = Array.isArray(body.captions) ? body.captions : [];
          const textChanges = Array.isArray(body.text) ? body.text : [];
          const spacingChanges = Array.isArray(body.spacing) ? body.spacing : [];
          if (
            !crops.length &&
            !grids.length &&
            !carousels.length &&
            !captions.length &&
            !textChanges.length &&
            !spacingChanges.length
          ) {
            send(400, { error: 'No changes were provided.' });
            return;
          }

          /** @type {Map<string, { crops: any[], grids: any[], carousels: any[], captions: any[], text: any[], spacing: any[] }>} */
          const grouped = new Map();
          const resolveBatchChange = (documentKey, fieldPath) => {
            // resolveDevFieldTarget throws on an unknown document or an invalid
            // path (empty path is only valid for play:* roots); swallow it so
            // the caller's specific message wins over the catch-all below.
            let target;
            try {
              target = resolveDevFieldTarget(documentKey, '', fieldPath);
            } catch {
              return null;
            }
            if (!target?.relativeFile) return null;
            let group = grouped.get(target.relativeFile);
            if (!group) {
              group = { crops: [], grids: [], carousels: [], captions: [], text: [], spacing: [] };
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
          for (const change of carousels) {
            const documentKey = String(change?.document || '');
            const resolved = resolveBatchChange(documentKey, change?.path);
            if (!resolved) {
              send(400, { error: 'That carousel is not editable.' });
              return;
            }
            resolved.group.carousels.push({ ...change, path: resolved.path });
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
            for (const change of group.carousels) {
              const result = applyCarouselChange(data, change);
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
            carousels: carousels.length,
            captions: captions.length,
            text: textChanges.length,
            spacing: spacingChanges.length,
          });
        } catch (error) {
          console.error('[content-batch] save failed', error);
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
const INSERTABLE_SECTION_TYPES = new Set([
  'bodyText',
  'sectionTitle',
  'image',
  'imageGrid',
  'imageCarousel',
  'placeholder',
]);
// Insert stays allowlisted (construction needs a known shape). Delete is
// default-on: any section at a valid index can go — no type registration.

const outlineAnchorId = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  const anchor = typeof entry.anchor === 'string' ? entry.anchor.trim() : '';
  if (anchor) return anchor;
  return typeof entry.id === 'string' ? entry.id : '';
};

/** Keep project outline in sync with sectionTitle insert/delete in one write. */
const syncOutlineForSectionMutation = (data, { action, section, index }) => {
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

    // Page order from sections[] (caller already spliced the new section in).
    const pageIndexForId = (id) => {
      if (!id || !Array.isArray(data.sections)) return Number.POSITIVE_INFINITY;
      const idx = data.sections.findIndex((entry) => {
        const sid = String(entry?.sectionId || entry?.id || '').trim();
        return sid === id;
      });
      return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
    };

    const blockPage = typeof index === 'number' ? index : pageIndexForId(anchor);
    const entry = {
      kind: 'section',
      id: anchor,
      label,
      anchor,
    };
    let insertAt = data.outline.length;
    for (let i = 0; i < data.outline.length; i += 1) {
      if (pageIndexForId(outlineAnchorId(data.outline[i])) > blockPage) {
        insertAt = i;
        break;
      }
    }
    data.outline.splice(insertAt, 0, entry);
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
          const relativeFile = resolveEditableDocument(documentKey);
          const action = body.action === 'delete'
            ? 'delete'
            : body.action === 'fillPlaceholder'
              ? 'fillPlaceholder'
              : body.action === 'removeMediaItem'
                ? 'removeMediaItem'
                : body.action === 'convert'
                  ? 'convert'
                  : 'insert';
          const index = Number(body.index);

          if (!relativeFile) {
            send(400, { error: 'That section cannot be updated.' });
            return;
          }

          const file = path.join(process.cwd(), relativeFile);
          const data = JSON.parse(await readFile(file, 'utf8'));
          if (!Array.isArray(data.sections)) {
            send(400, { error: 'The sections list is out of date. Refresh and try again.' });
            return;
          }

          if (action === 'removeMediaItem') {
            const itemId = String(body.itemId || '').trim();
            const fieldPath = Array.isArray(body.path) ? body.path : [];
            try {
              const section = removeMediaItemFromDocument(data, fieldPath, itemId);
              await writeContentJson(file, data);
              send(200, {
                ok: true,
                action: 'removeMediaItem',
                itemId,
                path: fieldPath,
                section,
              });
            } catch (error) {
              send(400, {
                error: error instanceof Error ? error.message : 'Could not remove that image.',
              });
            }
            return;
          }

          if (!Number.isInteger(index) || index < 0) {
            send(400, { error: 'That section cannot be updated.' });
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
            if (existingType === 'projectGrid') {
              const gridCount = data.sections.filter(
                (s) => s && typeof s === 'object' && !Array.isArray(s) && s.type === 'projectGrid',
              ).length;
              if (gridCount <= 1) {
                send(400, { error: 'The gallery grid cannot be removed.' });
                return;
              }
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
          const srcs = Array.isArray(body.srcs)
            ? body.srcs.map((value) => String(value || '').trim()).filter(Boolean)
            : [];

          if (action === 'fillPlaceholder') {
            if (index >= data.sections.length) {
              send(400, { error: 'The sections list is out of date. Refresh and try again.' });
              return;
            }
            if (!filenames.length && !srcs.length) {
              send(400, { error: 'An image file is required.' });
              return;
            }
            const existing = data.sections[index];
            const variants = (
              body.variants
              && typeof body.variants === 'object'
              && !Array.isArray(body.variants)
            )
              ? body.variants
              : undefined;
            try {
              await fillPlaceholderImageSection(
                existing,
                documentKey,
                filenames[0] || '',
                variants,
                srcs[0] || '',
              );
            } catch (error) {
              send(400, {
                error: error instanceof Error ? error.message : 'Could not fill that placeholder.',
              });
              return;
            }
            await writeContentJson(file, data);
            send(200, {
              ok: true,
              action: 'fillPlaceholder',
              index,
              id: existing.id,
              type: existing.type,
              section: existing,
            });
            return;
          }

          if (action === 'convert') {
            if (index >= data.sections.length) {
              send(400, { error: 'The sections list is out of date. Refresh and try again.' });
              return;
            }
            const existing = data.sections[index];
            if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
              send(400, { error: 'That section cannot be converted.' });
              return;
            }
            const existingType = String(existing.type || '');
            if (existingType !== 'bodyText' && existingType !== 'sectionTitle') {
              send(400, { error: 'That section cannot be converted.' });
              return;
            }
            if (type !== 'bodyText' && type !== 'sectionTitle') {
              send(400, { error: 'That section cannot be converted.' });
              return;
            }

            const existingLevel = existingType === 'sectionTitle'
              ? (Number(existing.level) === 3 ? 3 : 2)
              : null;

            if (existingType === 'bodyText' && type === 'sectionTitle') {
              const paragraphs = Array.isArray(existing.paragraphs)
                ? existing.paragraphs.map((value) => String(value ?? ''))
                : [''];
              const level = Number(body.level) === 3 ? 3 : 2;
              const next = {
                ...existing,
                type: 'sectionTitle',
                title: paragraphs.join('\n'),
                level,
              };
              delete next.paragraphs;
              if (level === 2 && !next.sectionId) {
                next.sectionId = `title-${Date.now().toString(36)}`;
              }
              data.sections[index] = next;
              if (level === 2) {
                syncOutlineForSectionMutation(data, { action: 'insert', section: next, index });
              }
            } else if (existingType === 'sectionTitle' && type === 'bodyText') {
              if (existingLevel === 2) {
                syncOutlineForSectionMutation(data, { action: 'delete', section: existing });
              }
              const title = String(existing.title ?? '');
              const next = {
                ...existing,
                type: 'bodyText',
                paragraphs: title.split('\n'),
              };
              delete next.title;
              delete next.level;
              data.sections[index] = next;
            } else if (existingType === 'sectionTitle' && type === 'sectionTitle') {
              const nextLevel = Number(body.level) === 3 ? 3 : 2;
              if (existingLevel === 2 && nextLevel === 3) {
                syncOutlineForSectionMutation(data, { action: 'delete', section: existing });
              } else if (existingLevel === 3 && nextLevel === 2) {
                if (!existing.sectionId) {
                  existing.sectionId = `title-${Date.now().toString(36)}`;
                }
                syncOutlineForSectionMutation(data, { action: 'insert', section: existing, index });
              }
              existing.level = nextLevel;
            }

            await writeContentJson(file, data);
            send(200, {
              ok: true,
              action: 'convert',
              index,
              type,
              section: data.sections[index],
            });
            return;
          }

          if (!INSERTABLE_SECTION_TYPES.has(type) || index > data.sections.length) {
            send(400, { error: 'That section cannot be inserted.' });
            return;
          }

          let section;
          const requestedSpacing = String(body.spacing || '');
          const insertSpacing = EDITABLE_SPACING_VALUES.has(requestedSpacing)
            ? requestedSpacing
            : (index === 0 ? 'none' : 'section');
          if (type === 'sectionTitle') {
            const id = `title-${Date.now().toString(36)}`;
            const level = Number(body.level) === 3 ? 3 : 2;
            section = {
              type: 'sectionTitle',
              id,
              sectionId: id,
              title: 'Section title',
              spacing: insertSpacing,
              tightBottom: false,
              ...(level === 3 ? { level: 3 } : {}),
              ...(body.intro === true || body.intro === 'true' ? { intro: true } : {}),
            };
          } else if (type === 'bodyText') {
            const id = `body-${Date.now().toString(36)}`;
            section = {
              type: 'bodyText',
              id,
              spacing: insertSpacing,
              paragraphs: [''],
              ...(body.intro === true || body.intro === 'true' ? { intro: true } : {}),
            };
          } else if (type === 'image') {
            if (!srcs.length && !filenames.length) {
              send(400, { error: 'An image file is required.' });
              return;
            }
            section = srcs.length
              ? await buildImageSectionFromSrcs(srcs.slice(0, 1))
              : await buildImageSection(documentKey, filenames.slice(0, 1));
            if (section && typeof section === 'object') section.spacing = insertSpacing;
          } else if (type === 'imageGrid') {
            if (!srcs.length && !filenames.length) {
              send(400, { error: 'At least one image file is required.' });
              return;
            }
            section = srcs.length
              ? await buildImageGridSectionFromSrcs(srcs)
              : await buildImageGridSection(documentKey, filenames);
            if (section && typeof section === 'object') section.spacing = insertSpacing;
          } else if (type === 'imageCarousel') {
            if (!srcs.length && !filenames.length) {
              send(400, { error: 'At least one image file is required.' });
              return;
            }
            section = srcs.length
              ? await buildImageCarouselSectionFromSrcs(srcs)
              : await buildImageCarouselSection(documentKey, filenames);
            if (section && typeof section === 'object') section.spacing = insertSpacing;
          } else if (type === 'placeholder') {
            section = buildPlaceholderImageSection();
            if (section && typeof section === 'object') section.spacing = insertSpacing;
          }

          if (!section) {
            send(400, { error: 'That section cannot be inserted.' });
            return;
          }

          data.sections.splice(index, 0, section);
          syncOutlineForSectionMutation(data, { action: 'insert', section, index });

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
            const target = resolveDevFieldTarget(documentKey, '', fieldPath);
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

          const existingOutline = isValidOutline(data.outline)
            ? normalizeOutlineForWrite(data.outline)
            : [];
          let outlinePreserved = false;
          if (outline.length === 0 && existingOutline.length > 0) {
            // Editor saves can ship an empty in-memory outline (e.g. after HMR). Never wipe a
            // populated sidebar from disk — still apply sectionIds / showTitles below.
            data.outline = existingOutline;
            outlinePreserved = true;
          } else {
            data.outline = outline;
          }
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
          send(200, { ok: true, ...(outlinePreserved ? { outlinePreserved: true } : {}) });
        } catch {
          send(400, { error: 'Could not parse or write the nav update.' });
        }
      });
    },
  };
}

// https://astro.build/config
/**
 * Lapse (the dev-only animation inspector) resolves from a private registry that
 * needs a token in a machine-local ~/.npmrc. CI has no token, so the package is
 * declared `optional` and is simply absent there.
 *
 * Astro still walks every `<script>` it finds — the `{showDevTools && ...}` guard
 * in Layout.astro gates *rendering*, not bundling — so Rollup tries to resolve
 * `@aiforui/lapse/*` during a production build and hard-fails when it is missing.
 * Stubbing it at build time fixes that, and drops the ~800KB Lapse+React orphan
 * chunk that was being emitted into every deploy and referenced by nothing.
 *
 * @returns {import('vite').Plugin}
 */
function stubLapseInBuild() {
  const PREFIX = '\0vcd-lapse-stub:';
  const stubbed = new Set(['@aiforui/lapse/install', '@aiforui/lapse/panel']);
  return {
    name: 'vcd-stub-lapse',
    apply: 'build',
    resolveId(id) {
      return stubbed.has(id) ? PREFIX + id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      // Same shape lapseDev.ts imports, so the module still type-checks and the
      // (never-rendered) production script is inert rather than throwing.
      return 'export const getSharedEngine = () => ({ registerGSAP() {} });\n'
        + 'export const mountLapse = () => {};\n';
    },
  };
}

export default defineConfig({
  // Absolute base for canonical links and og:image URLs. Social scrapers and
  // search engines both reject relative ones, so this has to be a real origin.
  // Flip to the apex domain via PUBLIC_SITE_URL when #15 migrates it — no code
  // change needed, just the env var in Cloudflare.
  site: process.env.PUBLIC_SITE_URL || 'https://wip.vcruzdesigns.com',
  devToolbar: { enabled: false },
  integrations: [mediaCollectorIntegration()],
  // Bind 0.0.0.0 so phones / other devices on the LAN can hit the dev server.
  // (Astro's top-level server.host — vite.server.host alone is not enough.)
  server: {
    host: true,
    // Vite/Astro block unknown Host headers by default; allow LAN IPs / mDNS names.
    allowedHosts: true,
  },
  vite: {
    define: {
      'import.meta.env.PUBLIC_TEASER_PASSWORD': JSON.stringify(process.env.PUBLIC_TEASER_PASSWORD || 'preview'),
    },
    plugins: [
      tailwindcss(),
      stubLapseInBuild(),
      contentHmrGate(),
      mediaDevServer(),
      uploadDevWriter(),
      assetsDevWriter(),
      projectCreateDevWriter(),
      projectDeleteDevWriter(),
      projectRenameDevWriter(),
      listingOrderDevWriter(),
      galleryMembershipDevWriter(),
      sectionOrderDevWriter(),
      projectSettingsDevWriter(),
      publishDevWriter(),
      issueDevWriter(),
      commitEngineDevWriter(),
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
        // Content + media are not Vite modules. Watching them fires
        // full-reloads on Save / branch-sync pulls — calm HMR (contentHmrGate)
        // also drops full-reload WS, but ignoring here keeps the watcher quiet.
        // Manual refresh when you want new content.
        ignored: [
          '**/ROADMAP.md',
          '**/sitemap/**',
          '**/src/content/**',
          '**/media/**',
        ],
      }
    }
  }
});
