import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseHtml } from 'parse5';
import { init, parse as parseImports } from 'es-module-lexer';
import { CRAFT_DEMOS, craftDemo } from '../../src/lib/craftDemos.ts';

await init;
const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'dist');
const allNodes = (node) => [node, ...(node.childNodes ?? []).flatMap(allNodes)];
const attr = (node, name) => node?.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
const scriptGraph = async (source, seen = new Set()) => {
  const [imports] = parseImports(source);
  for (const item of imports) {
    if (!item.n) continue;
    assert.ok(item.n.startsWith('.') || item.n.startsWith('/'), `unexpected external module: ${item.n}`);
    const file = path.resolve(dist, '_astro', item.n.replace(/^\/_astro\//, ''));
    assert.ok(file.startsWith(`${dist}${path.sep}`));
    if (seen.has(file)) continue;
    seen.add(file);
    const child = await readFile(file, 'utf8');
    assert.doesNotMatch(child, /\/api\/|localStorage|sessionStorage|vcd:dev-|DevTextEditor|DevModeController|data-dev-overlay|data-dev-panel-draggable/, file);
    await scriptGraph(child, seen);
  }
  return seen;
};

for (const demo of CRAFT_DEMOS) {
  const html = await readFile(path.join(dist, 'preview', demo.id, 'index.html'), 'utf8');
  const nodes = allNodes(parseHtml(html));
  const isProgressiveImage = demo.id === 'progressive-image';
  if (isProgressiveImage) {
    assert.equal(nodes.filter((node) => node.tagName === 'h1').length, 0, `${demo.id}: no visible demo title`);
  } else {
    assert.equal(nodes.filter((node) => node.tagName === 'h1').length, 1, `${demo.id}: one visible demo title`);
  }
  const panels = nodes.filter((node) => attr(node, 'class')?.split(/\s+/).includes('dev-panel'));
  let panelNodes = [];
  if (isProgressiveImage) {
    assert.equal(panels.length, 0, `${demo.id}: no DevPanel`);
  } else {
    assert.equal(panels.length, 1, `${demo.id}: one shared DevPanel`);
    assert.ok(attr(panels[0], 'class').split(/\s+/).includes('dev-surface'), `${demo.id}: the shared base surface`);
    panelNodes = allNodes(panels[0]);
    const header = panelNodes.find((node) => node.tagName === 'header');
    const headerElements = header?.childNodes.filter((node) => node.tagName);
    assert.equal(headerElements?.length, 1, `${demo.id}: title-only header`);
    assert.equal(headerElements[0].tagName, 'h1');
    assert.equal(text(headerElements[0]).trim(), demo.title);
  }
  const reset = isProgressiveImage
    ? nodes.find((node) => node.tagName === 'button' && attr(node, 'aria-label') === 'Reset')
    : nodes.find((node) => node.tagName === 'button' && text(node).trim() === 'Reset');
  assert.ok(reset, `${demo.id}: Reset`);
  if (isProgressiveImage) {
    const controls = nodes.find((node) => attr(node, 'role') === 'group' && attr(node, 'aria-label') === 'Image loading');
    assert.ok(controls, `${demo.id}: image loading controls`);
    assert.ok(allNodes(controls).some((node) => node.tagName === 'button' && text(node).trim() === 'Load'), `${demo.id}: Load`);
    assert.ok(allNodes(controls).includes(reset), `${demo.id}: Reset sits in image loading controls`);
  }
  assert.equal(panelNodes.includes(reset), false, `${demo.id}: Reset sits outside the panel`);
  const instance = nodes.find((node) => /^vcd-.+-demo$/.test(node.tagName ?? ''));
  assert.ok(instance && allNodes(instance).includes(reset), `${demo.id}: Reset stays within its demo lifecycle`);
  assert.equal(nodes.some((node) => /\b(dev-panel__lights|dev-panel-actions)\b/.test(attr(node, 'class') ?? '') || attr(node, 'data-dev-panel-draggable') !== undefined), false, `${demo.id}: no panel chrome or dragging`);
  assert.ok(nodes.some((node) => node.tagName === 'meta' && attr(node, 'name') === 'robots' && attr(node, 'content') === 'noindex,nofollow'));
  const policy = nodes.find((node) => node.tagName === 'meta' && attr(node, 'http-equiv') === 'Content-Security-Policy');
  if (isProgressiveImage) {
    assert.match(attr(policy, 'content'), /connect-src 'self' https:\/\/fonts.googleapis.com https:\/\/fonts.gstatic.com;/, `${demo.id}: toolbar capture can embed its stylesheet and fonts`);
    assert.ok(nodes.some((node) => attr(node, 'class')?.split(/\s+/).includes('lens') && attr(node, 'tabindex') === '0'), `${demo.id}: keyboard-accessible magnifier`);
    assert.equal(nodes.some((node) => attr(node, 'type') === 'range'), false, `${demo.id}: no prototype controls`);
  } else {
    assert.match(attr(policy, 'content'), /connect-src 'none'/, `${demo.id}: no production fetch/WebSocket access`);
  }
  assert.match(attr(policy, 'content'), /form-action 'none'/);
  assert.equal(nodes.some((node) => attr(node, 'contenteditable') !== undefined), false);
  assert.doesNotMatch(html, /data-dev-document|data-dev-edit|data-project-image-crop-tuner|dev-mode-toggle/);
  const body = nodes.find((node) => node.tagName === 'body');
  const visibleText = allNodes(body).filter((node) => node.nodeName === '#text' && !['script', 'style'].includes(node.parentNode?.tagName)).map(text).join(' ');
  assert.doesNotMatch(visibleText, /import .* from|---/, `${demo.id}: Astro frontmatter cannot leak into the page`);
  for (const input of nodes.filter((node) => node.tagName === 'input' && attr(node, 'type') === 'range')) {
    assert.ok(attr(input, 'aria-label') || nodes.some((label) => label.tagName === 'label' && attr(label, 'for') === attr(input, 'id') && attr(input, 'id')), `${demo.id}: every range is labelled`);
  }
  for (const script of nodes.filter((node) => node.tagName === 'script' && attr(node, 'type') === 'module')) {
    const src = attr(script, 'src');
    const source = src ? `import ${JSON.stringify(src)};` : text(script);
    assert.doesNotMatch(source, /\/api\/|localStorage|sessionStorage|vcd:dev-/);
    await scriptGraph(source);
  }
  if (demo.id === 'select-field') {
    const selected = nodes.find((node) => node.tagName === 'option' && attr(node, 'selected') !== undefined);
    assert.equal(attr(selected, 'value'), 'center', 'non-first defaults must reach the native select');
    const active = nodes.find((node) => attr(node, 'role') === 'option' && attr(node, 'aria-selected') === 'true');
    assert.equal(attr(active, 'data-value'), 'center');
    assert.ok(nodes.some((node) => attr(node, 'role') === 'combobox' && attr(node, 'aria-controls')));
  }
}

const indexHtml = await readFile(path.join(dist, 'preview/craft/index.html'), 'utf8');
const indexNodes = allNodes(parseHtml(indexHtml));
assert.equal(indexNodes.some((node) => node.tagName === 'script'), false, 'the review index loads no interaction code');
assert.equal(indexHtml.includes('href="/devpanel"'), false, 'production must not link to draft-only project pages');
for (const demo of CRAFT_DEMOS) assert.ok(indexHtml.includes(`/preview/${demo.id}`));
assert.equal(craftDemo('https://attacker.example'), undefined);
assert.equal(craftDemo('../api/upload'), undefined);
assert.equal(craftDemo(null), undefined);

for (const slug of ['devpanel', 'low-res-image-loader']) {
  const document = JSON.parse(await readFile(path.join(root, 'src/content/projects', `${slug}.json`), 'utf8'));
  assert.ok(['draft', 'published'].includes(document.status), `${slug}: valid project visibility`);
  assert.ok(document.sections.length > 0);
  const demos = document.sections.filter((section) => section.type === 'interactiveDemo');
  assert.ok(demos.length > 0, `${slug}: retains its interactive demo alongside authored content`);
  for (const section of demos) {
    assert.ok(craftDemo(section.demo), `${slug}: known demo`);
  }
}
console.log(`craft-demo-build: passed (${CRAFT_DEMOS.length} routes, native defaults, accessible labels, module isolation, no authoring APIs/storage)`);
