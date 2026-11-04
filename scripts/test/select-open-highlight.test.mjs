import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../../src/components/base-ui/base-ui.css', import.meta.url), 'utf8');

test('selected select option is highlighted on the first open frame, not faded in', () => {
  const rule = css.match(/\.base-ui-select-popup\[data-starting-style\] \.base-ui-select-item \{([^}]*)\}/);
  assert.ok(rule, 'opening popup must suspend item transitions');
  assert.match(rule[1], /transition:\s*none/);
  // The suspension must come after the item's own transition so it wins regardless of specificity changes.
  assert.ok(css.indexOf('.base-ui-select-item { transition:') < rule.index);
});

const chrome = readFileSync(new URL('../../src/styles/dev-chrome.css', import.meta.url), 'utf8');
const editorSelect = readFileSync(new URL('../../src/components/base-ui/EditorSelect.tsx', import.meta.url), 'utf8');
const selectField = readFileSync(new URL('../../src/lib/selectField.ts', import.meta.url), 'utf8');
const ruleWith = (css, selector) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .find(([, selectors]) => selectors.split(/,(?![^(]*\))/).some((s) => s.trim() === selector));

test('both selects share the selected-row fill and its hover step', () => {
  assert.match(ruleWith(chrome, ".base-ui-select-item[data-selected]")?.[2] ?? '', /--comp-button-ghost-container-hover/);
  const hover = ruleWith(chrome, ".dev-menu__item:is(.is-selected, [aria-selected='true']):hover");
  assert.ok(hover, 'legacy selected-row hover rule');
  const selectors = hover[1].split(/,(?![^(]*\))/).map((s) => s.trim());
  assert.ok(selectors.includes('.base-ui-select-item[data-selected]:hover'));
  assert.ok(selectors.includes("[data-pointer-open] :is(.dev-menu__item[aria-selected='true'], .base-ui-select-item[data-selected])"));
});

test('pointer-opened selects mark themselves until the pointer moves', () => {
  assert.match(editorSelect, /data-pointer-open=\{pointerOpen \|\| undefined\}/);
  assert.match(editorSelect, /details\.reason === 'trigger-press' && details\.event instanceof MouseEvent/);
  assert.match(selectField, /toggleAttribute\('data-pointer-open', byPointer\)/);
  assert.match(selectField, /removeAttribute\('data-pointer-open'\)/);
});
