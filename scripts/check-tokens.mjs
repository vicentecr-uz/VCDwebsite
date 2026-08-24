// @ts-check
/**
 * Fails (exit 1) on token drift:
 *  - a `var(--ref-*|--sys-*|--comp-*)` used in src/ that isn't defined in
 *    tokens/design-tokens.json
 *  - any leftover `--color-*` reference anywhere in src/
 *  - src/styles/global.css not matching what the generator would produce
 *  - the token name set drifting from the Figma snapshot in
 *    tokens/figma-tokens.json (refresh that file when Figma variables change)
 *
 * `bun run tokens:check`
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  TOKENS_RELATIVE_PATH,
  CSS_RELATIVE_PATH,
  collectAllTokenNames,
  generateTokenBlock,
  applyTokenBlock,
} from './build-tokens.mjs';

const root = process.cwd();
const tokensPath = path.join(root, TOKENS_RELATIVE_PATH);
const figmaPath = path.join(root, 'tokens/figma-tokens.json');
const cssPath = path.join(root, CSS_RELATIVE_PATH);
const srcDir = path.join(root, 'src');

const SCAN_EXTS = ['.astro', '.css', '.ts', '.tsx', '.mjs', '.js', '.json'];
const VAR_RE = /var\((--(?:ref|sys|comp)-[A-Za-z0-9-]+)/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (SCAN_EXTS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const json = JSON.parse(readFileSync(tokensPath, 'utf8'));
const definedNames = collectAllTokenNames(json);
const files = walk(srcDir);

const undefinedUses = new Map();
const colorLeftovers = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(root, file);

  let match;
  VAR_RE.lastIndex = 0;
  while ((match = VAR_RE.exec(text))) {
    const name = match[1];
    if (!definedNames.has(name)) {
      if (!undefinedUses.has(name)) undefinedUses.set(name, new Set());
      undefinedUses.get(name).add(rel);
    }
  }

  text.split('\n').forEach((line, index) => {
    if (line.includes('--color-')) {
      colorLeftovers.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
}

let ok = true;
const problems = [];

if (undefinedUses.size) {
  ok = false;
  problems.push('Undefined token references (used in src/ but missing from tokens/design-tokens.json):');
  for (const [name, filesSet] of undefinedUses) {
    problems.push(`  ${name}`);
    for (const f of filesSet) problems.push(`    ${f}`);
  }
}

if (colorLeftovers.length) {
  ok = false;
  problems.push('Legacy --color-* references remain in src/:');
  for (const line of colorLeftovers) problems.push(`  ${line}`);
}

const cssSource = readFileSync(cssPath, 'utf8');
const generatedBlock = generateTokenBlock(json);
const { changed } = applyTokenBlock(cssSource, generatedBlock);
if (changed) {
  ok = false;
  problems.push(`${CSS_RELATIVE_PATH} is stale — run \`bun run tokens:build\` and commit the result.`);
}

// Figma is the design side of the same contract. Names are derived from it by a
// pure string rule, so any divergence means one side moved without the other.
try {
  const figma = JSON.parse(readFileSync(figmaPath, 'utf8'));
  const figmaNames = new Set(figma.names);
  const missingInJson = [...figmaNames].filter((n) => !definedNames.has(n)).sort();
  const missingInFigma = [...definedNames].filter((n) => !figmaNames.has(n)).sort();

  if (missingInJson.length || missingInFigma.length) {
    ok = false;
    problems.push('Figma / source token drift:');
    for (const n of missingInJson) problems.push(`  in Figma, missing from design-tokens.json: ${n}`);
    for (const n of missingInFigma) problems.push(`  in design-tokens.json, missing from Figma: ${n}`);
    problems.push('  If Figma is the one that moved, refresh tokens/figma-tokens.json.');
  }
} catch (error) {
  ok = false;
  problems.push(`Could not read tokens/figma-tokens.json: ${error instanceof Error ? error.message : error}`);
}

if (!ok) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log('tokens: check passed');
