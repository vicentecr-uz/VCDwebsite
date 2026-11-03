import { explicitParagraphTextWrap } from './devTextDom';

export type EmphasisTone = 'emphasis' | 'default' | 'subtle';
type InlineMarks = {
  emphasis: boolean;
  subtle: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  code: boolean;
  link: { href: string; underlineOff: boolean } | null;
};
type InlineAtom = {
  kind: 'text' | 'break';
  text: string;
  marks: InlineMarks;
  selected: boolean;
};

export const applyInlineMark = (range: Range, change: { tone?: EmphasisTone; code?: boolean }) => {
  if (range.collapsed) return null;
  const startElement = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  const endElement = range.endContainer instanceof Element
    ? range.endContainer
    : range.endContainer.parentElement;
  const paragraph = startElement?.closest<HTMLElement>('p, div');
  // One paragraph per operation; cross-paragraph marks need a per-paragraph range pass.
  if (!paragraph || paragraph !== endElement?.closest('p, div')) return null;
  const paragraphWrap = explicitParagraphTextWrap(paragraph);

  const startBoundary = document.createElement('span');
  const endBoundary = document.createElement('span');
  startBoundary.hidden = true;
  endBoundary.hidden = true;
  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(endBoundary);
  const startRange = range.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(startBoundary);

  const atoms: InlineAtom[] = [];
  let selected = false;
  const visit = (node: Node, inherited: InlineMarks) => {
    if (node === startBoundary) {
      selected = true;
      return;
    }
    if (node === endBoundary) {
      selected = false;
      return;
    }
    if (node instanceof Text) {
      if (node.data) atoms.push({ kind: 'text', text: node.data, marks: inherited, selected });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const marks = { ...inherited };
    if (node.matches('.text-emphasis')) marks.emphasis = true;
    if (node.matches('.text-subtle')) marks.subtle = true;
    if (node.matches('strong, b')) marks.bold = true;
    if (node.matches('em, i')) marks.italic = true;
    if (node.matches('u')) marks.underline = true;
    if (node.matches('code')) marks.code = true;
    if (node instanceof HTMLAnchorElement) {
      marks.link = {
        href: node.getAttribute('href') || '',
        underlineOff: node.classList.contains('is-underline-off'),
      };
    }
    if (node instanceof HTMLBRElement) {
      atoms.push({ kind: 'break', text: '', marks, selected });
      return;
    }
    [...node.childNodes].forEach((child) => visit(child, marks));
  };
  const emptyMarks: InlineMarks = {
    emphasis: false,
    subtle: false,
    bold: false,
    italic: false,
    underline: false,
    code: false,
    link: null,
  };
  [...paragraph.childNodes].forEach((child) => visit(child, emptyMarks));
  const selectedAtoms = atoms.filter((atom) => atom.selected);
  if (!selectedAtoms.length) {
    startBoundary.remove();
    endBoundary.remove();
    return null;
  }
  selectedAtoms.forEach((atom) => {
    atom.marks = {
      ...atom.marks,
      ...(change.tone === undefined ? {} : { emphasis: change.tone === 'emphasis', subtle: change.tone === 'subtle' }),
      ...(change.code === undefined ? {} : { code: change.code }),
    };
  });

  const keyFor = (atom: InlineAtom) => JSON.stringify({
    selected: atom.selected,
    marks: atom.marks,
  });
  const groups: InlineAtom[][] = [];
  atoms.forEach((atom) => {
    const previous = groups.at(-1);
    if (previous && keyFor(previous[0]) === keyFor(atom)) previous.push(atom);
    else groups.push([atom]);
  });

  const wrap = (content: Node, tag: keyof HTMLElementTagNameMap, className = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.append(content);
    return element;
  };
  const renderGroup = (group: InlineAtom[]) => {
    const content = document.createDocumentFragment();
    group.forEach((atom) => {
      content.append(atom.kind === 'break' ? document.createElement('br') : atom.text);
    });
    const { marks } = group[0];
    let rendered: Node = content;
    if (marks.code) rendered = wrap(rendered, 'code');
    if (marks.underline) rendered = wrap(rendered, 'u');
    if (marks.italic) rendered = wrap(rendered, 'em');
    if (marks.bold) rendered = wrap(rendered, 'strong');
    if (marks.emphasis) rendered = wrap(rendered, 'span', 'text-emphasis');
    if (marks.subtle) rendered = wrap(rendered, 'span', 'text-subtle');
    if (marks.link?.href) {
      const anchor = wrap(rendered, 'a', marks.link.underlineOff ? 'is-underline-off' : '');
      anchor.setAttribute('href', marks.link.href);
      rendered = anchor;
    }
    return rendered;
  };

  const fragment = document.createDocumentFragment();
  const selectedNodes: Node[] = [];
  groups.forEach((group) => {
    const rendered = renderGroup(group);
    if (group[0].selected) {
      if (rendered.nodeType === 11) selectedNodes.push(...rendered.childNodes);
      else selectedNodes.push(rendered);
    }
    fragment.append(rendered);
  });
  paragraph.replaceChildren(fragment);
  if (paragraphWrap) paragraph.setAttribute('data-text-wrap', paragraphWrap);
  const restored = document.createRange();
  restored.setStartBefore(selectedNodes[0]);
  restored.setEndAfter(selectedNodes.at(-1)!);
  return restored;
};
