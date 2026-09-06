import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkProductionOutput } from '../check-production-output.mjs';

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
});

test('rejects orphan inspector payloads without a page reference', async () => {
  const root = await fixture({
    'index.html': '<main>Public page</main>',
    'assets/orphan.js': 'import "@aiforui/lapse"; const panel = "data-lapse-panel";',
  });
  try { await assert.rejects(checkProductionOutput(root), /assets\/orphan\.js: development inspector marker/); }
  finally { await rm(root, { recursive: true, force: true }); }
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
    'index.html': '<main>Use data-dev-image-drop in the docs. Route /api/contentful is public.</main>',
    'styles.css': '.example::before { content: "agentation"; }',
  });
  try { assert.equal((await checkProductionOutput(root)).htmlFiles, 1); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI reports a concise path diagnostic and nonzero status', async () => {
  const root = await fixture({ 'index.html': '<main>Public</main>', 'nested/app.mjs': 'fetch("/api/publish")' });
  try {
    const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nested\/app\.mjs: authoring API endpoint/);
    assert.doesNotMatch(result.stderr, /fetch\("\/api\/publish"\)/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
