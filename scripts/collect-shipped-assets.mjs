// @ts-check
/**
 * Derive publication from the build output, not from document status.
 *
 * A draft project emits no page, so its images are never referenced in
 * `dist/`, so they never ship. A teaser project has no `/slug` route in
 * production (#192) but its gallery card does render, so only its cover
 * — not its unreleased case-study imagery — ends up referenced. Scanning
 * the emitted output cannot make the mistake a "walk published + teaser
 * documents" collector would: it can only copy what's actually reachable.
 *
 * `black-token.svg`, `placeholder.svg`, `reddit/avatar_default_*.png`,
 * `press-logos/*` — referenced from `.astro` files, not JSON — are handled
 * for free, because this scans rendered output, not content JSON.
 *
 * Runs once, after `astro build` has written `dist/`. Fails the build if
 * any `/images/...` reference in the output has no matching file in
 * `media/` — a silent skip would turn a content mistake into a production
 * 404 nobody notices.
 */
import { readdir, readFile, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  derivativeKind,
  findOriginal,
  generateDerivativeBuffer,
  isDerivativeToken,
} from './image-derivatives.mjs';
import { prunePublicOutput } from './public-site-output.mjs';
import { injectPublishedDemoAssets, readPublishedDemoAssets } from './public-demo-assets.mjs';

const SCAN_EXTENSIONS = new Set(['.html', '.css', '.js']);
// Deliberately does NOT exclude ')' from the token body — filenames in this
// library legitimately contain literal parentheses (e.g.
// "1Q1A6418 (Custom).jpg"), and encodeURIComponent does not escape '(' or
// ')'. Every real reference in this codebase is quote-delimited (HTML
// attributes, quoted CSS url()), so quote/backtick/whitespace/angle-bracket
// are what actually terminate a token — a comma-separated `srcset` list is
// still handled correctly because the space after each comma is one of
// those terminators.
//
// '&' is excluded because Astro HTML-escapes a literal `"` inside an
// attribute value as `&#34;` (e.g. an inline `style="...url(&#34;/images/
// x.svg&#34;)"` ) — without it the match runs straight through the entity.
//
// '$' is excluded because `projectImage()` itself ships as literal client
// JS source (the dev editor's bundle calls it at runtime): the bundled code
// contains the literal text ``/images/${t.split(...)}`` with nothing real
// between the prefix and the interpolation. Stopping at '$' means that
// occurrence simply produces no match, rather than a phantom token.
//
// The leading (?<![A-Za-z0-9]) guards the other direction: without it, an
// external URL that merely contains the substring "/images/" partway through
// — e.g. https://cdn.example.com/images/tracking.jpg from an embed — would
// be misread as a local ref and fail the build over a file that was never
// ours to ship. A real local ref is always preceded by a quote, backtick,
// whitespace, '(' or the start of the file, never by a host-name character.
const REF_PATTERN = /(?<![A-Za-z0-9])\/images\/[^"'`\s<>&$]+/g;

/** @param {string} dir @returns {Promise<string[]>} */
async function listFilesRecursive(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string} distDir
 * @param {string} mediaDir
 */
export async function collectShippedAssets(distDir, mediaDir) {
  const allFiles = await listFilesRecursive(distDir);
  const scanFiles = allFiles.filter((file) => SCAN_EXTENSIONS.has(path.extname(file).toLowerCase()));

  /** @type {Set<string>} */
  const refs = new Set();
  for (const file of scanFiles) {
    const contents = await readFile(file, 'utf8');
    for (const match of contents.matchAll(REF_PATTERN)) {
      const raw = match[0].slice('/images/'.length);
      if (!raw) continue;
      let token;
      try {
        token = decodeURIComponent(raw);
      } catch {
        continue;
      }
      if (!token || token.includes('..')) continue;
      refs.add(token);
    }
  }

  /** @type {string[]} */
  const missing = [];
  let copied = 0;
  for (const token of refs) {
    const dest = path.join(distDir, 'images', token);

    if (isDerivativeToken(token)) {
      const originalPath = await findOriginal(mediaDir, token);
      if (!originalPath) {
        missing.push(token);
        continue;
      }
      const kind = derivativeKind(token);
      if (!kind) {
        missing.push(token);
        continue;
      }
      const buffer = await generateDerivativeBuffer(originalPath, kind);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buffer);
      copied += 1;
      continue;
    }

    const source = path.join(mediaDir, token);
    try {
      await stat(source);
    } catch {
      missing.push(token);
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
    copied += 1;
  }

  if (missing.length) {
    const list = missing.map((token) => `  - ${token}`).join('\n');
    throw new Error(
      `assets: ${missing.length} referenced image(s) have no file in media/:\n${list}`,
    );
  }

  // Dotfiles are not assets — counting .DS_Store here makes the totals look
  // wrong against `find media -type f` and invites a hunt for a bug.
  const totalInMedia = (await listFilesRecursive(mediaDir))
    .filter((file) => !path.basename(file).startsWith('.')).length;
  console.log(
    `assets: copied ${copied} of ${totalInMedia} files in media/ `
    + `(${totalInMedia - copied} unreferenced, not shipped)`,
  );

  return { copied, total: totalInMedia, refs: [...refs] };
}

/** @returns {import('astro').AstroIntegration} */
export function mediaCollectorIntegration(mediaDirName = 'media') {
  let site;
  let assetsDir = '_astro';
  return {
    name: 'vcd-media-collector',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site;
        assetsDir = config.build?.assets || '_astro';
      },
      'astro:build:done': async ({ dir }) => {
        const distDir = fileURLToPath(dir);
        const mediaDir = path.join(process.cwd(), mediaDirName);
        const output = await prunePublicOutput(distDir, { site, assetsDir });
        console.log(
          `public output: retained ${output.retainedHtml.length} HTML page(s), `
          + `removed ${output.removedHtml.length}; removed ${output.removedAssets.length} generated asset(s)`,
        );
        const demoAssets = await readPublishedDemoAssets({
          distDir,
          projectsDir: path.join(process.cwd(), 'src/content/projects'),
          mediaDir,
          retainedHtml: output.retainedHtml,
        });
        await injectPublishedDemoAssets(distDir, demoAssets, output.retainedHtml);
        await collectShippedAssets(distDir, mediaDir);
      },
    },
  };
}
