// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse as parseJs } from '@babel/parser';
import { parse as parseAstro } from '@astrojs/compiler';
import postcss from 'postcss';

const BASELINE_PATH = 'scripts/comment-baseline.json';
const SOURCE = /\.(astro|ts|tsx|js|mjs|css|sh)$/;
const EXCLUDED = /^(src\/content\/|media\/|src\/vendor\/|src\/lib\/stageshow\/|patches\/)/;
const DIRECTIVE = /^[*\s]*(@ts-|eslint|prettier-ignore|@vite-ignore|webpackIgnore|@jsx|[#@]__PURE__|@license|@preserve|shellcheck|good-enough: #\d+|!)|^\/\s*<reference|^[*\s]*@(type|typedef|param|returns?|template|callback|property|satisfies)\b[^\n]*\{/;

function jsComments(code, file) {
  const plugins = /** @type {any[]} */ ([]);
  if (/\.(tsx?|astro)$/.test(file)) plugins.push('typescript');
  if (!/\.(ts|astro)$/.test(file)) plugins.push('jsx');
  try {
    const ast = parseJs(code, { sourceType: 'module', plugins, errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    return (ast.comments ?? []).map((c) => ({ start: c.start ?? 0, end: c.end ?? 0, text: c.value }));
  } catch {
    return regexComments(code);
  }
}

function regexComments(code) {
  return [...code.matchAll(/\/\*[\s\S]*?\*\/|(?<![:'"`\w\\])\/\/[^\n]*/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0].replace(/^\/\/|^\/\*|\*\/$/g, ''),
  }));
}

function cssComments(code) {
  const out = [];
  try {
    postcss.parse(code).walkComments((c) => {
      const start = c.source?.start?.offset ?? 0;
      out.push({ start, end: code.indexOf('*/', start) + 2, text: c.text });
    });
  } catch {
    return regexComments(code).filter((c) => code.startsWith('/*', c.start));
  }
  return out;
}

function shellComments(code) {
  return [...code.matchAll(/^([ \t]*)(#(?!!)[^\n]*)/gm)].map((m) => ({ start: m.index + m[1].length, end: m.index + m[0].length, text: m[2].slice(1) }));
}

async function astroComments(code) {
  const { ast } = await parseAstro(code, { position: true });
  const regions = [];
  const walk = (node) => {
    const at = node.position?.start?.offset ?? 0;
    if (node.type === 'frontmatter') regions.push(['js', at + 3, node.value]);
    else if (node.type === 'comment') regions.push(['html', at, `<!--${node.value}-->`]);
    else if (node.type === 'element' && (node.name === 'script' || node.name === 'style')) {
      for (const child of node.children ?? []) if (child.type === 'text') regions.push([node.name === 'script' ? 'js' : 'css', child.position?.start?.offset ?? at, child.value]);
      return;
    } else if (node.type === 'expression') {
      for (const child of node.children ?? []) if (child.type === 'text') regions.push(['expr', child.position?.start?.offset ?? at, child.value]);
    }
    (node.children ?? []).forEach(walk);
  };
  walk(ast);

  const out = [];
  let cursor = 0;
  for (const [kind, approx, text] of regions.sort((a, b) => a[1] - b[1])) {
    let base = code.indexOf(text, Math.min(cursor, approx));
    if (base < 0) base = code.indexOf(text);
    if (base < 0) continue;
    cursor = base;
    const found =
      kind === 'html' ? [{ start: 0, end: text.length, text: text.slice(4, -3) }]
      : kind === 'css' ? cssComments(text)
      : kind === 'expr' ? regexComments(text)
      : jsComments(text, '.astro');
    out.push(...found.map((c) => ({ ...c, start: c.start + base, end: c.end + base })));
  }
  return out;
}

const lineAt = (code, offset) => code.slice(0, offset).split('\n').length;

export async function commentsIn(file, code = readFileSync(file, 'utf8')) {
  let found;
  if (file.endsWith('.astro')) found = await astroComments(code);
  else if (file.endsWith('.css')) found = cssComments(code);
  else if (file.endsWith('.sh')) found = shellComments(code);
  else found = jsComments(code, file);
  return found
    .filter((c) => !DIRECTIVE.test(c.text.trim()))
    .map((c) => ({ ...c, line: lineAt(code, c.start), endLine: lineAt(code, c.end) }));
}

export function sourceFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => SOURCE.test(f) && !EXCLUDED.test(f));
}

async function main() {
  const counts = {};
  for (const file of sourceFiles()) {
    const n = (await commentsIn(file)).length;
    if (n) counts[file] = n;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
    console.log(`Baseline: ${total} comments in ${Object.keys(counts).length} files.`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const grown = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
  const shrunk = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n);
  for (const [file, n] of grown) console.error(`${file}: ${n} comments (baseline ${baseline[file] ?? 0})`);
  if (grown.length) {
    console.error('\nNo new comments. Record non-obvious decisions in docs/adr/ and delete the rest (/delete-comment).');
    process.exit(1);
  }
  if (shrunk.length) {
    for (const [file, n] of shrunk) console.error(`${file}: ${counts[file] ?? 0} comments (baseline ${n})`);
    console.error('\nComments were removed. Run `bun run lint:comments --update` to tighten the ratchet.');
    process.exit(1);
  }
  console.log(`No new comments. ${total} remain under the ratchet.`);
}

if (import.meta.main) await main();
