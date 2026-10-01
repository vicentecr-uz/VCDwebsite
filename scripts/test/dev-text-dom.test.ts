import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'bun:test';
import { Window } from 'happy-dom';
import { clipboardParagraphHtml, paragraphTextWrap, readPlainDomText, refreshParagraphWrapping, readParagraphsValue, resolveAutoTextWrap, serializeInlineHtml } from '../../src/lib/devTextDom.ts';
import { resolveTextWrapHtml } from '../../src/lib/projectTextWrap.ts';

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
  assert.equal(serializeInlineHtml(el('<a href="javascript:alert(1)">unsafe</a><span class="text-emphasis">old tone</span><span class="text-subtle">quiet tone</span>')), 'unsafe<span class="text-emphasis">old tone</span><span class="text-subtle">quiet tone</span>');
  assert.equal(serializeInlineHtml(el('<strong>root <a href="/x">link</a></strong><br>')), '<strong>root <a href="/x">link</a></strong><br>');
  assert.equal(serializeInlineHtml(el('<p><br></p>').firstElementChild!), '');
});

test('reads BR elements as newlines in plain DOM text', () => {
  assert.equal(readPlainDomText(el('writer\'s<br>dream')), "writer's\ndream");
  assert.equal(readPlainDomText(el('<br data-dev-placeholder="true">')), '');
});

test('preserves and normalizes paragraph wrapping metadata', () => {
  assert.equal(serializeInlineHtml(el('<span data-text-wrap="pretty">Newsletter copy</span>')), '<span data-text-wrap="pretty">Newsletter copy</span>');
  assert.equal(serializeInlineHtml(el('<span data-text-wrap="danger">copy</span>')), 'copy');
  assert.equal(paragraphTextWrap(el('<p><span data-text-wrap="balance">Heading</span></p>').firstElementChild!), 'balance');
  assert.equal(paragraphTextWrap(el('<p>copy</p>').firstElementChild!), 'auto');
  assert.equal(paragraphTextWrap(el('<p>copy</p>').firstElementChild!, true), 'balance');
  assert.equal(resolveTextWrapHtml('<span data-text-wrap="pretty">copy</span>'), 'pretty');
  assert.equal(resolveTextWrapHtml('<span data-text-wrap="auto"><span class="text-emphasis">Heading</span></span>'), 'balance');
  assert.equal(resolveTextWrapHtml('<span data-text-wrap="auto"><span class="text-emphasis">Heading</span> copy</span>'), 'normal');
  assert.equal(resolveTextWrapHtml('<span data-text-wrap="auto"><span class="text-emphasis"><span>Heading</span></span></span>'), 'balance');
  assert.equal(resolveTextWrapHtml('<span data-text-wrap="auto"><span class="text-emphasis"><span>Heading</span></span> copy</span>'), 'normal');
  assert.equal(resolveTextWrapHtml('<span data-text-wrap="auto"><span class="text-emphasis">Heading</span> <strong>copy</strong></span>'), 'normal');
});

test('static and live Auto wrapping classify the same inline content', () => {
  const cases: Array<[string, 'balance' | 'normal' | 'pretty', boolean?]> = [
    ['<span class="text-emphasis">Heading</span>', 'balance'],
    ['<span class="text-emphasis">Heading</span> copy', 'normal'],
    ['<a href="/x"><span class="text-emphasis">Linked heading</span></a>', 'balance'],
    ['<span class="text-emphasis"><span>Nested heading</span></span>', 'balance'],
    ['<span class="text-emphasis"><span class="text-subtle">Quiet heading</span></span>', 'normal'],
    ['<span class="text-emphasis">Heading</span>&#xA0;', 'balance'],
    ['<span class="text-emphasis">Heading</span>&nbsp;copy', 'normal'],
    ['<span data-text-wrap="pretty">A description</span>', 'pretty'],
    ['<span data-text-wrap="normal"><span class="text-emphasis">Heading</span></span>', 'normal'],
    ['<span data-text-wrap="balance">A paragraph</span>', 'balance'],
    ['<span data-text-wrap="auto"><span class="text-emphasis">Heading</span></span>', 'balance'],
    ['<span data-text-wrap="auto"><span class="text-emphasis">Heading</span></span>', 'balance', true],
    ['<span data-text-wrap="invalid"><span class="text-emphasis">Heading</span></span>', 'balance'],
  ];

  cases.forEach(([html, expected, legacyBalance]) => {
    const paragraph = el(`<p>${html}</p>`).firstElementChild!;
    const liveMode = paragraphTextWrap(paragraph, legacyBalance);
    const live = liveMode === 'auto' ? resolveAutoTextWrap(paragraph) : liveMode;
    assert.equal(live, expected, `live classification for ${html}`);
    assert.equal(resolveTextWrapHtml(html, legacyBalance), expected, `static classification for ${html}`);
  });

  const div = el('<div><span class="text-emphasis">Heading</span></div>').firstElementChild!;
  assert.equal(paragraphTextWrap(div), 'auto');
  assert.equal(resolveAutoTextWrap(div), 'balance');
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

test('preserves right tab markers while stripping invalid marker values and unsafe attributes', () => {
  assert.equal(serializeInlineHtml(el('<span data-text-right-tab="true" onclick="bad()"><strong>2024</strong></span>')), '<span data-text-right-tab="true"><strong>2024</strong></span>');
  assert.equal(serializeInlineHtml(el('<span data-text-right-tab="yes">unsafe marker</span>')), 'unsafe marker');
  assert.equal(clipboardParagraphHtml('fallback', '<p><span data-text-right-tab="true">role</span></p>'), '<span data-text-right-tab="true">role</span>');
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


test('live wrapping changes preserve the caret and canonical Save markup', () => {
  const root = el('<p><span data-text-wrap="balance"><span class="text-emphasis">Heading</span></span></p><div>Body</div>');
  const paragraph = root.firstElementChild as HTMLElement;
  const text = paragraph.querySelector('.text-emphasis')!.firstChild!;
  const selection = dom.getSelection();
  selection.setPosition(text, 3);
  for (const mode of ['normal', 'pretty', 'auto']) {
    paragraph.setAttribute('data-text-wrap', mode);
    refreshParagraphWrapping(root, true);
    const resolved = mode === 'auto' ? 'balance' : mode;
    assert.ok(paragraph.classList.contains(`project-body-text__wrap-${resolved}`));
    assert.equal(selection.anchorNode, text);
    assert.equal(selection.anchorOffset, 3);
    const value = readParagraphsValue(root);
    assert.equal(value[0], `<span data-text-wrap="${mode}"><span class="text-emphasis">Heading</span></span>`);
    const reload = el(value.map((html) => `<p>${html}</p>`).join(''));
    refreshParagraphWrapping(reload, true);
    assert.equal(reload.firstElementChild!.className, paragraph.className);
    assert.deepEqual(readParagraphsValue(reload), value);
  }
  paragraph.setAttribute('data-text-wrap', 'auto');
  paragraph.append(' ordinary');
  refreshParagraphWrapping(root, true);
  assert.ok(paragraph.classList.contains('project-body-text__wrap-normal'));
});
