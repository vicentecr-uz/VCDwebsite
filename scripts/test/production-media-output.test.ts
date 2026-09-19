import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { getPageMediaFeatures } from '../../src/lib/pageMediaFeatures';

const dist = resolve(process.env.VCD_TEST_DIST || 'dist');
const transpiler = new Bun.Transpiler({ loader: 'js' });

async function htmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(file) : file.endsWith('.html') ? [file] : [];
  }));
  return nested.flat();
}

async function scriptsFor(html: string): Promise<string> {
  const scripts: Array<{ src?: string; code: string }> = [];
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if ('tagName' in node && node.tagName === 'script') {
      scripts.push({
        src: node.attrs.find((attr) => attr.name === 'src')?.value,
        code: node.childNodes.filter((child) => child.nodeName === '#text').map((child) => 'value' in child ? child.value : '').join(''),
      });
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(html));
  const visited = new Set<string>();
  const codes: string[] = [];
  async function scan(code: string, file: string) {
    codes.push(code);
    for (const item of transpiler.scanImports(code)) {
      if (item.kind !== 'import-statement') continue;
      if (item.path.startsWith('/_astro/')) await load(join(dist, item.path));
      else if (item.path.startsWith('.')) await load(resolve(dirname(file), item.path));
    }
  }
  async function load(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    await scan(await readFile(file, 'utf8'), file);
  }
  for (const script of scripts) {
    if (script.src?.startsWith('/_astro/')) await load(join(dist, script.src));
    else if (!script.src) await scan(script.code, join(dist, 'index.html'));
  }
  return codes.join('\n');
}

test('production pages load only the media runtimes their rendered content needs', async () => {
  let checked = 0;
  for (const file of await htmlFiles(dist)) {
    const html = await readFile(file, 'utf8');
    if (!html.includes('id="site-wrapper"')) continue;
    const features = getPageMediaFeatures(html);
    const code = await scriptsFor(html);
    const label = file.slice(dist.length);
    expect(code.includes('media-volume-range'), `${label}: video controls`).toBe(features.video);
    expect(code.includes('[data-image-lightbox-viewer]'), `${label}: image lightbox`).toBe(features.lightbox);
    expect(code.includes('.project-grid__chip'), `${label}: gallery contrast`).toBe(features.gallery);
    expect(code.includes('.project-image-grid__image, .project-media__img, .project-image__img'), `${label}: caption contrast`).toBe(features.captions);
    expect(code.includes('--caption-shadow-extension'), `${label}: caption shadow`).toBe(features.captions);
    expect(code, `${label}: editor-chip code`).not.toContain('.dev-image-edit-trigger, .dev-caption-add-trigger, .dev-grid-edit-trigger');
    checked += 1;
  }
  expect(checked).toBeGreaterThan(0);
});
