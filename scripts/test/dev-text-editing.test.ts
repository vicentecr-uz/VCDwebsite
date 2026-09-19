import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { clipboardParagraphHtml, explicitParagraphTextWrap } from '../../src/lib/devTextDom';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const bindTextState =');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, source.indexOf('    const TRASH_ICON', start)) + '\nreturn bindTextState;');
const toneScript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
  const markSelector = { emphasis: '.text-emphasis', subtle: '.text-subtle', bold: 'strong, b', italic: 'em, i', underline: 'u' };
  ${source.slice(source.indexOf('    const applyEmphasisMark ='), source.indexOf('    const applyEmphasisStyle ='))}
  return applyEmphasisMark;
`);

function applyTone(markup: string, tone: 'emphasis' | 'default' | 'subtle', includeParagraph = false) {
  const window = new Window();
  const document = window.document;
  const paragraph = document.createElement('p');
  paragraph.innerHTML = markup;
  document.body.append(paragraph);
  const text = paragraph.querySelector('.text-emphasis')?.firstChild ?? paragraph.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(text);
  const apply = new Function('env', `with(env) { ${toneScript} }`)({
    window, document, explicitParagraphTextWrap, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement, HTMLBRElement: window.HTMLBRElement,
    Node: window.Node, Text: window.Text,
  });
  apply(range, tone);
  return includeParagraph ? paragraph.outerHTML : paragraph.innerHTML;
}

function setup(markup = '<p>Before</p><p>After</p>') {
  const window = new Window();
  const document = window.document;
  const element = document.createElement('div');
  element.innerHTML = markup;
  element.contentEditable = 'true';
  document.body.append(element);
  const commands: unknown[][] = [];
  let updates = 0, merges = 0, splits = 0;
  const env = {
    window, document, Event: window.Event, editorSignal: new window.AbortController().signal,
    removeParagraphRootWhitespace() {},
    clipboardParagraphHtml,
    stickyStatus: '', linkPanelOpen: false, pageHistory: { breakGroup() {} },
    hideFormatBar() {}, setStickyStatus() {},
    updateActions() { updates++; },
    tryMergeBlockAtCaret() { merges++; return false; },
    splitBlockAtCaret() { splits++; },
  };
  document.execCommand = (...args: unknown[]) => { commands.push(args); return true; };
  new Function('env', `with(env) { ${script} }`)(env)({ element, kind: 'paragraphs' });
  const select = (node = element.lastChild!.firstChild!, offset = node.textContent!.length) => {
    window.getSelection().setPosition(node, offset);
  };
  const key = (key: string, init = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    element.dispatchEvent(event);
    return event;
  };
  return { window, document, element, commands, select, key, counts: () => ({ updates, merges, splits }) };
}

test('click, Delete and input do not relocate a caret inside native pasted DIVs', () => {
  const { window, element, select, key } = setup('<p>First</p><div>Design Engineer</div><div>Last</div>');
  const node = element.children[1].firstChild!;
  select(node, 0);
  const before = element.innerHTML;
  element.dispatchEvent(new window.Event('pointerup'));
  expect(key('Backspace').defaultPrevented).toBe(false);
  element.dispatchEvent(new window.Event('input'));
  expect(window.getSelection().anchorNode).toBe(node);
  expect(window.getSelection().anchorOffset).toBe(0);
  expect(element.innerHTML).toBe(before);
});

test('ordinary Enter, soft return, deletion and composition stay browser-owned', () => {
  const { key, element, counts } = setup();
  const before = element.innerHTML;
  expect(key('Enter').defaultPrevented).toBe(false);
  expect(key('Enter', { shiftKey: true }).defaultPrevented).toBe(false);
  expect(key('Enter', { altKey: true }).defaultPrevented).toBe(false);
  expect(key('Enter', { isComposing: true, metaKey: true }).defaultPrevented).toBe(false);
  expect(key('Backspace', { isComposing: true }).defaultPrevented).toBe(false);
  expect(counts().splits).toBe(0);
  expect(counts().merges).toBe(0);
  expect(element.innerHTML).toBe(before);
  expect(key('Enter', { metaKey: true }).defaultPrevented).toBe(true);
  expect(counts().splits).toBe(1);
});

test('select-all paste uses one sanitized native insertion without replacing the DOM or selection itself', () => {
  const { window, element, commands, counts } = setup();
  const selection = window.getSelection();
  selection.selectAllChildren(element);
  const before = element.innerHTML;
  const clipboard = new window.DataTransfer();
  clipboard.setData('text/plain', 'Vicente Cruz\n\nDesign Engineer');
  const event = new window.ClipboardEvent('paste', { clipboardData: clipboard, cancelable: true });
  element.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(commands).toEqual([['insertHTML', false, '<p>Vicente Cruz</p><p>Design Engineer</p>']]);
  expect(element.innerHTML).toBe(before);
  expect(selection.isCollapsed).toBe(false);
  expect(counts().updates).toBe(1);
});

test('paste cannot replace a selection extending outside the editing host', () => {
  const { window, document, element, commands } = setup();
  const outside = document.createTextNode('outside');
  document.body.append(outside);
  window.getSelection().setBaseAndExtent(element.firstChild!.firstChild!, 0, outside, 3);
  const clipboard = new window.DataTransfer();
  clipboard.setData('text/plain', 'Replacement');
  element.dispatchEvent(new window.ClipboardEvent('paste', { clipboardData: clipboard, cancelable: true }));
  expect(commands).toHaveLength(0);
});

test('native undo input leaves browser-owned empty and soft-line nodes intact', () => {
  const { window, element, select } = setup('<p>Text<br><br></p><div><br></div>');
  select(element.lastChild!, 0);
  const before = element.innerHTML;
  element.dispatchEvent(new window.InputEvent('input', { inputType: 'historyUndo' }));
  expect(element.innerHTML).toBe(before);
  expect(window.getSelection().anchorNode).toBe(element.lastChild);
});

test('text tone replaces existing emphasis and subtle marks for each tone', () => {
  expect(applyTone('<span class="text-emphasis">Legacy</span> plain', 'subtle'))
    .toBe('<span class="text-subtle">Legacy</span> plain');
  expect(applyTone('<span class="text-subtle">Legacy</span> plain', 'emphasis'))
    .toBe('<span class="text-emphasis">Legacy</span> plain');
  expect(applyTone('<span class="text-subtle"><span class="text-emphasis">Legacy</span></span> plain', 'default'))
    .toBe('Legacy plain');
});

test('text tone preserves inline marks, link attributes, and unselected tones', () => {
  const markup = '<span class="text-emphasis"><strong><em><u><a href="/legacy" class="is-underline-off">Legacy</a></u></em></strong></span> <span class="text-subtle"><span class="text-emphasis">quiet</span></span> tail';
  expect(applyTone(markup, 'subtle')).toBe(
    '<a class="is-underline-off" href="/legacy"><span class="text-subtle"><strong><em><u>Legacy</u></em></strong></span></a> <span class="text-subtle"><span class="text-emphasis">quiet</span></span> tail',
  );
});

function sectionCommands(markup: string) {
  const window = new Window();
  const document = window.document;
  const element = document.createElement('div');
  element.innerHTML = markup;
  document.body.append(element);
  const between = (from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const commands = between('    const placeCaretInParagraph =', '    const fragmentHasContent =')
    + between('    const materializeParagraphs =', '    const inlineJoinParagraph =');
  const env = {
    window, document, HTMLElement: window.HTMLElement, Node: window.Node,
    createParagraphPlaceholderBreak: () => document.createElement('br'),
    fragmentHasContent: (node: Node) => Boolean(node.textContent),
  };
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(commands);
  const api = new Function('env', `with(env) { ${script}; return { ensureParagraphSelection, materializeParagraphs }; }`)(env);
  return { window, element, ...api };
}

test('explicit section commands keep the caret inside native DIV paragraphs', () => {
  const { window, element, ensureParagraphSelection } = sectionCommands('<div>Design Engineer</div><p>Last</p>');
  const node = element.firstChild.firstChild;
  window.getSelection().setPosition(node, 3);
  const before = element.innerHTML;
  expect(ensureParagraphSelection(element)).toBe(element.firstChild);
  expect(window.getSelection().anchorNode).toBe(node);
  expect(window.getSelection().anchorOffset).toBe(3);
  expect(element.innerHTML).toBe(before);
});

test('section splitting wraps root inline text at its exact caret without jumping to the last paragraph', () => {
  const { window, element, ensureParagraphSelection } = sectionCommands('Design <strong>Engineer</strong><p>Last</p>');
  const node = element.firstChild;
  window.getSelection().setPosition(node, 3);
  const paragraph = ensureParagraphSelection(element);
  expect(paragraph.outerHTML).toBe('<p>Design <strong>Engineer</strong></p>');
  expect(window.getSelection().anchorNode).toBe(node);
  expect(window.getSelection().anchorOffset).toBe(3);
  expect(element.textContent).toBe('Design EngineerLast');
});

test('section merge preparation preserves mixed root text, formatting, and paragraphs in order', () => {
  const { element, materializeParagraphs } = sectionCommands('First <strong>bold</strong><div>Middle</div>Last');
  expect(materializeParagraphs(element).map((paragraph: HTMLElement) => paragraph.innerHTML)).toEqual(['First <strong>bold</strong>', 'Middle', 'Last']);
  expect(element.textContent).toBe('First boldMiddleLast');
});


test('changing text tone preserves a paragraph wrapping override', () => {
  expect(applyTone('<span data-text-wrap="pretty"><span class="text-emphasis">Heading</span></span>', 'default', true))
    .toBe('<p data-text-wrap="pretty">Heading</p>');
});

test('wrapping targets only paragraphs touched by the selection, including native DIVs', () => {
  const window = new Window();
  const document = window.document;
  const element = document.createElement('div');
  element.innerHTML = '<p>First</p><div>Second</div><p>Third</p>';
  const start = source.indexOf('    const paragraphsInRange =');
  const end = source.indexOf('    let syncingTextWrap =', start);
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end) + '\nreturn paragraphsInRange;');
  const paragraphs = new Function('document', 'Range', 'Node', code)(document, window.Range, window.Node);
  const range = document.createRange();
  range.setStart(element.children[0].firstChild!, 1);
  range.setEnd(element.children[2].firstChild!, 0);
  expect(paragraphs(range, { element }).map((node: HTMLElement) => node.textContent)).toEqual(['First', 'Second']);
  range.setStart(element.children[1].firstChild!, 2);
  range.collapse(true);
  expect(paragraphs(range, { element }).map((node: HTMLElement) => node.textContent)).toEqual(['Second']);
});
