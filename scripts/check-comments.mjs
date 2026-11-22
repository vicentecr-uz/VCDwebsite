// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse as parseJs, parseExpression } from '@babel/parser';
import { parse as parseAstro } from '@astrojs/compiler';
import postcss from 'postcss';

const BASELINE_PATH = 'scripts/comment-baseline.json';
const SOURCE = /\.(astro|ts|tsx|js|mjs|css|sh)$/;
const EXCLUDED = /^(src\/content\/|media\/|src\/vendor\/|src\/lib\/stageshow\/|patches\/)/;
const MARKER = /^(known limit: issue|good-enough:) #\d+$/;
const DIRECTIVE = /^[*\s]*(@ts-|eslint|prettier-ignore|@vite-ignore|webpackIgnore|@jsx|[#@]__PURE__|@license|@preserve|shellcheck|!)|^\/\s*<reference|^[*\s]*@(type|typedef|param|returns?|callback|property|satisfies)\b[^\n]*\{|^[*\s]*@template\b|^[*\s]*@deprecated[*\s]*$/;

const emptyJsxContainers = (root) => {
  const ranges = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXExpressionContainer' && node.expression?.type === 'JSXEmptyExpression') ranges.push([node.start, node.end]);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(root);
  return ranges;
};

const withContainers = (code, comments, containers) => (comments ?? []).map((c) => {
  const start = c.start ?? 0;
  const end = c.end ?? 0;
  const container = containers.some(([a, z]) => a <= start && end <= z && !code.slice(a + 1, start).trim() && !code.slice(end, z - 1).trim());
  return { start, end, text: c.value, container };
});

function jsComments(code, file) {
  const plugins = /** @type {any[]} */ ([]);
  if (/\.(tsx?|astro)$/.test(file)) plugins.push('typescript');
  if (!/\.(ts|astro)$/.test(file)) plugins.push('jsx');
  try {
    const ast = parseJs(code, { sourceType: 'module', plugins, errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    return withContainers(code, ast.comments, plugins.includes('jsx') ? emptyJsxContainers(ast.program) : []);
  } catch {
    return regexComments(code);
  }
}

function expressionComments(code) {
  try {
    const node = parseExpression(code, { plugins: ['typescript', 'jsx'] });
    return withContainers(code, /** @type {any} */ (node).comments, emptyJsxContainers(node));
  } catch {
    return jsComments(code, '.tsx');
  }
}

function regexComments(code) {
  return [...code.matchAll(/\/\*[\s\S]*?\*\/|(?<![:'"`\w\\])\/\/[^\n]*/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0].replace(/^\/\/|^\/\*|\*\/$/g, ''),
    unsafe: true,
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

const byteToChar = (code) => {
  const map = [];
  for (let i = 0; i < code.length; i++) {
    const point = code.codePointAt(i) ?? 0;
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    for (let k = 0; k < size; k++) map.push(i);
    if (point > 0xffff) i++;
  }
  map.push(code.length);
  return (offset) => map[offset] ?? code.length;
};

async function astroComments(code) {
  const { ast } = await parseAstro(code, { position: true });
  const toChar = byteToChar(code);
  const regions = [];
  const walk = (node) => {
    const at = toChar(node.position?.start?.offset ?? 0);
    if (node.type === 'frontmatter') regions.push(['js', at + 3, node.value]);
    else if (node.type === 'comment') regions.push(['html', at - 4, `<!--${node.value}-->`]);
    else if (node.type === 'element' && (node.name === 'script' || node.name === 'style')) {
      for (const child of node.children ?? []) if (child.type === 'text') regions.push([node.name === 'script' ? 'js' : 'css', toChar(child.position?.start?.offset ?? 0), child.value]);
      return;
    } else if (node.type === 'expression') {
      const texts = (node.children ?? []).filter((child) => child.type === 'text');
      const whole = texts.length === 1 && texts.length === (node.children ?? []).length;
      for (const child of texts) regions.push([whole ? 'wrapped' : 'expr', toChar(child.position?.start?.offset ?? 0), child.value]);
    }
    for (const attribute of node.attributes ?? []) {
      const at = toChar(attribute.position?.start?.offset ?? 0);
      if (attribute.kind === 'expression') regions.push(['attribute', at, attribute.value]);
      else if (attribute.kind === 'spread') regions.push(['spread', at, attribute.name]);
    }
    (node.children ?? []).forEach(walk);
  };
  walk(ast);

  const out = [];
  const used = new Set();
  for (const [kind, approx, text] of regions) {
    if (!text) continue;
    let base = -1;
    let verified = false;
    if (kind === 'attribute' || kind === 'spread') {
      base = code.indexOf(text, approx);
      verified = base >= 0 && (kind === 'spread' ? /^(\{\s*\.\.\.)?\s*$/ : /^[^\s=]+\s*=\s*\{\s*$/).test(code.slice(approx, base));
    } else if (code.startsWith(text, approx)) {
      base = approx;
      verified = true;
    } else {
      let seen = 0;
      for (let i = code.indexOf(text); i >= 0; i = code.indexOf(text, i + 1)) {
        seen++;
        if (!used.has(i) && (base < 0 || Math.abs(i - approx) < Math.abs(base - approx))) base = i;
      }
      verified = seen === 1;
    }
    if (base < 0) continue;
    used.add(base);
    let found;
    if (kind === 'html') found = [{ start: 0, end: text.length, text: text.slice(4, -3) }];
    else if (kind === 'css') found = cssComments(text);
    else if (kind === 'js') found = jsComments(text, '.astro');
    else if (kind === 'attribute' || kind === 'spread') found = expressionComments(text);
    else {
      found = jsComments(text, '.tsx');
      if (kind === 'wrapped' && found.length === 1 && !text.slice(0, found[0].start).trim() && !text.slice(found[0].end).trim()) found[0].container = true;
    }
    out.push(...found.map((c) => ({ ...c, start: c.start + base, end: c.end + base, unsafe: c.unsafe || !verified })));
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
    .filter((c) => !DIRECTIVE.test(c.text.trim()) && !MARKER.test(c.text.trim()))
    .map((c) => ({ ...c, line: lineAt(code, c.start), endLine: lineAt(code, c.end) }));
}

export function sourceFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0')
    .filter((f, i, all) => SOURCE.test(f) && !EXCLUDED.test(f) && all.indexOf(f) === i && existsSync(f));
}

function checkMarkerIssues() {
  const open = new Set(JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number'], { encoding: 'utf8' })).map((i) => i.number));
  const stale = sourceFiles().flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/known limit: issue #(\d+)/g)].filter((m) => !open.has(Number(m[1]))).map((m) => `${file}: issue #${m[1]} is not open`),
  );
  for (const line of stale) console.error(line);
  if (stale.length) {
    console.error('\nA shortcut whose issue closed must be fixed or re-filed; remove or update its marker.');
    process.exit(1);
  }
  console.log('Every known-limit marker points at an open issue.');
}

async function main() {
  if (process.argv.includes('--issues')) return checkMarkerIssues();
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
  const ref = process.argv[process.argv.indexOf('--against') + 1];
  const grownFromTarget = [];
  if (process.argv.includes('--against')) {
    let target;
    try {
      target = JSON.parse(execFileSync('git', ['show', `${ref}:${BASELINE_PATH}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      console.log(`No baseline on ${ref}; checking this branch only.`);
    }
    for (const file of Object.keys({ ...baseline, ...counts })) if (target && (counts[file] ?? 0) > (target[file] ?? 0)) grownFromTarget.push(file);
  }
  const grown = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0) || grownFromTarget.includes(file));
  const shrunk = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) !== n);
  for (const [file, n] of grown) console.error(`${file}: ${n} comments (baseline ${baseline[file] ?? 0})`);
  if (grown.length) {
    console.error('\nNo new comments. Record decisions in docs/adr/, mark shortcuts `known limit: issue #N`, delete the rest (/delete-comment).');
    process.exit(1);
  }
  if (shrunk.length) {
    for (const [file, n] of shrunk) console.error(`${file}: ${counts[file] ?? 0} comments (baseline ${n})`);
    console.error('\nThe baseline does not match the code. Run `bun run lint:comments --update`.');
    process.exit(1);
  }
  console.log(`No new comments. ${total} remain under the ratchet.`);
}

if (import.meta.main) await main();
