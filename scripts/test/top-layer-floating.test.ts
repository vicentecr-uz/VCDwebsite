import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every `.project-block` is a stacking context (`isolation: isolate`) and the
// containing block for `position: fixed` (`container-type: inline-size`). A menu,
// listbox or tooltip inside one block paints under the next block whatever its
// z-index, so floating layers must open as native popovers (top layer).
// See docs/interface-conventions.md → Floating layers and src/lib/floatingLayer.ts.

const root = path.resolve(import.meta.dir, '../..');
const src = path.join(root, 'src');
const FLOATING_ROLES = 'menu|listbox|tooltip';

// Floating-role elements that never sit inside a page block. Each entry must
// still match, so a removed or migrated layer also leaves this list.
const EXEMPT: Array<{ file: string; marker: string; reason: string }> = [
  { file: 'src/components/DevTextEditor.astro', marker: 'dev-gap-toolbar__menu', reason: 'inline row inside the gap toolbar pill, not a popup' },
  { file: 'src/components/DevImageDrop.astro', marker: 'dev-image-drop-choice', reason: 'page-level sibling of the drop zone, or mounted inline in the gap toolbar' },
  { file: 'src/components/DevModeController.astro', marker: "menu.className = 'dev-launcher'", reason: 'created on demand and appended to <body>' },
  { file: 'src/components/project/demos/ProgressiveImageDemo.astro', marker: 'progressive-image-lens-tooltip', reason: 'portaled to <body> on mount' },
  { file: 'src/components/project/ProjectImageCropTuner.astro', marker: 'tapico-crop-tuner__linked-aspect-tooltip', reason: 'inside the Layout-level crop tuner panel' },
];

const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  if (entry.isDirectory()) return file === path.join(src, 'content') ? [] : sourceFiles(file);
  return /\.(astro|tsx?|jsx?|mjs)$/.test(entry.name) ? [file] : [];
});

// Opening tag around `index`, skipping `>` inside {expressions} and quotes.
const tagAround = (source: string, index: number) => {
  const start = source.lastIndexOf('<', index);
  let depth = 0;
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
};

type Layer = { file: string; line: number; text: string; topLayer: boolean };

const floatingLayers = (): Layer[] => sourceFiles(src).flatMap((absolute) => {
  const file = path.relative(root, absolute);
  const source = readFileSync(absolute, 'utf8');
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const markup = [...source.matchAll(new RegExp(`(?<!\\[)\\brole=["'](?:${FLOATING_ROLES})["']`, 'g'))].map((match) => {
    const text = tagAround(source, match.index!);
    return { file, line: lineOf(match.index!), text, topLayer: /\spopover(?:[\s=>]|$)/.test(text) };
  });
  const scripted = [...source.matchAll(new RegExp(`([\\w$.]+)\\.setAttribute\\(\\s*['"]role['"]\\s*,\\s*['"](?:${FLOATING_ROLES})['"]`, 'g'))].map((match) => {
    const name = match[1].replace(/[.$]/g, '\\$&');
    const lineStart = source.lastIndexOf('\n', match.index!) + 1;
    const text = source.slice(Math.max(0, source.lastIndexOf('\n', lineStart - 2)), source.indexOf('\n', match.index!));
    return {
      file,
      line: lineOf(match.index!),
      text,
      topLayer: new RegExp(`${name}\\.(?:setAttribute\\(\\s*['"]popover['"]|popover\\s*=)`).test(source),
    };
  });
  return [...markup, ...scripted];
});

const exemption = (layer: Layer) => EXEMPT.find((entry) => entry.file === layer.file && layer.text.includes(entry.marker));

test('floating layers render in the top layer via the popover attribute', () => {
  const layers = floatingLayers();
  expect(layers.length).toBeGreaterThan(0);
  const offenders = layers
    .filter((layer) => !layer.topLayer && !exemption(layer))
    .map((layer) => `${layer.file}:${layer.line} — role="menu|listbox|tooltip" without popover; add popover="manual" (see src/lib/floatingLayer.ts)`);
  expect(offenders).toEqual([]);
});

// Menus and listboxes are assembled from the Menu component, which owns their
// padding, gap, radius and separators; a hand-styled surface is how they drift.
test('top-layer menus and listboxes use .dev-menu', () => {
  const offenders = floatingLayers()
    .filter((layer) => layer.topLayer && /role=["'](?:menu|listbox)["']/.test(layer.text) && !/\bdev-menu\b/.test(layer.text))
    .map((layer) => `${layer.file}:${layer.line} — menu/listbox without the .dev-menu class (src/components/ui/Menu.astro)`);
  expect(offenders).toEqual([]);
});

test('every exemption still matches a floating layer', () => {
  const layers = floatingLayers();
  const stale = EXEMPT.filter((entry) => !layers.some((layer) => !layer.topLayer && exemption(layer) === entry));
  expect(stale).toEqual([]);
});

test('the guard catches an in-block menu', () => {
  const sample = '<div class="hero__menu" id="m" role="menu" aria-label={`Install ${a > b}`}>';
  const text = tagAround(sample, sample.indexOf('role='));
  expect(text).toBe(sample);
  expect(/\spopover(?:[\s=>]|$)/.test(text)).toBe(false);
  expect(/\spopover(?:[\s=>]|$)/.test(text.replace('role=', 'popover="manual" role='))).toBe(true);
});
