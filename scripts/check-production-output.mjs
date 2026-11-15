import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { init, parse as parseImports } from 'es-module-lexer';
import { extname, relative, resolve, sep } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.map']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs']);
const PLAYGROUND = 'preview/editor-playground/index.html';
const OUTPUT_ORIGIN = 'https://output.invalid';
const PLAYGROUND_POLICY = {
  'connect-src': "'none'",
  'form-action': "'none'",
  'worker-src': "'none'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'frame-src': "'self'",
};
const INSPECTOR_MARKERS = [
  '@aiforui/lapse',
  'data-lapse-panel',
  'data-agentation',
  'agentation-root',
  '/src/lib/agentationDev',
  '/src/lib/lapseDev',
];
const AUTHORING_CONTROLS = new Set([
  'data-dev-text-actions',
  'data-dev-image-drop',
  'data-dev-image-picker',
  'data-dev-new-project',
  'data-dev-asset-manager',
  'data-dev-image-descriptions',
  'data-dev-gallery-pages',
  'data-dev-project-grid-editor',
]);
const AUTHORING_API = /\/api\/(?:content-[a-z-]+|project-[a-z-]+|dev-[a-z-]+|image-(?:crop|description(?:s|-save))|publish(?:-styles)?|upload|assets|gallery-membership|listing-order|style-token(?:-commit)?|commit-engine|award-block-size)(?=$|[/?#"'`\\\s])/;

async function collectFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path, root));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push({ path, relative: relative(root, path).split(sep).join('/') });
    }
  }

  return files;
}

function violation(file, category, guidance) {
  return new Error(`${file}: ${category}; ${guidance}`);
}

function checkText(text, file, authoringAllowed) {
  for (const marker of INSPECTOR_MARKERS) {
    if (text.includes(marker)) {
      throw violation(file, 'development inspector marker', 'remove development tooling from the production bundle');
    }
  }

  const apiMatch = text.match(AUTHORING_API);
  if (apiMatch && !authoringAllowed) {
    throw violation(file, 'authoring API endpoint', `remove emitted authoring route ${apiMatch[0]}`);
  }
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

function attr(node, name) {
  return node?.attrs?.find((attribute) => attribute.name === name)?.value;
}

function checkControls(document, file) {
  walk(document, (node) => {
    for (const { name } of node.attrs ?? []) {
      if (AUTHORING_CONTROLS.has(name)) {
        throw violation(file, 'authoring control attribute', `remove ${name} from emitted HTML`);
      }
    }
  });
}

function checkPlaygroundPolicy(document) {
  const html = document.childNodes.find((node) => node.tagName === 'html');
  const head = html?.childNodes.find((node) => node.tagName === 'head');
  const nodes = head?.childNodes ?? [];
  const policy = nodes.find((node) => node.tagName === 'meta' && attr(node, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (attr(html, 'data-editor-playground') === undefined || !policy
    || nodes.slice(0, nodes.indexOf(policy)).some((node) => node.tagName === 'script')) {
    throw violation(PLAYGROUND, 'missing playground boundary', 'mark the playground document and set its CSP before scripts');
  }
  const directives = (attr(policy, 'content') ?? '').toLowerCase().split(';').map((value) => value.trim().split(/\s+/));
  for (const [name, value] of Object.entries(PLAYGROUND_POLICY)) {
    const entries = directives.filter(([directive]) => name === directive);
    if (entries.length !== 1 || entries[0].slice(1).join(' ') !== value) {
      throw violation(PLAYGROUND, 'unsafe playground policy', `require ${name} ${value}`);
    }
  }
}

function importReferences(source) {
  // Vite emits literal module imports; extend this if production adds runtime module loaders.
  return parseImports(source)[0].flatMap(({ n }) => n ? [n] : []);
}

function documentScripts(document) {
  const scripts = [];
  walk(document, (node) => {
    if (node.tagName === 'script') {
      const type = attr(node, 'type')?.trim().toLowerCase();
      if (type && type !== 'module' && !/^(?:text|application)\/(?:java|ecma)script$/.test(type)) return;
      const src = attr(node, 'src');
      if (src) scripts.push(src);
      else scripts.push(...importReferences((node.childNodes ?? []).map((child) => child.value ?? '').join('')));
    }
    if (node.tagName === 'astro-island') {
      scripts.push(attr(node, 'component-url'), attr(node, 'renderer-url'));
    }
    if (node.tagName === 'link' && attr(node, 'rel')?.toLowerCase() === 'modulepreload') {
      scripts.push(attr(node, 'href'));
    }
  });
  return scripts;
}

function reachableScripts(documents, contents, imports) {
  const siteOrigin = new URL(process.env.PUBLIC_SITE_URL || 'https://vicentecr.uz').origin;
  const seen = new Set();
  const queue = [];
  const add = (references, from) => {
    const base = new URL(`/${from}`, OUTPUT_ORIGIN);
    for (const reference of references) {
      if (!reference) continue;
      let file;
      try {
        const url = new URL(reference, base);
        if (url.origin !== OUTPUT_ORIGIN && url.origin !== siteOrigin) continue;
        file = decodeURIComponent(url.pathname).slice(1);
      } catch { continue; }
      if (!SCRIPT_EXTENSIONS.has(extname(file).toLowerCase()) || !contents.has(file) || seen.has(file)) continue;
      seen.add(file);
      queue.push(file);
    }
  };
  for (const [file, document] of documents) add(documentScripts(document), file);
  for (const file of queue) {
    if (!imports.has(file)) imports.set(file, importReferences(contents.get(file)));
    add(imports.get(file), file);
  }
  return seen;
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
  for (const file of files) contents.set(file.relative, await readFile(file.path, 'utf8'));

  if (!contents.get(index.relative)?.trim()) {
    throw new Error('dist/index.html: empty production entry HTML; build the site before checking output');
  }
  const documents = htmlFiles.map(({ relative: file }) => [file, parse(contents.get(file))]);
  const playground = documents.find(([file]) => file === PLAYGROUND);
  const publicDocuments = documents.filter(([file]) => file !== PLAYGROUND);
  const authoringAllowed = new Set();
  if (playground) {
    checkPlaygroundPolicy(playground[1]);
    await init;
    const imports = new Map();
    const publicScripts = reachableScripts(publicDocuments, contents, imports);
    authoringAllowed.add(PLAYGROUND);
    for (const file of reachableScripts([playground], contents, imports)) {
      if (!publicScripts.has(file)) authoringAllowed.add(file);
    }
  }
  for (const [file, content] of contents) checkText(content, file, authoringAllowed.has(file));
  for (const [file, document] of publicDocuments) checkControls(document, file);

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
