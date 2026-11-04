import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const global = read('src/styles/global.css');
const chrome = read('src/styles/dev-chrome.css');
const baseUi = read('src/components/base-ui/base-ui.css');

// Last `font:` set by a rule whose selector list names `selector` exactly — the
// cascade winner among the file's equal-specificity rules.
const lastFont = (css, selector) => {
  let found = null;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((s) => s.trim() === selector)) continue;
    const font = body.match(/(?:^|;)\s*font:\s*([^;]+)/)?.[1].trim();
    if (font) found = font;
  }
  return found;
};

test('select trigger value and options share one type token', () => {
  // Menu rows are the source (06a05789); the select trigger follows them, not the field label.
  assert.match(global, /--dev-text-select-value:\s*var\(--dev-text-menu-item\)/);
  assert.equal(lastFont(chrome, '.dev-field__input--select'), 'var(--dev-text-select-value)');
  assert.equal(lastFont(chrome, '.dev-select__option'), 'var(--dev-text-select-value)');
  assert.equal(lastFont(baseUi, '.base-ui-select-item'), 'var(--dev-text-select-value)');
});

test('select font rules outrank the generic input and Menu row rules', () => {
  // Same specificity, so the later rule wins over the generic input's `font: inherit` and the Menu row font.
  const shared = chrome.search(/\.dev-field__input--select,\s*\.dev-select__option\s*\{/);
  assert.ok(shared > chrome.indexOf('.dev-field__input {'));
  assert.ok(shared > chrome.indexOf('.dev-menu__item {'));
});
