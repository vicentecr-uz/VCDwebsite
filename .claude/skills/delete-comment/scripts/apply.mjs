import { readFileSync, writeFileSync } from 'node:fs';

const [blocksPath, decisionsPath] = process.argv.slice(2);
const blocks = JSON.parse(readFileSync(blocksPath, 'utf8'));
const decided = new Set(readFileSync(decisionsPath, 'utf8').trim().split('\n').map((l) => Number(l.split(/\s+/)[0])));
const TAG = /@(type|typedef|param|returns?|template|callback|property|satisfies)\b[^\n]*\{/;

const typeTag = (line) => {
  let depth = 0;
  let i = line.indexOf('{');
  for (; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}' && --depth === 0) break;
  }
  const name = line.slice(i + 1).match(/^\s+\[?[\w.$=]+\]?/);
  return line.slice(0, i + 1) + (/^@(param|property)/.test(line) && name ? name[0] : '');
};

const byFile = {};
for (const b of blocks) if (decided.has(b.id)) (byFile[b.file] ??= []).push(b);

let removed = 0;
let shed = 0;
for (const [file, list] of Object.entries(byFile)) {
  let code = readFileSync(file, 'utf8');
  const before = code.split('\n').length;
  for (const b of list.sort((a, z) => z.start - a.start)) {
    removed++;
    const raw = code.slice(b.start, b.end);
    const lineStart = code.lastIndexOf('\n', b.start - 1) + 1;
    if (raw.startsWith('/**') && TAG.test(raw)) {
      const kept = raw.split('\n')
        .map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*)?\s?/, '').replace(/\*\/\s*$/, '').trim())
        .filter((l) => l.startsWith('@') && TAG.test(l))
        .map(typeTag);
      const indent = code.slice(lineStart, b.start).match(/^\s*/)[0];
      const doc = kept.length === 1 ? `/** ${kept[0]} */` : ['/**', ...kept.map((t) => `${indent} * ${t}`), `${indent} */`].join('\n');
      code = code.slice(0, b.start) + doc + code.slice(b.end);
      continue;
    }
    let start = b.start;
    let end = b.end;
    const jsxOpen = code.slice(0, start).match(/(?:^|\n|>)[ \t]*\{\s*$/) && code.slice(0, start).match(/\{\s*$/);
    const jsxClose = code.slice(end).match(/^\s*\}/);
    if (jsxOpen && jsxClose && !raw.startsWith('//')) {
      start -= jsxOpen[0].length;
      end += jsxClose[0].length;
    }
    const from = code.lastIndexOf('\n', start - 1) + 1;
    let to = code.indexOf('\n', end);
    if (to < 0) to = code.length;
    const head = code.slice(from, start);
    const tail = code.slice(end, to);
    if (!head.trim() && !tail.trim()) {
      let next = Math.min(to + 1, code.length);
      if (code.slice(from - 2, from) === '\n\n' && /^[ \t]*\n/.test(code.slice(next))) next = code.indexOf('\n', next) + 1;
      code = code.slice(0, from) + code.slice(next);
    } else if (!tail.trim()) {
      code = code.slice(0, start).replace(/[ \t]+$/, '') + code.slice(to);
    } else {
      code = code.slice(0, start) + code.slice(end).replace(/^[ \t]+(?=\S)/, head.endsWith(' ') ? '' : ' ');
    }
  }
  code = code.replace(/catch \{ \}/g, 'catch {}');
  shed += before - code.split('\n').length;
  writeFileSync(file, code);
}
console.log(`${removed} comments removed from ${Object.keys(byFile).length} files; ${shed} lines shed`);
