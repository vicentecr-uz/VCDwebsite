import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseHtml } from 'parse5';
import { init, parse as parseImports } from 'es-module-lexer';
import { CRAFT_DEMOS, craftDemo } from '../../src/lib/craftDemos.ts';

await init;
const root = path.resolve(import.meta.dirname, '../..');
const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist');
const allNodes = (node) => [node, ...(node.childNodes ?? []).flatMap(allNodes)];
const attr = (node, name) => node?.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
// Public page blocks also listen for these layout refreshes when used by the editor.
const withoutRendererEvents = (source) => source.replace(/vcd:dev-(?:section-inserted|section-structure-changed|frame-changed)/g, '');
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
    assert.doesNotMatch(withoutRendererEvents(child), /\/api\/|localStorage|vcd:dev-|DevTextEditor|DevModeController|data-dev-overlay|data-dev-panel-draggable/, file);
    // The existing magnifier keeps session presets; the other demos remain storage-free.
    if (!path.basename(file).startsWith('ProgressiveImageDemo.')) assert.doesNotMatch(child, /sessionStorage/, file);
    await scriptGraph(child, seen);
  }
  return seen;
};

for (const demo of CRAFT_DEMOS) {
  const html = await readFile(path.join(dist, 'preview', demo.id, 'index.html'), 'utf8');
  const nodes = allNodes(parseHtml(html));
  const isProgressiveImage = demo.id === 'progressive-image';
  const isCanvas = ['progressive-image', 'image-framing', 'gap-spacing', 'block-reorder'].includes(demo.id);
  if (isCanvas) {
    assert.equal(nodes.filter((node) => node.tagName === 'h1').length, 0, `${demo.id}: no visible demo title`);
  } else {
    assert.equal(nodes.filter((node) => node.tagName === 'h1').length, 1, `${demo.id}: one visible demo title`);
  }
  const panelClass = demo.id === 'image-framing' ? 'dev-overlay' : 'dev-panel';
  const panels = nodes.filter((node) => attr(node, 'class')?.split(/\s+/).includes(panelClass) && attr(node, 'data-demo-asset-picker') === undefined);
  let panelNodes = [];
  if (isCanvas && demo.id !== 'image-framing') {
    assert.equal(panels.length, 0, `${demo.id}: no DevPanel`);
  } else {
    assert.equal(panels.length, 1, `${demo.id}: one shared DevPanel`);
    assert.ok(attr(panels[0], 'class').split(/\s+/).includes('dev-surface'), `${demo.id}: the shared base surface`);
    panelNodes = allNodes(panels[0]);
    const header = panelNodes.find((node) => demo.id === 'image-framing' ? attr(node, 'class')?.split(/\s+/).includes('dev-overlay__head') : node.tagName === 'header');
    const headerElements = header?.childNodes.filter((node) => node.tagName);
    assert.equal(headerElements?.length, demo.id === 'image-framing' ? 2 : 1, `${demo.id}: shared header`);
    assert.equal(headerElements[0].tagName, demo.id === 'image-framing' ? 'p' : 'h1');
    assert.equal(text(headerElements[0]).trim(), demo.id === 'image-framing' ? 'Image' : demo.title);
  }
  if (demo.id === 'image-framing') {
    assert.deepEqual(
      panelNodes.filter((node) => attr(node, 'data-crop-viewport') !== undefined).map((node) => attr(node, 'data-crop-viewport')),
      ['desktop', 'tablet', 'mobile'],
      'image panel: desktop, tablet and mobile viewport controls',
    );
    const canvasFrame = nodes.find((node) => node.tagName === 'iframe' && attr(node, 'src') === '/preview/image-framing-canvas');
    assert.ok(canvasFrame, 'image panel: nested canvas iframe');
    const canvasHtml = await readFile(path.join(dist, 'preview', 'image-framing-canvas', 'index.html'), 'utf8');
    const canvasNodes = allNodes(parseHtml(canvasHtml));
    assert.ok(canvasNodes.some((node) => attr(node, 'class')?.split(/\s+/).includes('project-image')), 'image canvas: ProjectImage output');
    assert.equal(canvasNodes.some((node) => node.tagName === 'iframe'), false, 'image canvas: no nested iframe');
    assert.equal(canvasNodes.some((node) => attr(node, 'class')?.split(/\s+/).includes('dev-overlay') || attr(node, 'data-crop-panel') !== undefined || attr(node, 'data-demo-asset-picker') !== undefined), false, 'image canvas: no panel or authoring UI');
    const canvasPolicy = canvasNodes.find((node) => node.tagName === 'meta' && attr(node, 'http-equiv') === 'Content-Security-Policy');
    assert.match(attr(canvasPolicy, 'content'), /connect-src 'none'/, 'image canvas: no production fetch/WebSocket access');
    assert.match(attr(canvasPolicy, 'content'), /form-action 'none'/, 'image canvas: no form submission');
    assert.doesNotMatch(canvasHtml, /\/api\/|localStorage|sessionStorage|vcd:dev-|DevTextEditor|DevModeController|data-dev-overlay|data-dev-panel-draggable/, 'image canvas: no authoring APIs or storage');
    for (const script of canvasNodes.filter((node) => node.tagName === 'script' && attr(node, 'type') === 'module')) {
      const src = attr(script, 'src');
      const source = src ? `import ${JSON.stringify(src)};` : text(script);
      assert.doesNotMatch(withoutRendererEvents(source), /\/api\/|localStorage|sessionStorage|vcd:dev-/);
      await scriptGraph(source);
    }
    assert.ok(panelNodes.some((node) => attr(node, 'data-minimize-toggle') !== undefined), 'image panel: real minimize control');
    assert.ok(panelNodes.some((node) => attr(node, 'data-hide-toggle') !== undefined), 'image panel: real close control');
    assert.ok(panelNodes.some((node) => attr(node, 'data-crop-replace-file') !== undefined), 'image panel: local file replacement');
    assert.ok(panelNodes.some((node) => attr(node, 'data-crop-replace-assets') !== undefined), 'image panel: published asset picker');
    const picker = nodes.find((node) => attr(node, 'data-demo-asset-picker') !== undefined);
    assert.ok(picker && attr(picker, 'role') === 'dialog', 'image panel: named shared asset picker');
    assert.equal(allNodes(picker).some((node) => attr(node, 'data-asset-filter') !== undefined), false, 'public picker omits library management filters');
    assert.ok(nodes.some((node) => attr(node, 'data-published-demo-assets') !== undefined), 'public catalog is inline; no authoring endpoint');
    for (const action of ['reset', 'revert', 'save']) assert.ok(panelNodes.some((node) => attr(node, `data-demo-author-${action}`) !== undefined), `image panel: ${action} action`);
    assert.equal(panelNodes.some((node) => attr(node, 'data-dev-overlay') !== undefined), false, 'image panel: isolated presentation only');
  }
  const reset = nodes.find((node) => node.tagName === 'button' && text(node).trim() === 'Reset');
  if (!isProgressiveImage) assert.ok(reset, `${demo.id}: Reset`);
  if (isProgressiveImage) {
    const controls = nodes.find((node) => attr(node, 'role') === 'group' && attr(node, 'aria-label') === 'Image loading');
    assert.ok(controls, `${demo.id}: image loading controls`);
    assert.ok(allNodes(controls).some((node) => node.tagName === 'button' && attr(node, 'aria-label') === 'Load'), `${demo.id}: reversible Load control`);
  }
  assert.equal(panelNodes.includes(reset), demo.id === 'image-framing', `${demo.id}: Reset follows this demo's action layout`);
  const instance = nodes.find((node) => /^vcd-.+-demo$/.test(node.tagName ?? ''));
  assert.ok(instance && (isProgressiveImage || allNodes(instance).includes(reset)), `${demo.id}: controls stay within the demo lifecycle`);
  if (demo.id === 'gap-spacing') {
    for (const state of ['pointer', 'grab', 'grabbing']) {
      const glyph = nodes.find((node) => attr(node, 'data-cursor-glyph') === state);
      const image = allNodes(glyph).find((node) => node.tagName === 'img');
      const src = attr(image, 'src');
      assert.match(src, /^(?:\/_astro\/[^\s]+\.svg|data:image\/svg\+xml,)/, `${state}: cursor import is an image URL`);
      if (src.startsWith('/')) assert.ok((await readFile(path.join(dist, src))).length > 0, `${state}: cursor asset exists`);
    }
    const blocks = nodes.filter((node) => attr(node, 'data-reorder-demo-block') !== undefined);
    assert.equal(blocks.length, 3, 'block system: three actual page blocks');
    assert.equal(nodes.filter((node) => attr(node, 'data-gap-toolbar') !== undefined).length, 3, 'each block keeps its gap when reordered');
    assert.ok(nodes.some((node) => attr(node, 'class')?.split(/\s+/).includes('project-image')), 'block system: crop host matches the renderer');
    assert.ok(nodes.some((node) => attr(node, 'class')?.split(/\s+/).includes('demo-page--scrolling')), 'the demo document is the scroll surface');
  }
  if (demo.id !== 'image-framing') assert.equal(nodes.some((node) => /\b(dev-panel__lights|dev-panel-actions)\b/.test(attr(node, 'class') ?? '') || attr(node, 'data-dev-panel-draggable') !== undefined), false, `${demo.id}: no panel chrome or dragging`);
  assert.ok(nodes.some((node) => node.tagName === 'meta' && attr(node, 'name') === 'robots' && attr(node, 'content') === 'noindex,nofollow'));
  const policy = nodes.find((node) => node.tagName === 'meta' && attr(node, 'http-equiv') === 'Content-Security-Policy');
  if (isProgressiveImage) {
    assert.match(attr(policy, 'content'), /connect-src 'self';/, `${demo.id}: toolbar capture can embed its stylesheet and fonts`);
    assert.ok(nodes.some((node) => attr(node, 'class')?.split(/\s+/).includes('lens') && attr(node, 'tabindex') === '0'), `${demo.id}: keyboard-accessible magnifier`);
    assert.equal(nodes.some((node) => attr(node, 'type') === 'range'), false, `${demo.id}: no prototype controls`);
  } else {
    assert.match(attr(policy, 'content'), /connect-src 'none'/, `${demo.id}: no production fetch/WebSocket access`);
  }
  assert.match(attr(policy, 'content'), /form-action 'none'/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${demo.id}: fonts are self-hosted`);
  assert.equal(nodes.some((node) => attr(node, 'contenteditable') !== undefined), false);
  assert.doesNotMatch(html.replaceAll('data-dev-editor-select', ''), /data-dev-document|data-dev-edit|data-project-image-crop-tuner|dev-mode-toggle/);
  const body = nodes.find((node) => node.tagName === 'body');
  const visibleText = allNodes(body).filter((node) => node.nodeName === '#text' && !['script', 'style'].includes(node.parentNode?.tagName)).map(text).join(' ');
  assert.doesNotMatch(visibleText, /import .* from|---/, `${demo.id}: Astro frontmatter cannot leak into the page`);
  for (const input of nodes.filter((node) => node.tagName === 'input' && attr(node, 'type') === 'range')) {
    assert.ok(attr(input, 'aria-label') || nodes.some((label) => label.tagName === 'label' && attr(label, 'for') === attr(input, 'id') && attr(input, 'id')), `${demo.id}: every range is labelled`);
  }
  for (const script of nodes.filter((node) => node.tagName === 'script' && attr(node, 'type') === 'module')) {
    const src = attr(script, 'src');
    const source = src ? `import ${JSON.stringify(src)};` : text(script);
    assert.doesNotMatch(withoutRendererEvents(source), /\/api\/|localStorage|sessionStorage|vcd:dev-/);
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
assert.equal(indexHtml.includes('href="/sample-modern"'), false, 'production must not link to draft-only project pages');
for (const demo of CRAFT_DEMOS) assert.ok(indexHtml.includes(`/preview/${demo.id}`));
assert.equal(craftDemo('https://attacker.example'), undefined);
assert.equal(craftDemo('../api/upload'), undefined);
assert.equal(craftDemo(null), undefined);

for (const slug of ['sample-modern']) {
  const document = JSON.parse(await readFile(path.join(root, 'sample-content/src/content/projects', `${slug}.json`), 'utf8'));
  assert.ok(['draft', 'published'].includes(document.status), `${slug}: valid project visibility`);
  assert.ok(document.sections.length > 0);
  const demos = document.sections.filter((section) => section.type === 'interactiveDemo');
  assert.ok(demos.length > 0, `${slug}: retains its interactive demo alongside authored content`);
  for (const section of demos) assert.ok(craftDemo(section.demo), `${slug}: known demo`);
  const demoIds = new Set(demos.map((section) => section.demo));
  for (const demo of CRAFT_DEMOS) assert.ok(demoIds.has(demo.id), `${slug}: includes ${demo.id}`);
}
console.log(`craft-demo-build: passed (${CRAFT_DEMOS.length} routes, native defaults, accessible labels, module isolation, no authoring APIs)`);
