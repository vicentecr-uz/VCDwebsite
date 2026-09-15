import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const start = source.indexOf("window.addEventListener('resize', () => {");
const end = source.indexOf("\n    });", start) + 7;
const resizeHandler = source.slice(start, end);

assert.ok(resizeHandler.includes('if (nextViewportWidth === viewportWidth) return;'));
assert.ok(resizeHandler.includes('captureGeo();'));
assert.ok(resizeHandler.includes("if (mode === 'docked') applyGeo();"));
assert.ok(resizeHandler.includes("else if (mode === 'riding')"));
assert.ok(resizeHandler.includes("header.style.left = '0';"));
assert.equal(resizeHandler.includes("setMode('flow')"), false);
