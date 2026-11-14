// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import {
  buildImageCarouselSection,
  buildImageCarouselSectionFromSrcs,
  buildImageGridSection,
  buildImageGridSectionFromSrcs,
  buildImageSection,
  buildImageSectionFromSrcs,
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
  devAuthoringState,
  devAuthoringRequestQueue,
  writeAtomicJson,
  projectRouteWatcher,
} from './scripts/dev-api-plugins.mjs';
import { branchUpdateDevWriter } from './scripts/dev-branch-update.mjs';
import {
  assetsDevWriter,
  readMediaDimsFromSrc,
} from './scripts/dev-assets.mjs';
import { contentHmrGate, suppressContentHmr } from './scripts/content-hmr-gate.mjs';
import { publishDevWriter } from './scripts/dev-publish.mjs';
import { issueDevWriter } from './scripts/dev-issue.mjs';
import { commitEngineDevWriter } from './scripts/dev-commit-engine.mjs';
import { mediaCollectorIntegration } from './scripts/collect-shipped-assets.mjs';
import { productionBoundary } from './scripts/production-boundary.mjs';
import {
  TOKENS_RELATIVE_PATH,
  CSS_RELATIVE_PATH,
  generateTokenBlock,
  applyTokenBlock,
} from './scripts/build-tokens.mjs';
import { homeRevealConfigWriter } from './scripts/home-reveal-config-writer.mjs';
import { awardBlockSizeWriter } from './scripts/award-block-size-writer.mjs';
import { carouselDragTuningWriter } from './scripts/carousel-drag-tuning-writer.mjs';
import { signupDevApi } from './scripts/signup-dev-api.mjs';
import { annotationDevWriter } from './scripts/dev-annotations.mjs';
import { componentNotesDevApi } from './scripts/dev-component-notes.mjs';
import { resolveContentTarget } from './src/lib/devContentTarget.mjs';
import { imageDescriptionsDevWriter } from './scripts/dev-image-descriptions.mjs';
import { devInspectors, lapseInstalled } from './scripts/dev-inspectors.mjs';
import {
  createContentHandlers, IMAGE_VIEWPORTS, isSafePathPart, normalizeConstrainValue, isAllowedAspectRatio,
  applyCropChangeFromSource as applyCropWithDimensions,
} from './src/lib/contentAuthoring.mjs';
export { applyCropChange, syncOutlineForSectionMutation } from './src/lib/contentAuthoring.mjs';
export const applyCropChangeFromSource = (data, change) => applyCropWithDimensions(data, change, readMediaDimsFromSrc);

function contentDevWriter(key, maxBytes, tooLarge) {
  const handlers = createContentHandlers({
    readDocument: readDevDocument, writeDocument: writeDevDocument, resolveDocument: resolveEditableDocument,
    resolveFieldTarget: resolveDevFieldTarget, readMediaDimensions: readMediaDimsFromSrc,
    buildImageSection, buildImageSectionFromSrcs, buildImageGridSection, buildImageGridSectionFromSrcs,
    buildImageCarouselSection, buildImageCarouselSectionFromSrcs, fillPlaceholderImageSection,
    sameSection: isDeepStrictEqual,
  });
  return {
    name: `${key}-dev-writer`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`/api/${key}`, async (req, res, next) => {
        if (req.method !== 'POST') return next();
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
            if (size > maxBytes) return send(413, { error: tooLarge });
            chunks.push(chunk);
          }
          await handlers[key](JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), send);
        } catch {
          send(400, { error: 'The update could not be read.' });
        }
      });
    },
  };
}

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
          const result = await applyCropChangeFromSource(data, body);
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
            const value = normalizeConstrainValue(requestedConstrained[viewport]);
            if (value === null) {
              send(400, { error: 'Use a constrain width of 30–90% (or None).' });
              return;
            }
            constrained[viewport] = value;
          }

          const defaultAspectRatio = String(body.defaultAspectRatio || '');
          if (!isAllowedAspectRatio(defaultAspectRatio)) {
            send(400, { error: 'Use a supported default aspect ratio.' });
            return;
          }

          const data = await readDevDocument(target.relativeFile);
          let resolvedPath;
          try {
            resolvedPath = resolveContentTarget(data, fieldPath, body.target);
          } catch (error) {
            send(400, { error: error instanceof Error ? error.message : 'That grid is not editable.' });
            return;
          }

          let node = data;
          for (const part of resolvedPath) {
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
          await writeAtomicJson(tokensFile, tokensJson);
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
  return contentDevWriter('content-text', 100_000, 'The text update is too large.');
}


/**
 * Dev-only batch writer so staged image/grid/text/layout edits hit disk in one
 * write per document (avoids mid-save HMR wiping later changes).
 *
 * @returns {import('vite').Plugin}
 */
function contentBatchDevWriter() {
  return contentDevWriter('content-batch', 500_000, 'The batch update is too large.');
}

/**
 * Dev-only writer for project section layout fields. Same document allowlist
 * as text edits; creates `spacing` or `introHeight` on the section when missing.
 *
 * @returns {import('vite').Plugin}
 */
/**
 * Dev-only writer that inserts or deletes sections in a project document's
 * `sections` array (used by the on-page “+” / delete controls).
 *
 * @returns {import('vite').Plugin}
 */
export function contentSectionDevWriter() {
  return contentDevWriter('content-section', 10_000, 'The section update is too large.');
}

function contentSpacingDevWriter() {
  return contentDevWriter('content-spacing', 20_000, 'The layout update is too large.');
}

/**
 * Dev-only writer for project section nav trees + sectionId / showTitle patches.
 *
 * @returns {import('vite').Plugin}
 */
export function contentNavDevWriter() {
  return contentDevWriter('content-nav', 100_000, 'The nav update is too large.');
}

// https://astro.build/config
/**
 * Lapse (the dev-only animation inspector) resolves from a private registry that
 * needs a token in a machine-local ~/.npmrc. Machines without that token (CI,
 * cloud agents, a fresh contributor) have no way to install it, so the package
 * is declared `optional` and is simply absent there.
 *
 * Astro still walks every `<script>` it finds — the `{showDevTools && ...}` guard
 * in Layout.astro gates *rendering*, not bundling — so Vite/Rollup tries to
 * resolve `@aiforui/lapse/*` and hard-fails when it is missing. In a production
 * build that fails `astro build`; under `astro dev` it throws a resolve error
 * overlay on *every* page, which is what makes the dev server unusable wherever
 * the private package is absent.
 *
 * So: in a production build always stub — Lapse is dev-only and never rendered
 * in prod, and stubbing also drops the ~800KB Lapse+React orphan chunk that was
 * emitted into every deploy and referenced by nothing. Under `astro dev` stub
 * only when the package is genuinely absent, so a machine that *does* have it
 * (Anto's local, with the token) keeps the real inspector.
 *
 * @returns {import('vite').Plugin}
 */
export function stubLapseWhenUnavailable() {
  const PREFIX = '\0vcd-lapse-stub:';
  const stubbed = new Set(['@aiforui/lapse/install', '@aiforui/lapse/panel']);
  let command = 'serve';
  return {
    name: 'vcd-stub-lapse',
    enforce: 'pre',
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      if (!stubbed.has(id)) return null;
      return command === 'build' || !lapseInstalled ? PREFIX + id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      // Same shape lapseDev.ts imports, so the module still type-checks and the
      // (never-rendered) script is inert rather than throwing.
      return 'export const getSharedEngine = () => ({ registerGSAP() {} });\n'
        + 'export const mountLapse = () => {};\n';
    },
  };
}

const isolatedViteCommandCache = () => ({
  name: 'isolated-vite-command-cache',
  hooks: {
    'astro:config:setup': ({ config, command, updateConfig }) => {
      updateConfig({
        vite: {
          cacheDir: fileURLToPath(new URL(`./node_modules/.vite-${command}/`, config.root)),
        },
      });
    },
  },
});

export default defineConfig({
  // Absolute base for canonical links and og:image URLs. Social scrapers and
  // search engines both reject relative ones, so this has to be a real origin.
  site: process.env.PUBLIC_SITE_URL || 'https://vicentecr.uz',
  devToolbar: { enabled: false },
  integrations: [
    // A dev restart reruns Astro's content sync on a temp hmr:false server that
    // shares these plugin objects; with static babel options @vitejs/plugin-react 5
    // then deletes its `transform` while the live server still has it cached
    // ("Cannot read properties of undefined (reading 'call')"). A babel function
    // skips that branch. Drop once off @vitejs/plugin-react 5 (Astro 7 upgrade).
    react({ babel: () => ({}) }),
    mediaCollectorIntegration(),
    devInspectors(),
    isolatedViteCommandCache(),
  ],
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
      productionBoundary(),
      devAuthoringState(),
      devAuthoringRequestQueue(),
      branchUpdateDevWriter(),
      stubLapseWhenUnavailable(),
      contentHmrGate(),
      mediaDevServer(),
      uploadDevWriter(),
      imageDescriptionsDevWriter(),
      assetsDevWriter(),
      projectCreateDevWriter(),
      projectDeleteDevWriter(),
      projectRenameDevWriter(),
      projectRouteWatcher(),
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
      annotationDevWriter(),
      componentNotesDevApi(),
      contentSpacingDevWriter(),
      contentSectionDevWriter(),
      contentBatchDevWriter(),
      contentNavDevWriter(),
      homeRevealConfigWriter(),
      awardBlockSizeWriter(),
      signupDevApi(),
      ...(process.env.NODE_ENV === 'production' ? [] : [carouselDragTuningWriter()]),
    ],
    // Every client dep must be listed: a dep discovered on first load makes Vite
    // re-optimise and send full-reload, which contentHmrGate drops, so the open tab
    // keeps stale dep URLs and its next navigation 504s under a stuck veil.
    optimizeDeps: {
      include: [
        'gsap', 'gsap/SplitText', 'gsap/CustomEase', 'color-dialog-box', 'drawesome', 'media-chrome', '@ybouane/liquidglass',
        'astro/virtual-modules/transitions-router.js',
        'astro/virtual-modules/transitions-types.js',
        'astro/virtual-modules/transitions-events.js',
        'astro/virtual-modules/transitions-swap-functions.js',
      ],
    },
    server: {
      watch: {
        // Content + media are not Vite modules. Watching them fires
        // full-reloads on Save / branch-sync pulls — calm HMR (contentHmrGate)
        // also drops full-reload WS, but ignoring here keeps the watcher quiet.
        // Manual refresh when you want new content.
        ignored: [
          // Agent worktrees nest inside the primary checkout: their astro.config.mjs
          // and tsconfig.json would restart / full-reload this server. Anchored to
          // this root so a worktree's own server still watches itself.
          fileURLToPath(new URL('./.claude/worktrees/', import.meta.url)) + '**',
          '**/ROADMAP.md',
          '**/sitemap/**',
          '**/src/content/**',
          '**/media/**',
        ],
      }
    }
  }
});
