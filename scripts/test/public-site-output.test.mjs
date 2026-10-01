import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectShippedAssets } from '../collect-shipped-assets.mjs';
import { prunePublicOutput } from '../public-site-output.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-public-output-'));
  const put = async (relative, contents = '') => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  return { root, put };
}

const site = 'https://example.test';

test('keeps navigation closure, redirect aliases, embedded documents, and transitive generated assets', async () => {
  const { root, put } = await fixture();
  await put('index.html', '<link rel="canonical" href="/private/"><a href="/about/?from=home#top">About</a><a href="https://example.test/work/">Work</a><iframe src="/embed/"></iframe><script src="_astro/home.js"></script><!-- /private/ -->');
  await put('about/index.html', '<a href="/multi/">Continue</a>');
  await put('multi/index.html', '<a href="/unlisted/">Reachable text link</a>');
  await put('unlisted/index.html', 'reachable');
  await put('work/index.html', '<area href="/about/">');
  await put('embed/index.html', '<a href="/about/">embedded</a>');
  await put('cycle-a/index.html', '<a href="/cycle-b/">cycle</a>');
  await put('cycle-b/index.html', '<a href="/cycle-a/">cycle</a>');
  await put('private/index.html', '<img src="/images/private-figure.png">');
  await put('private-alias/index.html', '<meta http-equiv="refresh" content="0;url=/private/"><p>real page content</p><a href="/private/">Continue</a>');
  await put('alias/index.html', '<meta http-equiv="refresh" content="0;url=/"><script>location.replace("/")</script><a href="/">Continue</a>');
  await put('external/index.html', '<meta http-equiv="refresh" content="0;url=https://social.example/profile"><a href="https://social.example/profile">Continue</a>');
  await put('404.html', 'Not found');
  await put('_astro/home.js', 'import "./shared.css"; const p = "./transitive.js";');
  await put('_astro/shared.css', 'body { background: url("/images/shared-cover.svg"); }');
  await put('_astro/transitive.js', 'const image = "/images/shared-cover.svg";');
  await put('_astro/private.js', 'const image = "/images/private-figure.png";');
  await put('_astro/orphan.css', 'body {}');
  const result = await prunePublicOutput(root, { site });
  assert.ok(result.retainedHtml.includes('index.html'));
  for (const route of ['about/index.html', 'multi/index.html', 'unlisted/index.html', 'work/index.html', 'embed/index.html', 'alias/index.html', 'external/index.html', '404.html']) assert.ok(result.retainedHtml.includes(route), route);
  for (const route of ['cycle-a/index.html', 'cycle-b/index.html', 'private/index.html', 'private-alias/index.html']) assert.ok(result.removedHtml.includes(route), route);
  for (const asset of ['_astro/home.js', '_astro/shared.css', '_astro/transitive.js']) assert.ok(result.retainedAssets.includes(asset), asset);
  for (const asset of ['_astro/private.js', '_astro/orphan.css']) assert.ok(result.removedAssets.includes(asset), asset);

  const media = path.join(root, 'media');
  await put('media/shared-cover.svg', 'shared');
  await put('media/private-figure.png', 'private');
  const shipped = await collectShippedAssets(root, media);
  assert.equal(shipped.copied, 1);
  assert.equal(await readFile(path.join(root, 'images/shared-cover.svg'), 'utf8'), 'shared');
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
