import { PARAGRAPH_PLACEHOLDER_ATTRIBUTE } from './devTextDom';

export const RIGHT_TAB_ATTRIBUTE = 'data-text-right-tab';

const isRightRun = (node: Node | null): node is HTMLSpanElement =>
  node?.nodeType === 1 && (node as Element).tagName === 'SPAN'
  && (node as Element).getAttribute(RIGHT_TAB_ATTRIBUTE) === 'true';

const selectionInRoot = (root: HTMLElement) => {
  const selection = root.ownerDocument.getSelection();
  if (!selection || !selection.isCollapsed || !selection.rangeCount) return null;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  return { selection, range: selection.getRangeAt(0) };
};

const paragraphFor = (root: HTMLElement, node: Node | null): HTMLElement | null => {
  let current = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement ?? null;
  while (current && current !== root) {
    if ((current.tagName === 'P' || current.tagName === 'DIV') && current.parentElement === root) return current;
    current = current.parentElement;
  }
  return root;
};

const rightRunFor = (node: Node | null, root: HTMLElement): HTMLSpanElement | null => {
  let current = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement ?? null;
  while (current && current !== root) {
    if (isRightRun(current)) return current;
    current = current.parentElement;
  }
  return null;
};

const boundaryRange = (doc: Document, paragraph: HTMLElement, start: Node | null, end: Node | null) => {
  const range = doc.createRange();
  if (start) range.setStartAfter(start);
  else range.setStart(paragraph, 0);
  if (end) range.setEndBefore(end);
  else range.setEnd(paragraph, paragraph.childNodes.length);
  return range;
};

const explicitLine = (doc: Document, paragraph: HTMLElement, caret: Range) => {
  const before = doc.createRange();
  before.selectNodeContents(paragraph);
  before.setEnd(caret.startContainer, caret.startOffset);
  const breaks = [...before.cloneContents().querySelectorAll('br')];
  const allBreaks = [...paragraph.querySelectorAll('br')];
  const index = breaks.length;
  const previous = index ? allBreaks[index - 1] : null;
  const next = allBreaks[index] ?? null;
  return boundaryRange(doc, paragraph, previous, next);
};

const putCaret = (doc: Document, node: Node, offset = 0) => {
  const selection = doc.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.addRange(range);
};

const unwrap = (run: HTMLSpanElement) => {
  const parent = run.parentNode;
  if (!parent) return -1;
  const index = [...parent.childNodes].indexOf(run);
  while (run.firstChild) parent.insertBefore(run.firstChild, run);
  parent.removeChild(run);
  return index;
};

const removePlaceholderBreaks = (root: ParentNode) => {
  root.querySelectorAll(`br[${PARAGRAPH_PLACEHOLDER_ATTRIBUTE}]`).forEach((br) => br.remove());
};

const unwrapRuns = (root: ParentNode) => {
  root.querySelectorAll(`span[${RIGHT_TAB_ATTRIBUTE}="true"]`).forEach((node) => unwrap(node as HTMLSpanElement));
};

const removeOwnPlaceholder = (run: HTMLSpanElement) => {
  [...run.querySelectorAll(`br[${PARAGRAPH_PLACEHOLDER_ATTRIBUTE}]`)].forEach((br) => br.remove());
};

const atBoundary = (doc: Document, caret: Range, node: Node, after: boolean) => {
  const point = doc.createRange();
  if (after) point.setStartAfter(node);
  else point.setStartBefore(node);
  point.collapse(true);
  const [caretNode, caretOffset] = normalizedPoint(caret.startContainer, caret.startOffset);
  const [pointNode, pointOffset] = normalizedPoint(point.startContainer, point.startOffset);
  return caretNode === pointNode && caretOffset === pointOffset;
};

const normalizedPoint = (node: Node, offset: number): [Node, number] => {
  let current = node;
  let position = offset;
  while (current.parentNode && !(current.nodeType === 1 && (current as Element).tagName === 'BR')) {
    const atStart = position === 0;
    const atEnd = current.nodeType === 3
      ? position === current.textContent?.length
      : position === current.childNodes.length;
    if (current.nodeType === 3 && position !== 0 && position !== current.textContent?.length) break;
    if (!atStart && !atEnd) break;
    const parent = current.parentNode;
    if (!parent) break;
    const index = [...parent.childNodes].indexOf(current);
    position = index + (position ? 1 : 0);
    current = parent;
  }
  return [current, position];
};

/** One right run per explicit source line; visual-line tab stops need a separate model. */
export const insertRightIndentTab = (root: HTMLElement): boolean => {
  const state = selectionInRoot(root);
  if (!state) return false;
  const { range } = state;
  const paragraph = paragraphFor(root, range.startContainer);
  if (!paragraph || rightRunFor(range.startContainer, root)) return false;
  const line = explicitLine(root.ownerDocument, paragraph, range);
  if (!line.toString().trim() || [...paragraph.querySelectorAll(`span[${RIGHT_TAB_ATTRIBUTE}="true"]`)]
    .some((run) => line.intersectsNode(run))) return false;
  const lineEnd = line.cloneRange();
  lineEnd.collapse(false);
  const [lineNode, lineOffset] = normalizedPoint(lineEnd.startContainer, lineEnd.startOffset);
  const [caretNode, caretOffset] = normalizedPoint(range.startContainer, range.startOffset);
  if (lineNode !== caretNode || lineOffset !== caretOffset) return false;

  const doc = root.ownerDocument;
  const run = doc.createElement('span');
  run.setAttribute(RIGHT_TAB_ATTRIBUTE, 'true');
  const placeholder = doc.createElement('br');
  placeholder.setAttribute(PARAGRAPH_PLACEHOLDER_ATTRIBUTE, 'true');
  lineEnd.insertNode(run);
  run.append(placeholder);
  putCaret(doc, run, 0);
  return true;
};

export const removeRightIndentTab = (root: HTMLElement, direction: 'backward' | 'forward'): boolean => {
  const state = selectionInRoot(root);
  if (!state) return false;
  const { range } = state;
  const run = rightRunFor(range.startContainer, root);
  const beforeRun = run ? null : [...root.querySelectorAll(`span[${RIGHT_TAB_ATTRIBUTE}="true"]`)]
    .find((candidate) => atBoundary(root.ownerDocument, range, candidate, false));
  const target = run ?? beforeRun ?? null;
  if (!target) return false;
  const atStart = run ? (() => {
    const point = root.ownerDocument.createRange();
    point.setStart(run, 0);
    point.collapse(true);
    const [caretNode, caretOffset] = normalizedPoint(range.startContainer, range.startOffset);
    const [pointNode, pointOffset] = normalizedPoint(point.startContainer, point.startOffset);
    return caretNode === pointNode && caretOffset === pointOffset;
  })() : false;
  const atBefore = !run && target !== null && atBoundary(root.ownerDocument, range, target, false);
  if (direction === 'backward' && !atStart) return false;
  if (direction === 'forward' && !atBefore) return false;
  const parent = target.parentNode;
  if (!parent) return false;
  removeOwnPlaceholder(target);
  const index = unwrap(target);
  putCaret(root.ownerDocument, parent, index);
  return true;
};

export const breakRightIndentTab = (root: HTMLElement, softBreak: boolean): boolean => {
  const state = selectionInRoot(root);
  if (!state) return false;
  const { range } = state;
  const run = rightRunFor(range.startContainer, root);
  if (!run) return false;
  const paragraph = paragraphFor(root, run);
  if (!paragraph) return false;
  const doc = root.ownerDocument;
  const trailing = doc.createDocumentFragment();
  const extract = doc.createRange();
  extract.setStart(range.startContainer, range.startOffset);
  extract.setEnd(paragraph, paragraph.childNodes.length);
  trailing.append(extract.extractContents());
  unwrapRuns(trailing);
  removePlaceholderBreaks(trailing);
  removeOwnPlaceholder(run);

  if (softBreak || paragraph === root) {
    const br = doc.createElement('br');
    run.after(br);
    br.after(...trailing.childNodes);
    putCaret(doc, br.parentNode ?? paragraph, [...(br.parentNode ?? paragraph).childNodes].indexOf(br) + 1);
    return true;
  }

  const next = doc.createElement(paragraph.tagName.toLowerCase());
  next.append(...trailing.childNodes);
  paragraph.after(next);
  putCaret(doc, next);
  return true;
};
