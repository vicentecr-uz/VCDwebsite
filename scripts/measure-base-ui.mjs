import { mkdir, readFile, readdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve, join, basename, relative } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'parse5';

const root = process.cwd();
const directory = resolve(root, '.dev-session/base-ui-measurement');
await mkdir(directory, { recursive: true });
const configPath = join(directory, 'measurement.config.mjs');
const snapshot = join(directory, 'generated');
const originalConfig = pathToFileURL(resolve(root, 'astro.config.mjs')).href;

// Capture generated code before the normal publication filter removes this unlinked study page.
await writeFile(configPath, `
import config from ${JSON.stringify(originalConfig)};
import { mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export default { ...config, integrations: [...config.integrations, {
  name: 'measure-base-ui', hooks: { 'astro:build:generated': async ({ dir }) => {
    const source = fileURLToPath(dir);
    await mkdir(${JSON.stringify(snapshot)}, { recursive: true });
    await cp(source + '/_astro', ${JSON.stringify(snapshot + '/_astro')}, { recursive: true, force: true });
    await cp(source + '/base-ui/index.html', ${JSON.stringify(snapshot + '/comparison.html')});
  } }
}] };
`);

if (!process.argv.includes('--read-snapshot')) {
  await rm(snapshot, { recursive: true, force: true });
  const build = spawnSync(process.execPath, ['run', 'astro', 'build', '--config', relative(root, configPath)], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status || 1);
}

const html = await readFile(join(snapshot, 'comparison.html'), 'utf8');
const assets = await readdir(join(snapshot, '_astro'));
const island = html.match(/component-url="([^"]+)"[^>]*renderer-url="([^"]+)"/);
if (!island) throw new Error('Expected a hydrated Base UI island in the generated comparison page.');
const islandRoots = island.slice(1, 3).map(value => basename(value));
const currentRoots = assets.filter(name => /^(CurrentExample|SelectField|TextField|DevOverlay|DevPanelDrag)\.astro_/.test(name) && name.endsWith('.js'));
if (!currentRoots.length) throw new Error('No current-component entrypoints found. Check Astro output naming.');
const inline = { current: [], hydration: [] };
const visitHtml = node => {
  if (node.tagName === 'script' && !node.attrs.some(attr => attr.name === 'src')) {
    const code = (node.childNodes || []).map(child => child.value || '').join('');
    const group = /data-current-example|data-dev-panel-draggable/.test(code) ? 'current' : 'hydration';
    inline[group].push(code);
  }
  for (const child of node.childNodes || []) visitHtml(child);
};
visitHtml(parse(html));
const inlineSizes = code => ({ raw: Buffer.byteLength(code), gzip: gzipSync(code).length, brotli: brotliCompressSync(code).length });

async function closure(roots) {
  const found = new Set();
  const visit = async name => {
    if (found.has(name)) return;
    if (!assets.includes(name)) throw new Error(`Missing generated module ${name}`);
    found.add(name);
    const text = await readFile(join(snapshot, '_astro', name), 'utf8');
    for (const match of text.matchAll(/["'](?:\.\/|\/_astro\/)([^"']+\.js)["']/g)) await visit(match[1]);
  };
  for (const name of roots) await visit(name);
  return [...found].sort();
}
async function sizes(files, base = join(snapshot, '_astro')) {
  let raw = 0, gzip = 0, brotli = 0;
  for (const name of files) {
    const buffer = await readFile(join(base, name));
    raw += buffer.length;
    gzip += gzipSync(buffer).length;
    brotli += brotliCompressSync(buffer).length;
  }
  return { raw, gzip, brotli, files };
}
const baseFiles = await closure(islandRoots);
const rendererFiles = await closure([islandRoots[1]]);
const currentFiles = await closure(currentRoots);
const common = baseFiles.filter(file => currentFiles.includes(file));
const publicAssets = (await readdir(resolve(root, 'dist/_astro'))).filter(name => /\.(js|css)$/.test(name));
const baselineDir = resolve(root, '.dev-session/baseline-output/_astro');
let baseline = null;
try { baseline = await sizes((await readdir(baselineDir)).filter(name => /\.(js|css)$/.test(name)), baselineDir); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const result = {
  method: 'Per-file compression of production Astro JS module closures before publication pruning. Base includes all study variants plus React renderer. Current covers external Astro control scripts; inline control/demo scripts and Astro hydration bootstrap are reported separately as independently compressed estimates. Shared CSS/HTML, comparison notes and safe-viewport page script are excluded from these component totals. Not a runtime network or parse-time measurement.',
  baseUi: await sizes(baseFiles),
  reactRenderer: await sizes(rendererFiles),
  baseUiExamplesIncremental: await sizes(baseFiles.filter(file => !rendererFiles.includes(file))),
  current: await sizes(currentFiles),
  currentInline: inlineSizes(inline.current.join('\n')),
  hydrationInline: inlineSizes(inline.hydration.join('\n')),
  shared: await sizes(common),
  additionalStudyJs: await sizes(baseFiles.filter(file => !currentFiles.includes(file))),
  retainedPublicAssets: await sizes(publicAssets, resolve(root, 'dist/_astro')),
  baselinePublicAssets: baseline,
  baseUiModulesRetainedPublic: baseFiles.filter(file => publicAssets.includes(file)),
};
await writeFile(join(directory, 'results.json'), JSON.stringify(result, null, 2) + '\n');
await copyFile(join(directory, 'results.json'), resolve(root, '.dev-session/base-ui-results.json'));
console.log(JSON.stringify(result, null, 2));
