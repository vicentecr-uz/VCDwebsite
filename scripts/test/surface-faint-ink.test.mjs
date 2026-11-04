// Faint ink must follow the surface behind it (see src/styles/global.css,
// "Faint ink follows the fill behind it"). Ceiling: checks rest-state fills
// painted with the container tokens below, rule by rule in source text; a fill
// set from JS or through another alias is not seen.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../../src');
const FILL = /background(?:-color)?:\s*var\(--(?:comp-field-container|comp-button-soft-container|sys-color-srf-container(?:-low|-high)?)\)/;
const FAINT_ROLES = /var\(--sys-color-on-srf(?:-container)?-faint\)/g;

const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  if (statSync(full).isDirectory()) return name === 'content' ? [] : sources(full);
  return /\.(css|astro|tsx)$/.test(name) ? [full] : [];
});

const files = sources(ROOT).map((file) => [path.relative(ROOT, file), readFileSync(file, 'utf8')]);

test('every container fill re-declares --on-surface-faint for its contents', () => {
  const missing = [];
  for (const [file, text] of files) {
    for (const [, selector, body] of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (FILL.test(body) && !body.includes('--on-surface-faint:')) missing.push(`${file}: ${selector.trim().split('\n').pop()}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('glyphs use var(--on-surface-faint), not the sys faint roles', () => {
  const direct = [];
  for (const [file, text] of files) {
    if (file === path.join('styles', 'global.css')) continue;
    for (const line of text.split('\n')) {
      if (FAINT_ROLES.test(line) && !/--on-surface-faint:\s*var\(--sys-color-on-srf-container-faint\)/.test(line)) direct.push(`${file}: ${line.trim()}`);
      FAINT_ROLES.lastIndex = 0;
    }
  }
  assert.deepEqual(direct, []);
});
