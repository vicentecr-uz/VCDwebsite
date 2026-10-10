import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dev } from 'astro';
import { parse } from 'parse5';
import config from '../../astro.config.mjs';
import { contentHmrGate } from '../content-hmr-gate.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));

function menuLinks(html) {
  const links = [];
  const text = (node) => node.value ?? (node.childNodes ?? []).map(text).join('');
  const visit = (node) => {
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    if (node.tagName === 'a' && attrs.class?.split(' ').includes('header-menu__link')) {
      links.push({ label: text(node).trim(), href: attrs.href });
    }
    (node.childNodes ?? []).forEach(visit);
  };
  visit(parse(html));
  return links;
}

test('a running Astro header renders saved and externally updated settings without restarting', { timeout: 30_000 }, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vcd-header-ssr-')));
  const previous = process.cwd();
  let server;
  try {
    await cp(path.join(repo, 'src'), path.join(root, 'src'), { recursive: true });
    await rm(path.join(root, 'src/pages'), { recursive: true });
    await mkdir(path.join(root, 'src/pages'));
    await mkdir(path.join(root, 'media'));
    await cp(path.join(repo, 'media/LG Square.svg'), path.join(root, 'media/LG Square.svg'));
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeFile(path.join(root, 'src/components/TestShell.astro'), '---\nconst html = await Astro.slots.render("default");\n---\n<html><body set:html={html} /></html>');
    const page = '---\nimport Header from "../components/Header.astro";\nimport Shell from "../components/TestShell.astro";\n---\n<Shell><Header /></Shell>';
    await writeFile(path.join(root, 'src/pages/index.astro'), page);
    await writeFile(path.join(root, 'src/pages/about.astro'), page);
    const settingsFile = path.join(root, 'src/content/settings/header.json');
    const settings = {
      siteTitle: 'Vicente Cruz', logoPath: '/images/LG%20Square.svg',
      menuLinks: [{ label: 'Work', href: '/' }, { label: 'Play', href: '/play' }, { label: 'About', href: '/about' }],
    };
    await writeFile(settingsFile, JSON.stringify(settings));
    process.chdir(root);
    const writers = ['content-text-dev-writer', 'content-batch-dev-writer'].map((name) => {
      const plugin = config.vite.plugins.find((entry) => entry?.name === name);
      assert.ok(plugin, `missing ${name}`);
      return plugin;
    });
    server = await dev({
      root, configFile: false, logLevel: 'silent', devToolbar: { enabled: false },
      server: { host: '127.0.0.1', port: 0 },
      vite: { plugins: [contentHmrGate(), ...writers], server: { watch: { ignored: ['**/src/content/**', '**/media/**'] } } },
    });
    const origin = `http://127.0.0.1:${server.address.port}`;
    const expectMenu = async (expected, route = '/') => {
      const response = await fetch(`${origin}${route}`);
      const html = await response.text();
      assert.equal(response.status, 200, html.slice(0, 500));
      assert.deepEqual(menuLinks(html), [...expected, ...expected]);
    };
    const save = async (endpoint, body) => {
      const response = await fetch(`${origin}/api/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, await response.text());
    };
    const change = (index, field, value) => ({ document: 'header-settings', path: ['menuLinks', index, field], value });

    await expectMenu(settings.menuLinks);
    await save('content-text', { changes: [change(0, 'label', 'Physical'), change(1, 'label', 'Digital')] });
    settings.menuLinks[0].label = 'Physical';
    settings.menuLinks[1].label = 'Digital';
    assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), settings);
    await expectMenu(settings.menuLinks);

    await save('content-batch', { text: [change(1, 'href', '/digital')] });
    settings.menuLinks[1].href = '/digital';
    assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), settings);
    await expectMenu(settings.menuLinks);
    await expectMenu(settings.menuLinks, '/about');

    settings.menuLinks[1] = { label: 'Software', href: '/software' };
    await writeFile(settingsFile, JSON.stringify(settings));
    await expectMenu(settings.menuLinks);

    await writeFile(settingsFile, '{invalid');
    const broken = await (await fetch(origin)).text();
    assert.deepEqual(menuLinks(broken), []);
    assert.doesNotMatch(broken, /<header/);
    await writeFile(settingsFile, JSON.stringify(settings));
    await expectMenu(settings.menuLinks);
  } finally {
    await server?.stop();
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
