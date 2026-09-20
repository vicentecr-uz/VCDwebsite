export const PARAGRAPH_PLACEHOLDER_ATTRIBUTE = 'data-dev-placeholder';
export const TEXT_WRAP_VALUES = ['auto', 'normal', 'pretty', 'balance'] as const;
export type TextWrap = typeof TEXT_WRAP_VALUES[number];

export const normalizeTextWrap = (value: string | null | undefined): TextWrap | null =>
  TEXT_WRAP_VALUES.includes(value as TextWrap) ? value as TextWrap : null;

export const explicitParagraphTextWrap = (paragraph: ParentNode): TextWrap | null => {
  if ((paragraph as Node).nodeType !== 1) return null;
  const element = paragraph as Element;
  const override = normalizeTextWrap(element.getAttribute('data-text-wrap'));
  const first = element.firstElementChild;
  return override ?? (first?.tagName === 'SPAN'
    ? normalizeTextWrap(first.getAttribute('data-text-wrap')) : null);
};

export const paragraphTextWrap = (paragraph: ParentNode, legacyBalance = false): TextWrap =>
  explicitParagraphTextWrap(paragraph) ?? (legacyBalance ? 'balance' : 'auto');

export const resolveAutoTextWrap = (paragraph: ParentNode): 'balance' | 'normal' => {
  let hasVisibleText = false;
  let allEmphasized = true;
  const visit = (node: Node, emphasized = false) => {
    if (node.nodeType === 3) {
      if (node.textContent?.trim()) {
        hasVisibleText = true;
        if (!emphasized) allEmphasized = false;
      }
      return;
    }
    if (node instanceof Element) {
      if (IGNORED_TAGS.has(node.tagName)) return;
      if (node.classList.contains('text-subtle')) emphasized = false;
      else if (node.classList.contains('text-emphasis')) emphasized = true;
    }
    node.childNodes.forEach((child) => visit(child, emphasized));
  };
  paragraph.childNodes.forEach((node) => visit(node));
  return hasVisibleText && allEmphasized ? 'balance' : 'normal';
};

export const refreshParagraphWrapping = (element: HTMLElement, legacyBalance = false) => {
  element.querySelectorAll<HTMLElement>(':scope > p, :scope > div').forEach((paragraph) => {
    const mode = paragraphTextWrap(paragraph, legacyBalance);
    const resolved = mode === 'auto' ? resolveAutoTextWrap(paragraph) : mode;
    for (const value of ['normal', 'pretty', 'balance']) {
      paragraph.classList.toggle(`project-body-text__wrap-${value}`, value === resolved);
    }
  });
};

const SAFE_HREF = /^(https?:\/\/|\/|#|mailto:)/i;
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED']);
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TR', 'TD', 'TH', 'UL',
]);

const cleanText = (value: string) => value.replaceAll('\u00a0', ' ');

export const readPlainDomText = (node: HTMLElement): string => {
  const clone = node.cloneNode(true) as HTMLElement;
  if (clone.childNodes.length === 1 && clone.firstChild instanceof Element && clone.firstChild.tagName === 'BR') return '';
  clone.querySelectorAll('br').forEach((br) => {
    if (br.hasAttribute(PARAGRAPH_PLACEHOLDER_ATTRIBUTE)) br.remove();
    else br.replaceWith('\n');
  });
  return cleanText(clone.textContent ?? '');
};

export const escapeTextHtml = (value: string) => cleanText(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const escapeAttribute = (value: string) => escapeTextHtml(value).replaceAll('"', '&quot;');

const serializeNode = (node: Node, preserveWrap = true): string => {
  if (node.nodeType === 3) return escapeTextHtml(node.textContent ?? '');
  if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return '';

  const tag = node.tagName;
  if (tag === 'BR') {
    return node.hasAttribute(PARAGRAPH_PLACEHOLDER_ATTRIBUTE) ? '' : '<br>';
  }
  const inner = [...node.childNodes].map((child) => serializeNode(child, preserveWrap)).join('');
  if (tag === 'STRONG' || tag === 'B') return inner ? `<strong>${inner}</strong>` : '';
  if (tag === 'EM' || tag === 'I') return inner ? `<em>${inner}</em>` : '';
  if (tag === 'U') return inner ? `<u>${inner}</u>` : '';
  if (tag === 'SPAN' && preserveWrap) {
    const wrap = normalizeTextWrap(node.getAttribute('data-text-wrap'));
    if (wrap) {
      const className = node.classList.contains('text-emphasis') ? ' class="text-emphasis"'
        : node.classList.contains('text-subtle') ? ' class="text-subtle"' : '';
      return `<span${className} data-text-wrap="${wrap}">${inner}</span>`;
    }
  }
  if (tag === 'SPAN' && node.classList.contains('text-emphasis')) {
    return inner ? '<span class="text-emphasis">' + inner + '</span>' : '';
  }
  if (tag === 'SPAN' && node.classList.contains('text-subtle')) {
    return inner ? '<span class="text-subtle">' + inner + '</span>' : '';
  }
  if (tag === 'A') {
    const href = (node.getAttribute('href') ?? '').trim();
    if (!inner || !SAFE_HREF.test(href)) return inner;
    const underline = node.classList.contains('is-underline-off')
      ? ' class="is-underline-off"' : '';
    return `<a href="${escapeAttribute(href)}"${underline}>${inner}</a>`;
  }
  return inner;
};

export const serializeInlineHtml = (root: ParentNode): string => {
  const wrap = explicitParagraphTextWrap(root);
  const placeholder = root instanceof Element && (root.tagName === 'P' || root.tagName === 'DIV')
    && root.childNodes.length === 1 && root.firstChild instanceof Element
    && root.firstChild.tagName === 'BR';
  const inner = placeholder ? '' : [...root.childNodes].map((node) => serializeNode(node, !wrap)).join('');
  return wrap ? `<span data-text-wrap="${wrap}">${inner}</span>` : inner;
};

const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',').toLowerCase();
const hasBlockChild = (element: Element) => Boolean(element.querySelector(BLOCK_SELECTOR));

export const readParagraphsValue = (root: HTMLElement): string[] => {
  if (root.childNodes.length === 1 && root.firstChild instanceof Element && root.firstChild.tagName === 'BR') return [''];
  const result: string[] = [];
  let inline = '';
  let hasInline = false;

  const flushInline = () => {
    if (hasInline) result.push(inline);
    inline = '';
    hasInline = false;
  };

  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = cleanText(node.textContent ?? '');
      if (!text.trim() && !hasInline) return;
      inline += escapeTextHtml(text);
      hasInline ||= Boolean(text);
      return;
    }
    if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return;
    if (!BLOCK_TAGS.has(node.tagName) && hasBlockChild(node)) {
      flushInline();
      const wrapper = node.cloneNode(false) as HTMLElement;
      for (const paragraph of readParagraphsValue(node as HTMLElement)) {
        wrapper.innerHTML = paragraph;
        result.push(serializeNode(wrapper));
      }
      return;
    }
    if (!BLOCK_TAGS.has(node.tagName)) {
      const value = serializeNode(node);
      inline += value;
      hasInline ||= Boolean(value);
      return;
    }

    flushInline();
    if (!hasBlockChild(node) || node.tagName === 'P') {
      result.push(serializeInlineHtml(node));
      return;
    }

    const before = result.length;
    for (const child of node.childNodes) visit(child);
    if (result.length === before && !inline) result.push('');
    flushInline();
  };

  for (const node of root.childNodes) visit(node);
  flushInline();
  return result;
};

const paragraphHtml = (value: string) => value || `<br ${PARAGRAPH_PLACEHOLDER_ATTRIBUTE}="true">`;

const textParagraphs = (text: string): string[] => cleanText(text)
  .replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  .split(/\n\n/)
  .map((paragraph) => paragraph.split('\n').map(escapeTextHtml).join('<br>'));

export const clipboardParagraphHtml = (text: string, html: string): string => {
  let paragraphs: string[] = [];
  if (html.trim()) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const wrapper = document.createElement('div');
    wrapper.append(template.content.cloneNode(true));
    paragraphs = readParagraphsValue(wrapper);
  }
  if (!paragraphs.some(Boolean)) paragraphs = textParagraphs(text);
  if (paragraphs.length === 1 && paragraphs[0]) return paragraphs[0];
  return paragraphs.map((value) => `<p>${paragraphHtml(value)}</p>`).join('');
};
