import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  const source = '---\n---\n<!-- same -->\n<p>keep</p>\n<!-- same -->\n';
  const found = await commentsIn('a.astro', source);
  expect(found.map((c) => [c.start, source.slice(c.start, c.end)])).toEqual([[8, '<!-- same -->'], [34, '<!-- same -->']]);
});

test('comment-like strings in Astro expressions are not comments', async () => {
  const { found } = await deleteAll('a.astro', "---\n---\n<p>{'/* literal */'}</p>\n");
  expect(found).toHaveLength(0);
});

test('Astro expression attributes are scanned', async () => {
  const { found } = await deleteAll('a.astro', '---\n---\n<p class={[\n  // note\n  "a",\n]}>x</p>\n');
  expect(found.map((c) => c.text.trim())).toEqual(['note']);
});

test('a catch block keeps its braces and strings are untouched', async () => {
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

const list = path.resolve(import.meta.dir, '../../.claude/skills/delete-comment/scripts/list.mjs');
const checker = path.resolve(import.meta.dir, '../check-comments.mjs');
const repo = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'delete-comment-repo-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), source);
  }
  const git = (...args) => Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'init');
  return { dir, git };
};

test('an attribute comment anchors to its own attribute, not an earlier string', async () => {
  const { found, out } = await deleteAll('a.astro', '---\n---\n<p title="/* note */ foo" verylongattributename={/* note */ foo}>x</p>\n');
  expect(found).toHaveLength(1);
  expect(out).toBe('---\n---\n<p title="/* note */ foo" verylongattributename={foo}>x</p>\n');
});

test('strings inside object-literal attributes and spread comments are classified correctly', async () => {
  expect(await commentsIn('a.astro', '---\n---\n<p test={{ a: 1, b: "/* literal */" }}>x</p>\n')).toHaveLength(0);
  expect((await commentsIn('a.astro', '---\n---\n<p {.../* note */ props}>x</p>\n')).map((c) => c.text.trim())).toEqual(['note']);
});

test('markup comments are listed but left for a person', async () => {
  const source = '---\n---\n<p>hello{/* note */}world</p>\n<p>a<!-- x -->b</p>\n<div>\n  <!-- between tags -->\n  <p>x</p>\n</div>\n<pre>hello\n<!-- note -->\nworld</pre>\n<Widget title={<div>{/* nested */}</div>} />\n';
  const { found, out } = await deleteAll('a.astro', source);
  expect(found).toHaveLength(5);
  expect(found.filter((c) => c.container).map((c) => c.text.trim())).toEqual(['note', 'nested']);
  expect(out).toBe(source);
});

test('a typedef keeps its name', async () => {
  const { out } = await deleteAll('a.mjs', '/**\n * Prose.\n * @typedef {{ name: string }} Failure\n */\n');
  expect(out).toBe('/** @typedef {{ name: string }} Failure */\n');
});

test('list keeps a JSDoc block apart from the line comment above it', () => {
  const { dir } = repo({ 'src/a.mjs': '// note\n/**\n * Prose.\n * @template T\n * @param {T} v\n */\nexport function f(v) { return v; }\n' });
  Bun.spawnSync(['bun', list, '^src/', 'blocks.json'], { cwd: dir });
  const { blocks } = JSON.parse(readFileSync(path.join(dir, 'blocks.json'), 'utf8'));
  writeFileSync(path.join(dir, 'decisions.txt'), blocks.map((b) => `${b.id} T`).join('\n'));
  Bun.spawnSync(['bun', apply, 'blocks.json', 'decisions.txt'], { cwd: dir });
  expect(readFileSync(path.join(dir, 'src/a.mjs'), 'utf8')).toBe('/**\n * @template T\n * @param {T} v\n */\nexport function f(v) { return v; }\n');
});

test('the baseline must match the code, and cannot grow past the target branch', () => {
  const twoComments = '// a\n// b\nexport const x = 1;\n';
  const { dir, git } = repo({ 'src/a.mjs': twoComments, 'scripts/comment-baseline.json': JSON.stringify({ 'src/a.mjs': 2 }) });
  const check = (...args) => Bun.spawnSync(['bun', checker, ...args], { cwd: dir }).exitCode;
  expect(check()).toBe(0);
  writeFileSync(path.join(dir, 'scripts/comment-baseline.json'), JSON.stringify({ 'src/a.mjs': 9 }));
  expect(check()).toBe(1);
  git('switch', '-qc', 'feature');
  writeFileSync(path.join(dir, 'src/a.mjs'), `// c\n${twoComments}`);
  writeFileSync(path.join(dir, 'scripts/comment-baseline.json'), JSON.stringify({ 'src/a.mjs': 3 }));
  expect(check()).toBe(0);
  expect(check('--against', 'main')).toBe(1);
  writeFileSync(path.join(dir, 'src/a.mjs'), twoComments);
  writeFileSync(path.join(dir, 'scripts/comment-baseline.json'), JSON.stringify({ 'src/a.mjs': 9 }));
  expect(check('--against', 'main')).toBe(1);
});


test('a spread attribute comment is applied', async () => {
  const { out } = await deleteAll('a.astro', '---\n---\n<p {.../* note */ props}>x</p>\n');
  expect(out).toBe('---\n---\n<p {...props}>x</p>\n');
});

test('a JSDoc tag that spans lines is left for a person', async () => {
  for (const source of ['/**\n * Prose.\n * @param {number}\n *   count\n */\n', '/**\n * Prose.\n * @param {string[]} [keys=[]] keys\n */\n', '/**\n * Prose.\n * @typedef {{\n *   name: string\n * }} Failure\n */\n', '/**\n * Prose.\n * @param {{ name: "}}"\n * }} v\n */\n']) {
    expect((await deleteAll('a.mjs', source)).out).toBe(source);
  }
});
