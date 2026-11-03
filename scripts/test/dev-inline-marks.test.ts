import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'bun:test';
import { Window } from 'happy-dom';
import { applyInlineMark } from '../../src/lib/devInlineMarks';
import { clipboardParagraphHtml, readParagraphsValue, serializeInlineHtml } from '../../src/lib/devTextDom';

const dom = new Window();
const globals = ['document', 'Element', 'HTMLElement', 'Text', 'HTMLAnchorElement', 'HTMLBRElement'] as const;
const previous = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
beforeAll(() => {
  Object.assign(globalThis, Object.fromEntries(globals.map((key) => [key, Reflect.get(dom, key)])));
});
afterAll(() => Object.assign(globalThis, previous));

const paragraph = (html: string) => {
  const p = document.createElement('p');
  p.innerHTML = html;
  return p;
};
const select = (start: Node, from: number, end: Node, to: number) => {
  const range = document.createRange();
  range.setStart(start, from);
  range.setEnd(end, to);
  return range;
};

test('applies and removes code from a partial selection without changing surrounding text', () => {
  const p = paragraph('before middle after');
  const range = select(p.firstChild!, 7, p.firstChild!, 13);
  const restored = applyInlineMark(range, { code: true });
  assert.equal(serializeInlineHtml(p), 'before <code>middle</code> after');
  assert.equal(restored?.toString(), 'middle');
  const text = p.querySelector('code')!.firstChild!;
  applyInlineMark(select(text, 1, text, 4), { code: false });
  assert.equal(serializeInlineHtml(p), 'before <code>m</code>idd<code>le</code> after');
});

test('font changes preserve links, bold, italic, underline and tone across mixed marks', () => {
  const p = paragraph('<strong>bold</strong> <a href="/docs" class="is-underline-off"><em><u><span class="text-subtle">link</span></u></em></a>');
  const range = document.createRange();
  range.selectNodeContents(p);
  applyInlineMark(range, { code: true });
  const anchor = p.querySelector('a')!;
  assert.equal(anchor.getAttribute('href'), '/docs');
  assert.ok(anchor.classList.contains('is-underline-off'));
  assert.ok(anchor.querySelector('em u code'));
  assert.equal(p.querySelector('strong code')?.textContent, 'bold');
  assert.equal(p.querySelector('.text-subtle code')?.textContent, 'link');
  range.selectNodeContents(p);
  applyInlineMark(range, { code: false });
  assert.equal(p.querySelector('code'), null);
  assert.equal(p.textContent, 'bold link');
  assert.ok(p.querySelector('a em u'));
});

test('tone changes preserve existing code and paragraph wrapping', () => {
  const p = paragraph('<span data-text-wrap="pretty">Use <code><strong>sync()</strong></code> now</span>');
  const range = document.createRange();
  range.selectNodeContents(p);
  applyInlineMark(range, { tone: 'subtle' });
  assert.equal(p.getAttribute('data-text-wrap'), 'pretty');
  assert.equal(p.querySelector('code')?.textContent, 'sync()');
  assert.ok(p.querySelector('.text-subtle strong code'));
  range.selectNodeContents(p);
  applyInlineMark(range, { tone: 'default' });
  assert.equal(p.querySelector('.text-subtle'), null);
  assert.equal(p.querySelector('code')?.textContent, 'sync()');
});

test('code survives save and clipboard serialization with attributes stripped', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>Use <code class="unsafe" onclick="bad()" style="color:red"><strong>sync()</strong></code>.</p>';
  const value = readParagraphsValue(root);
  assert.deepEqual(value, ['Use <code><strong>sync()</strong></code>.']);
  assert.equal(clipboardParagraphHtml(root.textContent!, root.innerHTML), value[0]);
  root.innerHTML = `<p>${value[0]}</p>`;
  assert.deepEqual(readParagraphsValue(root), value);
});
