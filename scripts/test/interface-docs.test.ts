import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const index = readFileSync(path.join(root, 'docs/interface-conventions.md'), 'utf8');
const links = [...index.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((href) => !/^https?:/.test(href));

test('the interface index stays under 40 lines', () => {
  expect(index.trimEnd().split('\n').length).toBeLessThan(40);
});

test('every index link resolves and every topic file is linked', () => {
  expect(links.filter((href) => !existsSync(path.join(root, 'docs', href)))).toEqual([]);
  const topics = readdirSync(path.join(root, 'docs/interface')).filter((name) => name.endsWith('.md'));
  expect(topics.filter((name) => !links.includes(`interface/${name}`))).toEqual([]);
});

test('good-enough markers name an issue', () => {
  const dir = path.join(root, 'src/components/ui');
  const bad = readdirSync(dir).filter((name) => /good-enough\b(?!: #\d+)/.test(readFileSync(path.join(dir, name), 'utf8')));
  expect(bad).toEqual([]);
});
