import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { injectPublishedDemoAssets, readPublishedDemoAssets } from '../public-demo-assets.mjs';
import { prunePublicOutput } from '../public-site-output.mjs';
import { collectShippedAssets } from '../collect-shipped-assets.mjs';
import sharp from 'sharp';

const roots = new Set();
test.afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-public-demo-assets-'));
  roots.add(root);
  const put = async (relative, contents = '') => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  return { root, put };
}

test('catalogs only retained published project images and safely injects the marker', async () => {
  const { root, put } = await fixture();
  const projectsDir = path.join(root, 'projects');
  const mediaDir = path.join(root, 'media');
  await put('index.html', '<a href="/published/">Published</a><a href="/unlisted/">Unlisted</a><a href="/draft/">Draft</a><a href="/legacy/">Legacy</a><a href="/preview/image-framing/">Demo</a>');
  await put('published/index.html', '<main><img data-image-original="/images/folder/foo%20bar.jpg" src="/images/folder/foo.thumb.webp"><img data-image-original="/images/O%27Reilly.jpg" src="/images/O%27Reilly.thumb.webp"><img src="https://cdn.example/images/external.jpg"></main>');
  await put('unlisted/index.html', '<main><img data-image-original="/images/unlisted.png"></main>');
  await put('draft/index.html', '<main><img data-image-original="/images/draft.png"></main>');
  await put('legacy/index.html', '<meta http-equiv="refresh" content="0;url=/published/"><a href="/published/">Continue</a>');
  await put('preview/image-framing/index.html', '<script type="application/json" data-published-demo-assets>[]</script>');
  await put('media/folder/foo bar.jpg', 'foo');
  await put("media/O'Reilly.jpg", 'quote');
  await put('media/unlisted.png', 'unlisted');
  await put('media/draft.png', 'draft');
  await put('media/dormant.png', 'dormant');
  await put('projects/published.json', JSON.stringify({ title: 'Published $& <Demo>', status: 'published', sections: [{ src: 'folder/foo bar.jpg' }, { src: "O'Reilly.jpg" }, { src: 'dormant.png' }, { src: 'https://cdn.example/external.jpg' }, { src: '../escape.png' }] }));
  await put('projects/unlisted.json', JSON.stringify({ title: 'Unlisted', sections: [{ src: 'unlisted.png' }] }));
  await put('projects/draft.json', JSON.stringify({ title: 'Draft', status: 'draft', sections: [{ src: 'draft.png' }] }));
  await put('projects/legacy.json', JSON.stringify({ title: 'Legacy', status: 'published', sections: [{ src: 'folder/foo bar.jpg' }] }));

  const pruned = await prunePublicOutput(root, { site: 'https://example.test' });
  assert.ok(pruned.retainedHtml.includes('unlisted/index.html'));
  const catalog = await readPublishedDemoAssets({ distDir: root, projectsDir, mediaDir, retainedHtml: pruned.retainedHtml });
  assert.deepEqual(catalog, [{
    slug: 'published',
    title: 'Published $& <Demo>',
    images: [{
      src: "O'Reilly.jpg",
      filename: "O'Reilly.jpg",
      url: '/images/O%27Reilly.preview.webp',
      thumb: '/images/O%27Reilly.thumb.webp',
    }, {
      src: 'folder/foo bar.jpg',
      filename: 'foo bar.jpg',
      url: '/images/folder/foo%20bar.preview.webp',
      thumb: '/images/folder/foo%20bar.thumb.webp',
    }],
  }, {
    slug: 'unlisted',
    title: 'Unlisted',
    images: [{ src: 'unlisted.png', filename: 'unlisted.png', url: '/images/unlisted.preview.webp', thumb: '/images/unlisted.thumb.webp' }],
  }]);

  assert.equal(await injectPublishedDemoAssets(root, catalog, pruned.retainedHtml), true);
  const injected = await readFile(path.join(root, 'preview/image-framing/index.html'), 'utf8');
  assert.match(injected, /Published \$& \\u003cDemo>/);
  assert.doesNotMatch(injected, /Published <Demo>/);
});

test('injected catalog drives derivative collection without shipping dormant media', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-public-demo-collector-'));
  roots.add(root);
  const distDir = path.join(root, 'dist');
  const projectsDir = path.join(root, 'projects');
  const mediaDir = path.join(root, 'media');
  const put = async (base, relative, contents) => {
    const file = path.join(base, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer();
  await put(distDir, 'index.html', '<a href="/published/">Published</a><a href="/preview/image-framing/">Demo</a>');
  await put(distDir, 'published/index.html', '<main><img data-image-original="/images/hero.jpg"><img data-image-original="/images/O%27Reilly.jpg"><img data-image-original="/images/icon.svg"></main>');
  await put(distDir, 'preview/image-framing/index.html', '<script type="application/json" data-published-demo-assets>[]</script>');
  await put(projectsDir, 'published.json', JSON.stringify({ title: 'Published $& demo', sections: [{ src: 'hero.jpg' }, { src: "O'Reilly.jpg" }, { src: 'icon.svg' }, { src: 'dormant.png' }] }));
  await put(mediaDir, 'hero.jpg', jpeg);
  await put(mediaDir, "O'Reilly.jpg", jpeg);
  await put(mediaDir, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
  await put(mediaDir, 'dormant.png', jpeg);

  const pruned = await prunePublicOutput(distDir, { site: 'https://example.test' });
  const catalog = await readPublishedDemoAssets({ distDir, projectsDir, mediaDir, retainedHtml: pruned.retainedHtml });
  assert.equal(await injectPublishedDemoAssets(distDir, catalog, pruned.retainedHtml), true);
  const shipped = await collectShippedAssets(distDir, mediaDir);
  assert.ok(shipped.refs.includes('hero.preview.webp'));
  assert.ok(shipped.refs.includes('hero.thumb.webp'));
  assert.ok(shipped.refs.includes("O'Reilly.preview.webp"));
  assert.ok(shipped.refs.includes("O'Reilly.thumb.webp"));
  assert.ok(shipped.refs.includes('icon.svg'));
  for (const file of ['hero.preview.webp', 'hero.thumb.webp', "O'Reilly.preview.webp", "O'Reilly.thumb.webp", 'icon.svg']) {
    await assert.doesNotReject(() => readFile(path.join(distDir, 'images', file)));
  }
  await assert.rejects(() => readFile(path.join(distDir, 'images', 'dormant.png')));
});

test('injects the catalog into retained inline project markers', async () => {
  const { root, put } = await fixture();
  const catalog = [{ slug: 'published', title: 'Published', images: [] }];
  await put('published/index.html', '<main><script type="application/json" data-published-demo-assets>[]</script></main>');
  await put('preview/image-framing/index.html', '<script type="application/json" data-published-demo-assets>[]</script>');

  assert.equal(await injectPublishedDemoAssets(root, catalog, ['published/index.html', 'preview/image-framing/index.html']), true);
  assert.match(await readFile(path.join(root, 'published/index.html'), 'utf8'), /Published/);
  assert.match(await readFile(path.join(root, 'preview/image-framing/index.html'), 'utf8'), /Published/);
});

test('leaves HTML without a marker unchanged', async () => {
  const { root, put } = await fixture();
  const original = '<main><p>no demo here</p></main>';
  await put('plain/index.html', original);

  assert.equal(await injectPublishedDemoAssets(root, [{ slug: 'x', title: 'X', images: [] }], ['plain/index.html']), false);
  assert.equal(await readFile(path.join(root, 'plain/index.html'), 'utf8'), original);
});

test('retained HTML allowlist excludes draft routes', async () => {
  const { root, put } = await fixture();
  await put('published/index.html', '<script type="application/json" data-published-demo-assets>[]</script>');
  await put('draft/index.html', '<script type="application/json" data-published-demo-assets>[]</script>');

  assert.equal(await injectPublishedDemoAssets(root, [{ slug: 'x', title: 'Published', images: [] }], ['published/index.html']), true);
  assert.match(await readFile(path.join(root, 'published/index.html'), 'utf8'), /Published/);
  assert.equal(await readFile(path.join(root, 'draft/index.html'), 'utf8'), '<script type="application/json" data-published-demo-assets>[]</script>');
});

test('updates every marker in one retained HTML file', async () => {
  const { root, put } = await fixture();
  await put('published/index.html', '<script type="application/json" data-published-demo-assets>[]</script><script type="application/json" data-published-demo-assets>[]</script>');

  assert.equal(await injectPublishedDemoAssets(root, [{ slug: 'x', title: 'Published', images: [] }], ['published/index.html']), true);
  const html = await readFile(path.join(root, 'published/index.html'), 'utf8');
  assert.equal((html.match(/Published/g) || []).length, 2);
});

test('rejects symlinks while scanning retained HTML', async () => {
  const { root, put } = await fixture();
  await put('published/index.html', '<script type="application/json" data-published-demo-assets>[]</script>');
  await symlink('published', path.join(root, 'linked-published'));

  await assert.rejects(
    () => injectPublishedDemoAssets(root, [{ slug: 'x', title: 'Published', images: [] }], ['published/index.html']),
    /symlink is not allowed in dist/,
  );
});
