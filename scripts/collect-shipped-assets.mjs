// @ts-check
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
        const projectsDir = path.join(process.cwd(), 'src/content/projects');
        const publicRoutes = [];
        for (const file of (await readdir(projectsDir).catch(() => [])).filter((name) => name.endsWith('.json'))) {
          const data = JSON.parse(await readFile(path.join(projectsDir, file), 'utf8'));
          if ((data.status ?? 'published') === 'published') {
            publicRoutes.push(`/${path.basename(file, '.json')}/`);
          }
        }
        const output = await prunePublicOutput(distDir, { site, assetsDir, publicRoutes });
        console.log(
          `public output: retained ${output.retainedHtml.length} HTML page(s) `
          + `(${output.linkOnlyHtml.length} link-only), removed ${output.removedHtml.length}; removed ${output.removedAssets.length} generated asset(s)`,
        );
        const demoAssets = await readPublishedDemoAssets({
          distDir,
          projectsDir,
          mediaDir,
          retainedHtml: output.retainedHtml,
        });
        await injectPublishedDemoAssets(distDir, demoAssets, output.retainedHtml);
        await collectShippedAssets(distDir, mediaDir);
      },
    },
  };
}
