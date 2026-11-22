import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commentsIn, sourceFiles } from '../../../../scripts/check-comments.mjs';

const [scope = '.', out = 'blocks.json'] = process.argv.slice(2);
const pattern = new RegExp(scope);
const blocks = [];
for (const file of sourceFiles().filter((f) => pattern.test(f))) {
  const code = readFileSync(file, 'utf8');
  for (const c of await commentsIn(file, code)) {
    const own = /^\s*$/.test(code.slice(code.lastIndexOf('\n', c.start - 1) + 1, c.start));
    const prev = blocks.at(-1);
    if (prev && prev.file === file && own && prev.own && c.line === prev.endLine + 1 && /^\s*$/.test(code.slice(prev.end, c.start))) {
      Object.assign(prev, { end: c.end, endLine: c.endLine, text: `${prev.text}\n${c.text}` });
    } else blocks.push({ id: blocks.length + 1, file, start: c.start, end: c.end, line: c.line, endLine: c.endLine, text: c.text, own });
  }
}
writeFileSync(out, JSON.stringify(blocks));

const lines = {};
let last = '';
for (const b of blocks) {
  const src = (lines[b.file] ??= readFileSync(b.file, 'utf8').split('\n'));
  if (b.file !== last) console.log(`\n=== ${(last = b.file)}`);
  const text = b.text.split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim()).filter(Boolean).join(' ');
  const next = (b.own ? src[b.endLine] : src[b.line - 1]) ?? '';
  console.log(`[${b.id}] L${b.line}${b.own ? '' : ' (trailing)'}: ${text}\n    > ${next.trim().slice(0, 150)}`);
}
console.error(`${blocks.length} comment blocks in ${new Set(blocks.map((b) => b.file)).size} files → ${path.resolve(out)}`);
