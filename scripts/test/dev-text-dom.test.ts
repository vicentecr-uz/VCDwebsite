import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'bun:test';
import { Window } from 'happy-dom';
import { clipboardParagraphHtml, readParagraphsValue, serializeInlineHtml } from '../../src/lib/devTextDom.ts';

const dom = new Window();
const previousDocument = globalThis.document;
const previousElement = globalThis.Element;
beforeAll(() => Object.assign(globalThis, { document: dom.document, Element: dom.Element }));
afterAll(() => Object.assign(globalThis, { document: previousDocument, Element: previousElement }));

const el = (html: string) => {
  const root = dom.document.createElement('div');
  root.innerHTML = html;
  return root;
};

test('serializes supported inline markup and escapes unsafe content', () => {
  assert.equal(serializeInlineHtml(el('<strong>A &amp; B</strong><script>bad()</script><a href="https://e.test/?a=1&amp;b=2">go</a>')), '<strong>A &amp; B</strong><a href="https://e.test/?a=1&amp;b=2">go</a>');
  assert.equal(serializeInlineHtml(el('<a href="javascript:alert(1)">unsafe</a><span class="text-emphasis">ok</span>')), 'unsafe<span class="text-emphasis">ok</span>');
  assert.equal(serializeInlineHtml(el('<strong>root <a href="/x">link</a></strong><br>')), '<strong>root <a href="/x">link</a></strong><br>');
  assert.equal(serializeInlineHtml(el('<p><br></p>').firstElementChild!), '');
});

test('reads mixed blocks without dropping root inline content', () => {
  assert.deepEqual(readParagraphsValue(el('<p>one<br>two</p>\n <div><h2>three</h2><blockquote>four</blockquote></div>')), ['one<br>two', 'three', 'four']);
  assert.deepEqual(readParagraphsValue(el('root <strong>bold</strong><div>inside</div><p></p><div>tail<br><br></div>')), ['root <strong>bold</strong>', 'inside', '', 'tail<br><br>']);
  assert.deepEqual(readParagraphsValue(el('<div><span>before</span><p>nested</p><a href="#after">after</a></div>')), ['before', 'nested', '<a href="#after">after</a>']);
  assert.deepEqual(readParagraphsValue(el('<p> </p><p><br></p>')), [' ', '']);
  assert.deepEqual(readParagraphsValue(el('<p>typed<br><br></p>')), ['typed<br><br>']);
  assert.deepEqual(readParagraphsValue(el('<p>typed<br><br data-dev-placeholder="true"></p>')), ['typed<br>']);
});

test('normalizes OCR clipboard text and preserves paragraph structure', () => {
  const fixture = `Vicente Cruz\r\n\r\nDesign Engineer\r\n\r\nHi, I'm Vince. I was born in Rome and live in London.\r\n\r\nI currently work on the design team at Kingfisher, designing hand and power tools.\r\n\r\nI'm also building a designer-focused web portfolio editor, which I've used to make this website.\r\n\r\nI care about how things look and feel, how they work and how to make them real.\r\n\r\nYou can find me on Instagram and X, or reach me on LinkedIn.\r\n\r\nOpen to founding designer / design engineer roles.`;
  assert.equal(clipboardParagraphHtml(fixture, ''), '<p>Vicente Cruz</p><p>Design Engineer</p><p>Hi, I\'m Vince. I was born in Rome and live in London.</p><p>I currently work on the design team at Kingfisher, designing hand and power tools.</p><p>I\'m also building a designer-focused web portfolio editor, which I\'ve used to make this website.</p><p>I care about how things look and feel, how they work and how to make them real.</p><p>You can find me on Instagram and X, or reach me on LinkedIn.</p><p>Open to founding designer / design engineer roles.</p>');
  assert.equal(clipboardParagraphHtml('line one\nline two', ''), 'line one<br>line two');
  assert.equal(clipboardParagraphHtml('a\n', ''), 'a<br>');
  assert.equal(clipboardParagraphHtml('a\n\n', ''), '<p>a</p><p><br data-dev-placeholder="true"></p>');
  assert.equal(clipboardParagraphHtml('a\n\n\nb', ''), '<p>a</p><p><br>b</p>');
});

test('sanitizes rich clipboard HTML and does not mutate it', () => {
  const source = el('<p><strong>bold</strong> <a href="/profile">link</a></p><script>bad()</script>');
  const before = source.innerHTML;
  assert.equal(clipboardParagraphHtml('fallback', source.innerHTML), '<strong>bold</strong> <a href="/profile">link</a>');
  assert.equal(source.innerHTML, before);
  assert.equal(clipboardParagraphHtml('plain', '<p><iframe src="https://evil.test"></iframe></p>'), 'plain');
  assert.equal(clipboardParagraphHtml('< & "', ''), '&lt; &amp; "');
});


test('Save and reload preserve literal text and every unmarked trailing break', () => {
  const root = el('<p>Design &lt;engineer&gt; &amp; maker<br><br></p><p>Next</p>');
  const original = root.innerHTML;
  const value = readParagraphsValue(root);
  assert.equal(root.innerHTML, original);
  const reloaded = el(value.map((paragraph) => `<p>${paragraph}</p>`).join(''));
  assert.deepEqual(readParagraphsValue(reloaded), value);
  assert.equal(reloaded.innerHTML, original);
});


test('nested clipboard wrappers retain boundaries and supported marks', () => {
  assert.deepEqual(readParagraphsValue(el('<strong><div>one</div><div>two</div></strong>')), ['<strong>one</strong>', '<strong>two</strong>']);
  assert.deepEqual(readParagraphsValue(el('<br>')), ['']);
});
