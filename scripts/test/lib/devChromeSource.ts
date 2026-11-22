import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dir, '../../..');
const src = path.join(root, 'src');

export const sourceFiles = (dir = src, pattern = /\.(astro|css|tsx?|jsx?|mjs)$/): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return file === path.join(src, 'content') ? [] : sourceFiles(file, pattern);
    return pattern.test(entry.name) ? [file] : [];
  });

export const rel = (absolute: string) => path.relative(root, absolute);
export const read = (absolute: string) => readFileSync(absolute, 'utf8');
const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

const splitTop = (text: string, sep: RegExp) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && sep.test(char)) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

const unwrapGlobal = (selector: string) => selector.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1');

export const subjects = (selectorList: string) =>
  splitTop(unwrapGlobal(selectorList), /,/).map((selector) => {
    const compounds = splitTop(selector.replace(/\s*[>+~]\s*/g, ' '), /\s/);
    return { selector, subject: compounds.at(-1) ?? '' };
  });

export const hasClass = (compound: string, name: string) =>
  new RegExp(`\\.${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(compound);

export type Rule = { file: string; line: number; selectors: string; declarations: Array<[string, string]> };

export const cssRules = (absolute: string): Rule[] => {
  const file = rel(absolute);
  const source = read(absolute);
  const regions = absolute.endsWith('.css')
    ? [{ text: source, offset: 0 }]
    : [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ text: m[1], offset: m.index! + m[0].indexOf(m[1]) }));
  return regions.flatMap(({ text, offset }) => {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
    return [...clean.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
      .filter((m) => !m[1].trim().startsWith('@'))
      .map((m) => ({
        file,
        line: lineOf(source, offset + m.index! + m[1].search(/\S/)),
        selectors: m[1].trim(),
        declarations: m[2].split(';').map((d) => d.split(':')).filter((d) => d.length > 1)
          .map(([prop, ...value]) => [prop.trim().toLowerCase(), value.join(':').trim()] as [string, string]),
      }));
  });
};

export const tagAt = (source: string, start: number) => {
  let depth = 0;
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
};

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export type Tag = { file: string; line: number; name: string; text: string };

export const childrenOf = (absolute: string, parent: string): Tag[] => {
  const file = rel(absolute);
  const source = read(absolute).replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/g, (block) => block.replace(/[^\n]/g, ' '));
  const tags = [...source.matchAll(/<(\/?)([A-Za-z][\w.:-]*)/g)];
  const children: Tag[] = [];
  let depth = -1;
  for (const match of tags) {
    const [, closing, name] = match;
    if (depth === -1) {
      if (!closing && name === parent) {
        const text = tagAt(source, match.index!);
        if (!text.endsWith('/>')) depth = 0;
      }
      continue;
    }
    if (closing) { depth--; continue; }
    const text = tagAt(source, match.index!);
    if (depth === 0) children.push({ file, line: lineOf(source, match.index!), name, text });
    if (!text.endsWith('/>') && !VOID.has(name.toLowerCase())) depth++;
  }
  return children;
};

export const classTokens = (tagText: string) => {
  const tokens = new Set<string>();
  for (const m of tagText.matchAll(/\bclass(?::list)?=(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) {
    const literal = m[1] ?? m[2];
    const strings = literal !== undefined ? [literal] : [...m[3].matchAll(/['"`]([^'"`]*)['"`]/g)].map((s) => s[1]);
    strings.forEach((s) => s.split(/\s+/).filter((t) => /^[a-z][\w-]*$/i.test(t)).forEach((t) => tokens.add(t)));
  }
  return [...tokens];
};

export const inlineStyle = (tagText: string) => tagText.match(/\bstyle=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/)?.slice(1).find((v) => v !== undefined) ?? '';
