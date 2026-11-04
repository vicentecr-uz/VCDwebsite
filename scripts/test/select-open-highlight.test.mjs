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
