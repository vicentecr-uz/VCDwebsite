import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = join(process.cwd(), 'scripts/dev-inspectors.mjs');

async function loadFixture({ withLapse }) {
  const root = await mkdtemp(join(tmpdir(), 'dev-inspectors-'));
  const modulePath = join(root, 'scripts/dev-inspectors.mjs');
  await mkdir(dirname(modulePath), { recursive: true });
  await cp(source, modulePath);
  if (withLapse) {
    const packageRoot = join(root, 'node_modules/@aiforui/lapse');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@aiforui/lapse',
      exports: { './panel': './panel.js' },
      type: 'module',
    }));
    await writeFile(join(packageRoot, 'panel.js'), 'export const marker = true;');
  }
  const module = await import(`${pathToFileURL(modulePath)}?fixture=${withLapse}`);
  return { root, module };
}

async function runHook(module, command) {
  const scripts = [];
  const configs = [];
  module.devInspectors().hooks['astro:config:setup']({
    command,
    injectScript: (stage, content) => scripts.push({ stage, content }),
    updateConfig: (config) => configs.push(config),
  });
  return { scripts, configs };
}

for (const command of ['dev', 'build', 'preview', 'sync']) {
  test(`shared inspectors are ${command === 'dev' ? 'available' : 'excluded'} during ${command}`, async () => {
    const { root, module } = await loadFixture({ withLapse: true });
    try {
      const { scripts, configs } = await runHook(module, command);
      if (command !== 'dev') {
        assert.deepEqual(scripts, []);
        assert.deepEqual(configs, []);
        return;
      }
      assert.deepEqual(scripts.map(({ stage }) => stage), ['page']);
      const content = scripts.map(({ content }) => content).join('\n');
      assert.match(content, /\/src\/lib\/agentationDev/);
      assert.match(content, /\/src\/lib\/lapseDev/);
      assert.deepEqual(configs, [{
        vite: {
          optimizeDeps: {
            include: ['agentation', '@aiforui/lapse/install', '@aiforui/lapse/panel'],
          },
          server: {
            warmup: {
              clientFiles: ['./src/lib/lapseDev.ts', './src/lib/agentationDev.ts'],
            },
          },
        },
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('missing private Lapse package keeps Agentation prebundled and both inspectors injected', async () => {
  const { root, module } = await loadFixture({ withLapse: false });
  try {
    assert.equal(module.lapseInstalled, false);
    const { scripts, configs } = await runHook(module, 'dev');
    assert.equal(scripts.length, 1);
    assert.match(scripts[0].content, /agentationDev/);
    assert.match(scripts[0].content, /lapseDev/);
    assert.deepEqual(configs, [{
      vite: {
        optimizeDeps: { include: ['agentation'] },
        server: {
          warmup: {
            clientFiles: ['./src/lib/lapseDev.ts', './src/lib/agentationDev.ts'],
          },
        },
      },
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
