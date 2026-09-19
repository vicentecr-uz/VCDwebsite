import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import { stubLapseWhenUnavailable } from '../../astro.config.mjs';

async function fixture({ withPackage }) {
  const root = await mkdtemp(join(tmpdir(), 'lapse-production-boundary-'));
  const entry = join(root, 'entry.js');
  await writeFile(entry, [
    "import '@aiforui/lapse/install';",
    "import { getSharedEngine, mountLapse } from '@aiforui/lapse/panel';",
    'getSharedEngine().registerGSAP({});',
    'mountLapse();',
    "export const publicMarker = 'public-code-remains';",
    'console.log(publicMarker);',
  ].join('\n'));

  if (withPackage) {
    const packageRoot = join(root, 'node_modules/@aiforui/lapse');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@aiforui/lapse',
      exports: {
        './install': './install.js',
        './panel': './panel.js',
      },
      type: 'module',
    }));
    await writeFile(join(packageRoot, 'install.js'), "console.log('lapse-package-install');");
    await writeFile(join(packageRoot, 'panel.js'), [
      "console.log('lapse-package-panel');",
      "export const getSharedEngine = () => ({ registerGSAP() {} });",
      "export const mountLapse = () => 'lapse-package-panel';",
      "export const packageMarker = 'lapse-package-panel';",
    ].join('\n'));
  }

  return root;
}

async function buildFixture(root) {
  const result = await build({
    root,
    plugins: [stubLapseWhenUnavailable()],
    build: {
      write: false,
      minify: false,
      rollupOptions: { input: join(root, 'entry.js') },
    },
  });
  const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
  return outputs.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n');
}

test('stubs Lapse before Vite can bundle an installed optional package', async () => {
  const root = await fixture({ withPackage: true });
  try {
    const output = await buildFixture(root);
    assert.match(output, /public-code-remains/);
    assert.doesNotMatch(output, /lapse-package-(?:install|panel)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stubs Lapse when the optional package is absent', async () => {
  const root = await fixture({ withPackage: false });
  try {
    const output = await buildFixture(root);
    assert.match(output, /public-code-remains/);
    assert.doesNotMatch(output, /lapse-package-(?:install|panel)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
