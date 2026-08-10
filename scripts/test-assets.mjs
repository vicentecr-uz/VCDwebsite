// @ts-check
/**
 * Runs the real build-time asset collector against throwaway fixture dirs.
 *
 * `bun scripts/test-assets.mjs`
 *
 * The collector derives what ships from the emitted output, not from
 * document status — that's what makes it safe against draft/teaser leaks,
 * but it also means correctness lives entirely in how it scans HTML/CSS/JS
 * and resolves refs against `media/`. Each case below builds a tiny fake
 * `dist/` and `media/`, runs the real exported function, and checks what it
 * actually copied. No network, no dev server, in the style of
 * scripts/test/publish-cross-branch.test.mjs.
 */
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { collectShippedAssets } = await import('./collect-shipped-assets.mjs');

let failures = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** A throwaway { dist, media } pair, cleaned up after `fn` runs. */
async function withFixture(label, fn) {
  console.log(`\n${label}`);
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-assets-test-'));
  const dist = path.join(root, 'dist');
  const media = path.join(root, 'media');
  await mkdir(dist, { recursive: true });
  await mkdir(media, { recursive: true });
  try {
    await fn({ dist, media });
  } catch (error) {
    failures += 1;
    console.log(`  ✗ threw — ${error instanceof Error ? error.message : error}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const writeHtml = async (dist, name, contents) => {
  const full = path.join(dist, name);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, 'utf8');
};
const writeMedia = async (media, relative, contents = 'fake-bytes') => {
  const full = path.join(media, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, 'utf8');
};

// 1. A ref with %20 in JSON resolves to the space-named file on disk and is copied.
await withFixture('%20-encoded ref resolves to the space-named file', async ({ dist, media }) => {
  await writeHtml(dist, 'about/index.html', '<img src="/images/1Q1A6418%20(Custom).jpg" alt="">');
  await writeMedia(media, '1Q1A6418 (Custom).jpg');

  const result = await collectShippedAssets(dist, media);
  check('copied', existsSync(path.join(dist, 'images', '1Q1A6418 (Custom).jpg')));
  check('reported one copy', result.copied === 1, String(result.copied));
});

// 2. A draft project's section image is not copied.
await withFixture("a draft project's section image is not copied", async ({ dist, media }) => {
  // A draft project emits no page at all — nothing in dist/ references it.
  await writeHtml(dist, 'index.html', '<html><body>Home</body></html>');
  await writeMedia(media, 'draft-hero.jpg');

  const result = await collectShippedAssets(dist, media);
  check('not copied', !existsSync(path.join(dist, 'images', 'draft-hero.jpg')));
  check('reported zero copies', result.copied === 0, String(result.copied));
});

// 3. A teaser project's card cover is copied and its section image is not.
await withFixture("a teaser's card cover ships, its section image does not", async ({ dist, media }) => {
  // The gallery page renders the card cover; the teaser has no /slug route
  // in production, so its case-study section image is never referenced.
  await writeHtml(dist, 'work/index.html', '<img src="/images/teaser-cover.jpg" alt="">');
  await writeMedia(media, 'teaser-cover.jpg');
  await writeMedia(media, 'teaser-section.jpg');

  await collectShippedAssets(dist, media);
  check('cover copied', existsSync(path.join(dist, 'images', 'teaser-cover.jpg')));
  check('section image not copied', !existsSync(path.join(dist, 'images', 'teaser-section.jpg')));
});

// 4. An orphan in media/ is not copied.
await withFixture('an orphan in media/ is not copied', async ({ dist, media }) => {
  await writeHtml(dist, 'index.html', '<html><body>Home</body></html>');
  await writeMedia(media, 'orphan.jpg');

  const result = await collectShippedAssets(dist, media);
  check('not copied', !existsSync(path.join(dist, 'images', 'orphan.jpg')));
  check('counted in total', result.total === 1, String(result.total));
});

// 5. A ref with no file in media/ fails the build.
await withFixture('a ref with no file in media/ fails the build', async ({ dist, media }) => {
  await writeHtml(dist, 'index.html', '<img src="/images/missing.jpg" alt="">');

  let threw = null;
  try {
    await collectShippedAssets(dist, media);
  } catch (error) {
    threw = error;
  }
  check('threw', threw instanceof Error);
  check('names the missing token', Boolean(threw) && /missing\.jpg/.test(String(threw?.message)), String(threw?.message));
});

// 6. A subdirectory ref lands at dist/images/press-logos/x.png.
await withFixture('a subdirectory ref preserves its path', async ({ dist, media }) => {
  await writeHtml(dist, 'tapico/index.html', '<img src="/images/press-logos/x.png" alt="">');
  await writeMedia(media, 'press-logos/x.png');

  await collectShippedAssets(dist, media);
  check('copied into the subdirectory', existsSync(path.join(dist, 'images', 'press-logos', 'x.png')));
});

// 7. An http(s) ref is ignored, not treated as a filename.
await withFixture('an http(s) ref is ignored, not treated as a filename', async ({ dist, media }) => {
  await writeHtml(
    dist,
    'the-rams/index.html',
    [
      '<a href="https://www.youtube.com/watch?v=BpbAbOBEHDU&t=36s">watch</a>',
      // A substring match on "/images/" inside a third-party host must not
      // be mistaken for a local ref (it would otherwise fail the build over
      // a file that was never ours to ship).
      '<img src="https://cdn.example.com/images/tracking.jpg" alt="">',
      '<img src="/images/real.jpg" alt="">',
    ].join('\n'),
  );
  await writeMedia(media, 'real.jpg');

  const result = await collectShippedAssets(dist, media);
  check('did not choke on the youtube href', !result.refs.some((ref) => ref.includes('youtube')));
  check('did not treat the external host path as a local ref', !result.refs.some((ref) => ref.includes('tracking.jpg')));
  check('still copied the real local ref', existsSync(path.join(dist, 'images', 'real.jpg')));
});

// CSS and JS are scanned too, not just HTML.
await withFixture('scans .css and .js output, not just .html', async ({ dist, media }) => {
  await mkdir(path.join(dist, '_astro'), { recursive: true });
  await writeFile(path.join(dist, '_astro', 'style.css'), 'body{background:url("/images/bg.png")}', 'utf8');
  await writeFile(path.join(dist, '_astro', 'chunk.js'), 'const src="/images/from-js.png";', 'utf8');
  await writeMedia(media, 'bg.png');
  await writeMedia(media, 'from-js.png');

  await collectShippedAssets(dist, media);
  check('css ref copied', existsSync(path.join(dist, 'images', 'bg.png')));
  check('js ref copied', existsSync(path.join(dist, 'images', 'from-js.png')));
});

console.log(failures ? `\n${failures} failing check(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
