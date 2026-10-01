import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { breakRightIndentTab, insertRightIndentTab, removeRightIndentTab } from '../../src/lib/devTextRightTab';
import { readParagraphsValue, serializeInlineHtml } from '../../src/lib/devTextDom';

const setup = (markup: string) => {
  const window = new Window();
  const root = window.document.createElement('div');
  root.innerHTML = markup;
  root.contentEditable = 'true';
  window.document.body.append(root);
  Object.assign(globalThis, { Element: window.Element });
  return { window, root };
};

const caretAtEnd = (window: Window, node: Node) => {
  const selection = window.getSelection();
  selection!.setPosition(node, node.nodeType === 3 ? node.textContent!.length : node.childNodes.length);
};

test('inserts a marked right run at formatted paragraph end and preserves it through serialization', () => {
  const { window, root } = setup('<p><strong>Role</strong><br>Design Engineer</p>');
  const paragraph = root.firstElementChild!;
  window.getSelection()!.setPosition(paragraph.querySelector('strong')!.firstChild!, 2);
  expect(insertRightIndentTab(paragraph as HTMLElement)).toBe(false);
  caretAtEnd(window, paragraph.lastChild!);
  expect(insertRightIndentTab(root)).toBe(true);
  const run = root.querySelector('[data-text-right-tab="true"]')!;
  run.textContent = '2024–2025';
  expect(readParagraphsValue(root)).toEqual(['<strong>Role</strong><br>Design Engineer<span data-text-right-tab="true">2024–2025</span>']);
  expect(serializeInlineHtml(root)).toContain('<span data-text-right-tab="true">2024–2025</span>');
});

test('inserts before an explicit break and rejects duplicate, mid-line, outside, and noncollapsed selections', () => {
  const { window, root } = setup('<p>Role<br>Design Engineer</p>');
  const paragraph = root.firstElementChild!;
  const text = paragraph.firstChild!;
  window.getSelection()!.setPosition(text, 4);
  expect(insertRightIndentTab(root)).toBe(true);
  expect(paragraph.innerHTML).toContain('Role<span data-text-right-tab="true"><br data-dev-placeholder="true"></span><br>');
  expect(insertRightIndentTab(root)).toBe(false);
  window.getSelection()!.selectAllChildren(text);
  expect(insertRightIndentTab(root)).toBe(false);
  const outside = window.document.createTextNode('outside');
  window.document.body.append(outside);
  window.getSelection()!.setBaseAndExtent(outside, 0, outside, 0);
  expect(insertRightIndentTab(root)).toBe(false);
});

test('supports native div and simple inline roots', () => {
  const divCase = setup('<div>Role</div>');
  caretAtEnd(divCase.window, divCase.root.firstElementChild!.firstChild!);
  expect(insertRightIndentTab(divCase.root)).toBe(true);
  const simple = setup('Role');
  caretAtEnd(simple.window, simple.root.firstChild!);
  expect(insertRightIndentTab(simple.root)).toBe(true);
});

test('backspace and delete at the right-run gap unwrap and retain text', () => {
  const { window, root } = setup('<p>Role<span data-text-right-tab="true"><em>2024</em><br data-dev-placeholder="true"></span></p>');
  const run = root.querySelector('span[data-text-right-tab]')!;
  window.getSelection()!.setPosition(run, 0);
  expect(removeRightIndentTab(root, 'backward')).toBe(true);
  expect(root.innerHTML).toBe('<p>Role<em>2024</em></p>');

  root.innerHTML = '<p>Role<span data-text-right-tab="true">2024<br data-dev-placeholder="true"></span></p>';
  const nextRun = root.querySelector('span[data-text-right-tab]')!;
  window.getSelection()!.setPosition(nextRun.parentNode!, 1);
  expect(removeRightIndentTab(root, 'forward')).toBe(true);
  expect(root.innerHTML).toBe('<p>Role2024</p>');
});

test('hard and soft enter leave right alignment while preserving later content', () => {
  const hard = setup('<p>Role<span data-text-right-tab="true">2024 later<br data-dev-placeholder="true"></span></p>');
  const run = hard.root.querySelector('span[data-text-right-tab]')!;
  hard.window.getSelection()!.setPosition(run.firstChild!, 4);
  expect(breakRightIndentTab(hard.root, false)).toBe(true);
  expect(hard.root.innerHTML).toBe('<p>Role<span data-text-right-tab="true">2024</span></p><p> later</p>');

  const soft = setup('<p>Role<span data-text-right-tab="true">2024 later<br data-dev-placeholder="true"></span></p>');
  const softRun = soft.root.querySelector('span[data-text-right-tab="true"]')!;
  soft.window.getSelection()!.setPosition(softRun.firstChild!, 4);
  expect(breakRightIndentTab(soft.root, true)).toBe(true);
  expect(soft.root.innerHTML).toBe('<p>Role<span data-text-right-tab="true">2024</span><br> later</p>');
});

test('normalizes formatted text-node ends before BR and preserves earlier right runs on Enter', () => {
  const formatted = setup('<p><strong>Vicente Cruz</strong><br>Design Engineer</p>');
  const formattedText = formatted.root.querySelector('strong')!.firstChild!;
  formatted.window.getSelection()!.setPosition(formattedText, formattedText.textContent!.length);
  expect(insertRightIndentTab(formatted.root)).toBe(true);
  expect(formatted.root.querySelector('strong')!.nextElementSibling?.tagName).toBe('SPAN');
  expect(formatted.root.querySelector('strong')!.nextElementSibling?.nextElementSibling?.tagName).toBe('BR');

  const hard = setup('<p>Earlier<span data-text-right-tab="true">2024<br data-dev-placeholder="true"></span><br>Current<span data-text-right-tab="true">2025 later<br data-dev-placeholder="true"></span></p>');
  const hardRun = hard.root.querySelectorAll('span[data-text-right-tab]')[1];
  hard.window.getSelection()!.setPosition(hardRun.firstChild!, 4);
  expect(breakRightIndentTab(hard.root, false)).toBe(true);
  expect(hard.root.innerHTML).toBe('<p>Earlier<span data-text-right-tab="true">2024<br data-dev-placeholder="true"></span><br>Current<span data-text-right-tab="true">2025</span></p><p> later</p>');

  const soft = setup('<p>Earlier<span data-text-right-tab="true">2024<br data-dev-placeholder="true"></span><br>Current<span data-text-right-tab="true">2025 later<br data-dev-placeholder="true"></span></p>');
  const softRun = soft.root.querySelectorAll('span[data-text-right-tab]')[1];
  soft.window.getSelection()!.setPosition(softRun.firstChild!, 4);
  expect(breakRightIndentTab(soft.root, true)).toBe(true);
  expect(soft.root.innerHTML).toBe('<p>Earlier<span data-text-right-tab="true">2024<br data-dev-placeholder="true"></span><br>Current<span data-text-right-tab="true">2025</span><br> later</p>');
});
