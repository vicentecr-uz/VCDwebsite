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

const skipped = [];
const skip = (b, why) => skipped.push(`[${b.id}] ${b.file}:${b.line}: ${why}, edit it by hand.`);

const keptTag = (line) => {
  if (line.startsWith('@deprecated')) return '@deprecated';
  if (!TYPED.test(line)) return line;
  if (/['"`]/.test(line)) return null;
  let depth = 0;
  let i = line.indexOf('{');
  for (; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}' && --depth === 0) break;
  }
  if (i >= line.length) return null;
  const type = line.slice(0, i + 1);
  if (!/^@(param|property|typedef)/.test(line)) return type;
  const name = line.slice(i + 1).match(/^\s+(\[[^\]\s]*\]|[\w.$]+)(?=\s|$)/);
  return name ? type + name[0] : null;
};

const byFile = {};
for (const b of chosen) {
  const raw = readFileSync(b.file, 'utf8').slice(b.start, b.end);
  if (b.unsafe) skip(b, 'not parsed');
  else if (b.container || raw.startsWith('<!--')) skip(b, 'markup comment; removing it can change rendered whitespace');
  else (byFile[b.file] ??= []).push(b);
}

let removed = 0;
let shed = 0;
for (const [file, list] of Object.entries(byFile)) {
  let code = readFileSync(file, 'utf8');
  const before = code.split('\n').length;
  for (const b of list.sort((a, z) => z.start - a.start)) {
    const { start, end } = b;
    const raw = code.slice(start, end);
    const from = code.lastIndexOf('\n', start - 1) + 1;
    const tags = raw.split('\n').map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*)?\s?/, '').replace(/\*\/\s*$/, '').trim()).filter((l) => TYPED.test(l) || KEEP.test(l));
    if (raw.startsWith('/**') && tags.length) {
      const kept = tags.map(keptTag);
      if (kept.includes(null)) {
        skip(b, 'a type tag cannot be kept whole');
        continue;
      }
      const indent = code.slice(from, start).match(/^\s*/)[0];
      const doc = kept.length === 1 ? `/** ${kept[0]} */` : ['/**', ...kept.map((t) => `${indent} * ${t}`), `${indent} */`].join('\n');
      code = code.slice(0, start) + doc + code.slice(end);
      removed++;
      continue;
    }
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
      const left = code.slice(0, start).replace(/[ \t]+$/, '');
      const rest = code.slice(end).replace(/^[ \t]+/, '');
      const gap = raw.includes('\n') ? '\n' : /([([{]|\.\.\.)$/.test(left) || /^[)\]},;]/.test(rest) ? '' : ' ';
      code = left + gap + rest;
    }
    removed++;
  }
  shed += before - code.split('\n').length;
  writeFileSync(file, code);
}
for (const line of skipped) console.error(`Skipped ${line}`);
console.log(`${removed} comments removed from ${Object.keys(byFile).length} files; ${shed} lines shed; ${skipped.length} left for hand editing`);
