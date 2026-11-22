import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [blocksPath, decisionsPath] = process.argv.slice(2);
const { files, blocks } = JSON.parse(readFileSync(blocksPath, 'utf8'));
const decided = new Set(readFileSync(decisionsPath, 'utf8').trim().split('\n').map((l) => Number(l.split(/\s+/)[0])));
const TYPED = /^@(type|typedef|param|returns?|callback|property|satisfies)\b[^\n]*\{/;
const KEEP = /^@(template|deprecated)\b/;

const chosen = blocks.filter((b) => decided.has(b.id));
const changed = [...new Set(chosen.map((b) => b.file))].filter((file) => createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex') !== files[file]);
if (changed.length) {
  console.error(`Changed since listing; run list.mjs again:\n${changed.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
for (const b of chosen.filter((x) => x.unsafe)) console.error(`Skipped [${b.id}] ${b.file}:${b.line}: not parsed, delete it by hand.`);

const typeTag = (line) => {
  if (line.startsWith('@deprecated')) return '@deprecated';
  if (!TYPED.test(line)) return line;
  let depth = 0;
  let i = line.indexOf('{');
  for (; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}' && --depth === 0) break;
  }
  const name = line.slice(i + 1).match(/^\s+\[?[\w.$=]+\]?/);
  return line.slice(0, i + 1) + (/^@(param|property|typedef)/.test(line) && name ? name[0] : '');
};

const byFile = {};
for (const b of chosen) if (!b.unsafe) (byFile[b.file] ??= []).push(b);

let removed = 0;
let shed = 0;
for (const [file, list] of Object.entries(byFile)) {
  let code = readFileSync(file, 'utf8');
  const before = code.split('\n').length;
  for (const b of list.sort((a, z) => z.start - a.start)) {
    removed++;
    const raw = code.slice(b.start, b.end);
    const lineStart = code.lastIndexOf('\n', b.start - 1) + 1;
    const tagLines = raw.split('\n').map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*)?\s?/, '').replace(/\*\/\s*$/, '').trim()).filter((l) => TYPED.test(l) || KEEP.test(l));
    if (raw.startsWith('/**') && tagLines.length) {
      if (tagLines.some((l) => /['"`]/.test(l) || (l.match(/\{/g) ?? []).length !== (l.match(/\}/g) ?? []).length)) {
        console.error(`Skipped [${b.id}] ${b.file}:${b.line}: a type tag is not simple enough to keep safely, edit it by hand.`);
        removed--;
        continue;
      }
      const kept = tagLines.map(typeTag);
      const indent = code.slice(lineStart, b.start).match(/^\s*/)[0];
      const doc = kept.length === 1 ? `/** ${kept[0]} */` : ['/**', ...kept.map((t) => `${indent} * ${t}`), `${indent} */`].join('\n');
      code = code.slice(0, b.start) + doc + code.slice(b.end);
      continue;
    }
    let start = b.start;
    let end = b.end;
    if (b.container) {
      const open = code.slice(0, start).match(/\{\s*$/);
      const close = code.slice(end).match(/^\s*\}/);
      if (open && close) {
        start -= open[0].length;
        end += close[0].length;
      }
    }
    if (b.container || raw.startsWith('<!--')) {
      const before = code.slice(0, start);
      const lineFrom = before.lastIndexOf('\n') + 1;
      let lineTo = code.indexOf('\n', end);
      if (lineTo < 0) lineTo = code.length;
      const last = (pattern) => Math.max(-1, ...[...before.matchAll(pattern)].map((m) => m.index));
      const verbatim = last(/<(pre|textarea)[\s>]/gi) > last(/<\/(pre|textarea)>/gi);
      const alone = !code.slice(lineFrom, start).trim() && !code.slice(end, lineTo).trim();
      const prev = code.slice(0, lineFrom).trimEnd();
      const next = code.slice(Math.min(lineTo + 1, code.length)).trimStart();
      const between = (!prev || /[>{]$/.test(prev) || /(^|\n)---$/.test(prev)) && (!next || /^[<}]/.test(next));
      if (verbatim || (alone && !between)) {
        console.error(`Skipped [${b.id}] ${b.file}:${b.line}: removing it could change rendered whitespace, edit it by hand.`);
        removed--;
        continue;
      }
      code = alone ? code.slice(0, lineFrom) + code.slice(Math.min(lineTo + 1, code.length)) : before + code.slice(end);
      continue;
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
    } else if (/\{[ \t]*$/.test(head) && /^[ \t]*\}/.test(tail)) {
      code = code.slice(0, start).replace(/[ \t]+$/, '') + code.slice(end).replace(/^[ \t]+/, '');
    } else {
      const rest = code.slice(end).replace(/^[ \t]+/, '');
      const left = code.slice(0, start).replace(/[ \t]+$/, '');
      const gap = raw.includes('\n') ? '\n' : /([([{]|\.\.\.)$/.test(left) || /^[)\]},;]/.test(rest) ? '' : ' ';
      code = left + gap + rest;
    }
  }
  shed += before - code.split('\n').length;
  writeFileSync(file, code);
}
console.log(`${removed} comments removed from ${Object.keys(byFile).length} files; ${shed} lines shed`);
