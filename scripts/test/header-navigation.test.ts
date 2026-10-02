import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');
const layout = readFileSync(resolve(root, 'src/layouts/Layout.astro'), 'utf8');
const reveal = readFileSync(resolve(root, 'src/lib/homeReveal.ts'), 'utf8');

test('persistent header carry validates and consumes bounded session state', () => {
  expect(header).toContain("sessionStorage.getItem('vcd:header-navigation')");
  expect(header).toContain("sessionStorage.removeItem('vcd:header-navigation')");
  expect(header).toContain('pending.title.length > 300');
  expect(header).toContain('pending.href !== location.href');
  expect(header).toContain('home.replaceChildren');
  expect(header).toContain('span.textContent = char');
});

test('outgoing capture requires visible header and rejects unsafe navigation', () => {
  expect(layout).toContain('captureHeaderNavigation(target)');
  expect(layout).toContain("target.origin !== window.location.origin || target.href.includes('#')");
  expect(layout).toContain("anchor.hasAttribute('download')");
  expect(layout).toContain("sessionStorage.setItem('vcd:header-navigation'");
  expect(layout).toContain("Number(style.opacity) > 0");
  expect(layout).toContain('rect.bottom > 0');
});

test('persistent header is isolated from the home entrance reveal', () => {
  expect(reveal).toContain("el.dataset.headerCarriedNavigation !== undefined");
  expect(layout).toContain('@view-transition { navigation: auto; }');
  expect(layout).toContain('view-transition-name: none');
  expect(header).toContain('view-transition-name: vcd-header');
  expect(layout).toContain('html[data-header-navigation] .site-header-slot');
});
