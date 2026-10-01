import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectShippedAssets } from '../collect-shipped-assets.mjs';
import { prunePublicOutput } from '../public-site-output.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-public-output-'));
  roots.add(root);
  const put = async (relative, contents = '') => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  return { root, put };
}

const site = 'https://example.test';
const roots = new Set();
test.afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

test('keeps navigation closure, redirect aliases, embedded documents, and transitive generated assets', async () => {
  const { root, put } = await fixture();
  await put('index.html', '<link rel="canonical" href="/private/"><a href="/about/?from=home#top">About</a><a href="https://example.test/work/">Work</a><iframe src="/embed/"></iframe><object data="/object/"></object><script src="_assets/home.js"></script><script src="//example.test/_assets/encoded%20file.js"></script><!-- /private/ -->');
  await put('about/index.html', '<a href="/multi/">Continue</a>');
  await put('multi/index.html', '<a href="/unlisted/">Reachable text link</a>');
  await put('unlisted/index.html', 'reachable');
  await put('work/index.html', '<area href="/about/">');
  await put('embed/index.html', '<a href="/about/">embedded</a>');
  await put('object/index.html', '<meta http-equiv="refresh" content="0;url=/unlisted/"><a href="/unlisted/">Continue</a>');
  await put('cycle-a/index.html', '<a href="/cycle-b/">cycle</a>');
  await put('cycle-b/index.html', '<a href="/cycle-a/">cycle</a>');
  await put('private/index.html', '<img src="/images/private-figure.png">');
  await put('private-alias/index.html', '<meta http-equiv="refresh" content="0;url=/private/"><p>real page content</p><a href="/private/">Continue</a>');
  await put('alias/index.html', '<meta http-equiv="refresh" content="0;url=/"><script>location.replace("/")</script><a href="/">Continue</a>');
  await put('external/index.html', '<meta http-equiv="refresh" content="0;url=https://social.example/profile"><a href="https://social.example/profile">Continue</a>');
  await put('404.html', '<a href="/private-from-404/">private</a>');
  await put('private-from-404/index.html', 'private');
  await put('_assets/home.js', 'import "./shared.css"; const p = "./transitive.js"; const preload = "_assets/preload.js";');
  await put('_assets/shared.css', 'body { background: url("/images/shared%20cover.svg"); }');
  await put('_assets/transitive.js', 'const image = "/images/shared%20cover.svg";');
  await put('_assets/preload.js', 'const image = "/images/shared%20cover.svg";');
  await put('_assets/private.js', 'const image = "/images/private-figure.png";');
  await put('_assets/orphan.css', 'body {}');
  await put('_assets/encoded file.js', 'export const encoded = true;');
  await put('_assets/protocol.js', 'export const protocol = true;');
  await put('outside.txt', 'outside');
  await symlink(path.join(root, 'outside.txt'), path.join(root, '_assets', 'outside-link.txt'));
  const result = await prunePublicOutput(root, { site, assetsDir: '_assets' });
  assert.ok(result.retainedHtml.includes('index.html'));
  for (const route of ['about/index.html', 'multi/index.html', 'unlisted/index.html', 'work/index.html', 'embed/index.html', 'object/index.html', 'alias/index.html', 'external/index.html', '404.html']) assert.ok(result.retainedHtml.includes(route), route);
  for (const route of ['cycle-a/index.html', 'cycle-b/index.html', 'private/index.html', 'private-alias/index.html']) assert.ok(result.removedHtml.includes(route), route);
  for (const asset of ['_assets/home.js', '_assets/shared.css', '_assets/transitive.js', '_assets/preload.js']) assert.ok(result.retainedAssets.includes(asset), asset);
  for (const asset of ['_assets/private.js', '_assets/orphan.css', '_assets/protocol.js']) assert.ok(result.removedAssets.includes(asset), asset);
  assert.ok(result.retainedAssets.includes('_assets/encoded file.js'));

  const media = path.join(root, 'media');
  await put('media/shared cover.svg', 'shared');
  await put('media/private-figure.png', 'private');
  const shipped = await collectShippedAssets(root, media);
  assert.equal(shipped.copied, 1);
  assert.equal(await readFile(path.join(root, 'images/shared cover.svg'), 'utf8'), 'shared');
  await assert.rejects(() => readFile(path.join(root, 'images/private-figure.png')));
});

test('fails closed when the root page is absent', async () => {
  const { root, put } = await fixture();
  await put('about/index.html', 'about');
  await assert.rejects(() => prunePublicOutput(root, { site }), /missing root index\.html/);
});

test('retains only technical external redirects and reachable internal aliases', async () => {
  const { root, put } = await fixture();
  await put('index.html', '<a href="/about/">About</a>');
  await put('about/index.html', 'about');
  await put('social/index.html', '<meta http-equiv="refresh" content="0; url=https://social.example/"><a href="https://social.example/">Continue</a>');
  await put('home-alias/index.html', '<meta http-equiv="refresh" content="0;url=/"><a href="/">Continue</a>');
  await put('private-alias/index.html', '<meta http-equiv="refresh" content="0;url=/private/"><a href="/private/">Continue</a>');
  await put('private/index.html', 'private');
  await put('bodyful/index.html', '<meta http-equiv="refresh" content="0;url=https://social.example/"><p>Keep me</p><a href="https://social.example/">Continue</a>');
  const result = await prunePublicOutput(root, { site });
  assert.ok(result.retainedHtml.includes('social/index.html'));
  assert.ok(result.retainedHtml.includes('home-alias/index.html'));
  assert.ok(result.removedHtml.includes('private-alias/index.html'));
  assert.ok(result.removedHtml.includes('bodyful/index.html'));
});
