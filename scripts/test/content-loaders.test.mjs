import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'bun:test';

const root = path.resolve(import.meta.dirname, '../..');

test('real loaders validate fresh disk data, version and generic project routing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vcd-loaders-'));
  try {
    await mkdir(path.join(dir, 'src/lib'), { recursive: true });
    for (const file of ['projects.ts', 'content-schema.ts', 'craftDemos.ts', 'placeholderCover.mjs']) {
      await cp(path.join(root, 'src/lib', file), path.join(dir, 'src/lib', file));
    }
    await cp(path.join(root, 'sample-content/src/content'), path.join(dir, 'src/content'), { recursive: true });
    await symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
    await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
    const code = `
      import assert from 'node:assert/strict';
      import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
      import { createServer } from 'vite';
      const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null, ws: false }, optimizeDeps: { noDiscovery: true }, ssr: { external: true } });
      try {
        const loaders = await server.environments.ssr.runner.import(process.cwd() + '/src/lib/projects.ts');
        assert.deepEqual(loaders.getProjectSlugsForBuild({ dev: false }).sort(), ['sample-legacy', 'sample-modern']);
        assert.ok(loaders.getEditableProjectDocuments().has('sample-legacy'));
        const file = 'src/content/projects/sample-modern.json';
        const project = JSON.parse(readFileSync(file));
        project.title = 'Saved title';
        writeFileSync(file, JSON.stringify(project));
        assert.equal(loaders.loadProjectBySlug('sample-modern').title, 'Saved title');
        project.sections[0].type = 'unknown';
        writeFileSync(file, JSON.stringify(project));
        assert.throws(() => loaders.loadProjectBySlug('sample-modern'), /sample-modern.json: sections\\[0\\].type/);
        writeFileSync(file, '{');
        assert.throws(() => loaders.loadProjectBySlug('sample-modern'), /sample-modern.json: invalid JSON/);
        writeFileSync('src/content/settings/schema.json', '{"schemaVersion":99}');
        assert.throws(() => loaders.loadPageDocument('home'), /settings\\/schema.json: schemaVersion/);
        unlinkSync('src/content/settings/schema.json');
        assert.ok(loaders.loadPageDocument('home').sections.length);
        writeFileSync('src/content/pages/home.json', '{"sections":[{"type":"unknown"}]}');
        assert.throws(() => loaders.loadPageDocument('home'), /pages\\/home.json: sections\\[0\\].type/);
        unlinkSync('src/content/pages/home.json');
        assert.deepEqual(loaders.loadPageDocument('home'), { sections: [] });
      } finally { await server.close(); }
    `;
    const result = await promisify(execFile)(process.execPath, ['--eval', code], { cwd: dir, timeout: 20000 });
    assert.equal(result.stderr.includes('Error:'), false, result.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
