import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commentsIn } from '../check-comments.mjs';

const apply = path.resolve(import.meta.dir, '../../.claude/skills/delete-comment/scripts/apply.mjs');

const deleteAll = async (name, source) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'delete-comment-'));
  writeFileSync(path.join(dir, name), source);
  const found = await commentsIn(name, source);
  const blocks = found.map((c, i) => ({ id: i + 1, file: name, ...c, own: false }));
  writeFileSync(path.join(dir, 'blocks.json'), JSON.stringify({ files: { [name]: createHash('sha256').update(source).digest('hex') }, blocks }));
  writeFileSync(path.join(dir, 'decisions.txt'), blocks.map((b) => `${b.id} T`).join('\n'));
  const run = Bun.spawnSync(['bun', apply, 'blocks.json', 'decisions.txt'], { cwd: dir });
  return { dir, found, code: run.exitCode, out: readFileSync(path.join(dir, name), 'utf8') };
};

test('identical Astro comments each resolve to their own position', async () => {
  const { out } = await deleteAll('a.astro', '---\n---\n<!-- same -->\n<p>keep</p>\n<!-- same -->\n');
  expect(out).toBe('---\n---\n<p>keep</p>\n');
});

test('comment-like strings in Astro expressions are not comments', async () => {
  const { found } = await deleteAll('a.astro', "---\n---\n<p>{'/* literal */'}</p>\n");
  expect(found).toHaveLength(0);
});

test('Astro expression attributes are scanned', async () => {
  const { found } = await deleteAll('a.astro', '---\n---\n<p class={[\n  // note\n  "a",\n]}>x</p>\n');
  expect(found.map((c) => c.text.trim())).toEqual(['note']);
});

test('a JSX comment container goes, a catch block keeps its braces', async () => {
  const astro = await deleteAll('a.astro', '---\n---\n<div>\n  {/* note */}\n  <p>x</p>\n</div>\n');
  expect(astro.out).toBe('---\n---\n<div>\n  <p>x</p>\n</div>\n');
  const js = await deleteAll('a.mjs', "try { f(); } catch\n{ /* ignore */ }\nconst s = 'catch { }';\n");
  expect(js.out).toBe("try { f(); } catch\n{}\nconst s = 'catch { }';\n");
});

test('JSDoc keeps @template, typed tags and a bare @deprecated', async () => {
  const { out } = await deleteAll('a.mjs', '/**\n * Prose.\n * @template T\n * @param {T} value the value\n * @deprecated use b\n */\nexport function a(value) { return value; }\n');
  expect(out).toBe('/**\n * @template T\n * @param {T} value\n * @deprecated\n */\nexport function a(value) { return value; }\n');
});

test('removing an inline comment never joins tokens or drops a line break', async () => {
  const { out } = await deleteAll('a.mjs', 'const a = typeof/* note */value;\nf(/* none */);\nfunction g() { return /*\n*/ 1; }\n');
  expect(out).toBe('const a = typeof value;\nf();\nfunction g() { return\n1; }\n');
});

test('a file changed since listing is refused', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'delete-comment-'));
  writeFileSync(path.join(dir, 'a.mjs'), '// gone\nconst a = 1;\n');
  writeFileSync(path.join(dir, 'blocks.json'), JSON.stringify({ files: { 'a.mjs': 'stale' }, blocks: [{ id: 1, file: 'a.mjs', start: 0, end: 7, line: 1, endLine: 1, text: ' gone', own: true }] }));
  writeFileSync(path.join(dir, 'decisions.txt'), '1 T');
  const run = Bun.spawnSync(['bun', apply, 'blocks.json', 'decisions.txt'], { cwd: dir });
  expect(run.exitCode).toBe(1);
  expect(readFileSync(path.join(dir, 'a.mjs'), 'utf8')).toBe('// gone\nconst a = 1;\n');
});
