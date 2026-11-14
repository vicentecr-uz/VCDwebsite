import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkProductionOutput } from '../check-production-output.mjs';
import { productionBoundary } from '../production-boundary.mjs';

const checker = join(process.cwd(), 'scripts/check-production-output.mjs');

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'production-boundary-'));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

test('accepts safe public HTML, JS, CSS, and style primitive examples', async () => {
  const root = await fixture({
    'index.html': '<main data-dev-example="public">SelectField TextField DevOverlay</main>',
    'styles/page.css': '.field { color: oklch(70% 0.1 220); }',
    'scripts/page.js': 'const label = "data-dev-image-drop is documented text";',
  });
  try { assert.deepEqual(await checkProductionOutput(root), { htmlFiles: 1, textFiles: 3 }); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects missing or empty output', async () => {
  const missing = await mkdtemp(join(tmpdir(), 'production-boundary-'));
  try { await assert.rejects(checkProductionOutput(missing), /index\.html: missing/); }
  finally { await rm(missing, { recursive: true, force: true }); }

  const empty = await fixture({ 'index.html': ' \n' });
  try { await assert.rejects(checkProductionOutput(empty), /index\.html: empty/); }
  finally { await rm(empty, { recursive: true, force: true }); }

  try { await assert.rejects(checkProductionOutput(join(missing, 'does-not-exist')), /missing production output directory/); }
  finally { await rm(missing, { recursive: true, force: true }); }
});

test('rejects orphan inspector payloads without a page reference', async () => {
  const root = await fixture({
    'index.html': '<main>Public page</main>',
    'assets/orphan.js': 'import "@aiforui/lapse"; const panel = "data-lapse-panel";',
  });
  try { await assert.rejects(checkProductionOutput(root), /assets\/orphan\.js: development inspector marker/); }
  finally { await rm(root, { recursive: true, force: true }); }

  const agentation = await fixture({ 'index.html': '<main>Public page</main>', 'assets/orphan.mjs': 'const root = "agentation-root";' });
  try { await assert.rejects(checkProductionOutput(agentation), /assets\/orphan\.mjs: development inspector marker/); }
  finally { await rm(agentation, { recursive: true, force: true }); }
});

test('rejects authoring controls and writer endpoints', async () => {
  const html = await fixture({ 'index.html': '<button data-dev-image-drop="true">Upload</button>' });
  try { await assert.rejects(checkProductionOutput(html), /index\.html: authoring control attribute/); }
  finally { await rm(html, { recursive: true, force: true }); }

  const api = await fixture({ 'index.html': '<main>Public</main>', 'app.js': 'fetch("/api/content-projects")' });
  try { await assert.rejects(checkProductionOutput(api), /app\.js: authoring API endpoint/); }
  finally { await rm(api, { recursive: true, force: true }); }
});

test('does not mistake safe textual examples for HTML attributes or routes', async () => {
  const root = await fixture({
    'index.html': '<!-- data-dev-image-drop --><main title="data-dev-image-drop">Use data-dev-image-drop in the docs. Route /api/contentful is public.</main>',
    'styles.css': '.example::before { content: "agentation"; }',
  });
  try { assert.equal((await checkProductionOutput(root)).htmlFiles, 1); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('detects mixed-case authoring attributes on real elements', async () => {
  const root = await fixture({ 'index.html': '<section><button DATA-DEV-IMAGE-PICKER="true">Pick</button></section>' });
  try { await assert.rejects(checkProductionOutput(root), /index\.html: authoring control attribute/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI reports a concise path diagnostic and nonzero status', async () => {
  const root = await fixture({ 'index.html': '<main>Public</main>', 'nested/app.mjs': 'fetch("/api/publish")' });
  const scriptDir = await mkdtemp(join(process.cwd(), 'scripts/test/production boundary-'));
  const spacedChecker = join(scriptDir, 'check production output.mjs');
  await copyFile(checker, spacedChecker);
  try {
    const result = spawnSync(process.execPath, [spacedChecker, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nested\/app\.mjs: authoring API endpoint/);
    assert.doesNotMatch(result.stderr, /fetch\("\/api\/publish"\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(scriptDir, { recursive: true, force: true });
  }
});


test('rejects canvas shell output and orphan canvas scripts', async () => {
  for (const files of [
    { 'index.html': '<main>Public</main>', 'dev/canvas-shell/index.html': '' },
    { 'index.html': '<main>Public</main>', 'assets/canvas.js': 'const name = "vcd-canvas";' },
  ]) {
    const root = await fixture(files);
    try { await assert.rejects(checkProductionOutput(root), /development (canvas route|inspector marker)/); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
});


test('strips the canvas page before its scripts and styles are discovered in production', () => {
  const plugin = productionBoundary();
  assert.equal(plugin.apply, 'build');
  const shell = new URL('../../src/pages/dev/canvas-shell.astro', import.meta.url).pathname;
  assert.equal(plugin.load(shell), '');
  assert.equal(plugin.load(`${shell}?astro&type=script`), '');
  assert.equal(plugin.load(new URL('../../src/layouts/DemoLayout.astro', import.meta.url).pathname), undefined);
});
