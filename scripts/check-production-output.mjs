import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { extname, relative, resolve } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.map']);
const INSPECTOR_MARKERS = [
  '@aiforui/lapse',
  'data-lapse-panel',
  'data-agentation',
  'agentation-root',
  '/src/lib/agentationDev',
  '/src/lib/lapseDev',
];
const AUTHORING_CONTROLS = [
  'data-dev-text-actions',
  'data-dev-image-drop',
  'data-dev-image-picker',
  'data-dev-new-project',
  'data-dev-asset-manager',
  'data-dev-gallery-pages',
  'data-dev-project-grid-editor',
];
const AUTHORING_API = /\/api\/(?:content-[a-z-]+|project-[a-z-]+|dev-[a-z-]+|publish|upload|assets|gallery-membership|listing-order|style-token(?:-commit)?|commit-engine)(?=$|[/?#"'`\\\s])/;

async function collectFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path, root));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push({ path, relative: relative(root, path) });
    }
  }

  return files;
}

function violation(file, category, guidance) {
  return new Error(`${file}: ${category}; ${guidance}`);
}

function checkText(text, file) {
  for (const marker of INSPECTOR_MARKERS) {
    if (text.includes(marker)) {
      throw violation(file, 'development inspector marker', 'remove development tooling from the production bundle');
    }
  }

  const apiMatch = text.match(AUTHORING_API);
  if (apiMatch) {
    throw violation(file, 'authoring API endpoint', `remove emitted authoring route ${apiMatch[0]}`);
  }

  if (file.toLowerCase().endsWith('.html')) {
    const controls = new Set(AUTHORING_CONTROLS);
    const visit = (node) => {
      for (const attribute of node.attrs ?? []) {
        if (controls.has(attribute.name.toLowerCase())) {
          throw violation(file, 'authoring control attribute', `remove ${attribute.name} from emitted HTML`);
        }
      }
      for (const child of node.childNodes ?? []) visit(child);
      for (const child of node.content?.childNodes ?? []) visit(child);
    };
    visit(parse(text));
  }
}

async function collectProductionFiles(root) {
  try {
    return await collectFiles(root);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${root}: missing production output directory; build the site before checking output`);
    }
    throw error;
  }
}

export async function checkProductionOutput(distDir = 'dist') {
  const root = resolve(distDir);
  const files = await collectProductionFiles(root);
  const htmlFiles = files.filter(({ relative: file }) => file.toLowerCase().endsWith('.html'));
  const index = htmlFiles.find(({ relative: file }) => file === 'index.html');

  if (!index) throw new Error('dist/index.html: missing production entry HTML; build the site before checking output');

  const contents = new Map();
  for (const file of files) contents.set(file.path, await readFile(file.path, 'utf8'));

  if (!contents.get(index.path)?.trim()) {
    throw new Error('dist/index.html: empty production entry HTML; build the site before checking output');
  }
  for (const file of files) checkText(contents.get(file.path), file.relative);

  return { htmlFiles: htmlFiles.length, textFiles: files.length };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const distDir = process.argv[2] ?? 'dist';
  try {
    const counts = await checkProductionOutput(distDir);
    console.log(`Production output OK: ${counts.htmlFiles} HTML files, ${counts.textFiles} text files`);
  } catch (error) {
    console.error(`Production output check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
