// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

const GLOBAL_STYLES = 'src/styles/global.css';
const EDITABLE_CONTENT_DOCUMENTS = new Map([
  ['tapico', 'src/content/projects/tapico.json'],
  ['[retired-project]', 'src/content/projects/[retired-project].json'],
  ['the-rams', 'src/content/projects/the-rams.json'],
  ['parentpal', 'src/content/projects/parentpal.json'],
  ['conic-collection', 'src/content/projects/conic-collection.json'],
]);
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
const IMAGE_ASPECT_RATIOS = new Set([
  'original',
  '16:9',
  '16:10',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '10:16',
  '9:16',
]);

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
          const relativeFile = EDITABLE_CONTENT_DOCUMENTS.get(documentKey);
          const fieldPath = body.path;
          if (
            !relativeFile ||
            !Array.isArray(fieldPath) ||
            !fieldPath.length ||
            fieldPath.length > 8 ||
            !fieldPath.every(isSafePathPart)
          ) {
            send(400, { error: 'That image is not editable.' });
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
              !IMAGE_ASPECT_RATIOS.has(aspectRatio) ||
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

          const file = path.join(process.cwd(), relativeFile);
          const data = JSON.parse(await readFile(file, 'utf8'));

          let target = data;
          for (const part of fieldPath) {
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

          target.variants ||= {};
          Object.assign(target.variants, variants);
          delete target.crop;
          await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
          send(200, { ok: true, document: documentKey, variants });
        } catch {
          send(400, { error: 'Could not parse or write the crop.' });
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
          const changes = Array.isArray(body.changes) ? body.changes : [];
          if (!changes.length) {
            send(400, { error: 'No text changes were provided.' });
            return;
          }

          const grouped = new Map();
          for (const change of changes) {
            const documentKey = String(change.document || '');
            const relativeFile = EDITABLE_CONTENT_DOCUMENTS.get(documentKey);
            const fieldPath = change.path;
            const value = change.value;
            const valueIsText = typeof value === 'string' && value.length <= 20_000;
            const valueIsParagraphs = (
              Array.isArray(value) &&
              value.length > 0 &&
              value.every((paragraph) => typeof paragraph === 'string') &&
              value.join('').length <= 20_000
            );
            if (
              !relativeFile ||
              !Array.isArray(fieldPath) ||
              !fieldPath.length ||
              fieldPath.length > 8 ||
              (!valueIsText && !valueIsParagraphs) ||
              fieldPath.some((part) => (
                (typeof part !== 'string' && typeof part !== 'number') ||
                part === '__proto__' ||
                part === 'prototype' ||
                part === 'constructor'
              ))
            ) {
              send(400, { error: 'One or more text fields are not editable.' });
              return;
            }
            const documentChanges = grouped.get(documentKey) || [];
            documentChanges.push({ path: fieldPath, value });
            grouped.set(documentKey, documentChanges);
          }

          for (const [documentKey, documentChanges] of grouped) {
            const relativeFile = EDITABLE_CONTENT_DOCUMENTS.get(documentKey);
            const file = path.join(process.cwd(), relativeFile);
            const data = JSON.parse(await readFile(file, 'utf8'));

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

            await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
          }

          send(200, { ok: true, count: changes.length });
        } catch {
          send(400, { error: 'Could not parse or write the text changes.' });
        }
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  // TODO: Re-enable Astro dev toolbar after investigating dev-mode layout jump.
  devToolbar: { enabled: false },
  vite: {
    plugins: [
      tailwindcss(),
      imageCropDevWriter(),
      styleTokenDevWriter(),
      contentTextDevWriter(),
    ],
    optimizeDeps: {
      include: ['gsap', '@melloware/coloris'],
    },
    server: {
      watch: {
        ignored: ['**/ROADMAP.md', '**/sitemap/**']
      }
    }
  }
});
