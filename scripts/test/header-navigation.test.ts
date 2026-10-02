import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');
const layout = readFileSync(resolve(root, 'src/layouts/Layout.astro'), 'utf8');
const reveal = readFileSync(resolve(root, 'src/lib/homeReveal.ts'), 'utf8');
const inline = header.match(/<script is:inline>\s*([\s\S]*?)\s*<\/script>/)?.[1] ?? '';

class FakeElement {
  dataset: Record<string, string> = {};
  style = { opacity: '', setProperty: (key: string, value: string) => { (this.style as Record<string, unknown>)[key] = value; } } as Record<string, unknown> & { opacity: string; setProperty: (key: string, value: string) => void };
  children: FakeElement[] = [];
  textContent = '';
  attrs: Record<string, string> = {};
  classList = { add: (...names: string[]) => names.forEach((name) => this.attrs[name] = ''), remove: (...names: string[]) => names.forEach((name) => delete this.attrs[name]) };
  constructor(private selectors: Record<string, FakeElement | null> = {}) {}
  querySelector(selector: string) { return this.selectors[selector] ?? null; }
  querySelectorAll() { return this.children; }
  replaceChildren(...children: FakeElement[]) { this.children = children; this.textContent = children.map((child) => child.textContent).join(''); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
}

function runCarry(pending: unknown, href = 'https://vcd.test/work', rawOverride?: string, throwingStorage = false) {
  const slot = new FakeElement();
  const home = new FakeElement();
  const page = new FakeElement(); page.textContent = 'Project';
  page.children = [...'Project'].map((char) => { const child = new FakeElement(); child.textContent = char; return child; });
  const start = new FakeElement({ '.header-trigger__wordmark--home': home, '.header-trigger__wordmark--page': page });
  const rootElement = new FakeElement();
  const storage = { value: rawOverride ?? (pending === null ? null : JSON.stringify(pending)), getItem: () => { if (throwingStorage) throw new Error('blocked'); return storage.value; }, removeItem: () => { if (throwingStorage) throw new Error('blocked'); storage.value = null; } };
  const document = { documentElement: rootElement, querySelector: (selector: string) => selector === '.site-header-slot' ? slot : start, createElement: () => new FakeElement() };
  const location = { href };
  new Function('document', 'sessionStorage', 'location', 'window', `(function(){${inline}\n})()`)(document, storage, location, { addEventListener() {} });
  return { slot, home, page, storage };
}

test('valid carry restores visible layers with safe textContent chars', () => {
  const result = runCarry({ href: 'https://vcd.test/work', title: '<img src=x>', time: Date.now() });
  expect(result.home.textContent).toBe('<img\u00a0src=x>');
  expect(result.home.attrs['aria-hidden']).toBe('false');
  expect(result.page.attrs['aria-hidden']).toBe('true');
  expect(result.home.children.length).toBe(11);
  expect(result.home.children.every((child) => child.style.opacity === '1')).toBe(true);
  expect(result.page.children.every((child) => child.style.opacity === '0')).toBe(true);
  expect(result.storage.value).toBeNull();
});

test('mismatched, expired, future and oversized carries are ignored', () => {
  for (const pending of [
    { href: 'https://vcd.test/about', title: 'Old', time: Date.now() },
    { href: 'https://vcd.test/work', title: 'Old', time: Date.now() - 10001 },
    { href: 'https://vcd.test/work', title: 'Old', time: Date.now() + 1 },
    { href: 'https://vcd.test/work', title: 'x'.repeat(301), time: Date.now() },
  ]) {
    const result = runCarry(pending);
    expect(result.slot.dataset.headerCarriedNavigation).toBeUndefined();
    expect(result.home.children.length).toBe(0);
  }
});

test('storage and parser failures fail closed', () => {
  for (const result of [runCarry(null, 'https://vcd.test/work', '{bad'), runCarry(null, 'https://vcd.test/work', undefined, true)]) {
    expect(result.slot.dataset.headerCarriedNavigation).toBeUndefined();
    expect(result.storage.value).toBeNull();
  }
});

test('native CSS and reveal guards keep persistent header above veil and out of cold home reveal', () => {
  expect(layout).toContain('html[data-header-navigation] .site-header-slot { z-index: 110; }');
  expect(reveal).toContain("el.dataset.headerCarriedNavigation !== undefined");
});
