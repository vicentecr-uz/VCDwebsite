export const PARAGRAPH_PLACEHOLDER_ATTRIBUTE = 'data-dev-placeholder';

const SAFE_HREF = /^(https?:\/\/|\/|#|mailto:)/i;
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED']);
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TR', 'TD', 'TH', 'UL',
]);

const cleanText = (value: string) => value.replaceAll('\u00a0', ' ');

export const escapeTextHtml = (value: string) => cleanText(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const escapeAttribute = (value: string) => escapeTextHtml(value).replaceAll('"', '&quot;');

const serializeNode = (node: Node): string => {
  if (node.nodeType === 3) return escapeTextHtml(node.textContent ?? '');
  if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return '';

  const tag = node.tagName;
  if (tag === 'BR') {
    return node.hasAttribute(PARAGRAPH_PLACEHOLDER_ATTRIBUTE) ? '' : '<br>';
  }
  const inner = [...node.childNodes].map(serializeNode).join('');
  if (tag === 'STRONG' || tag === 'B') return inner ? `<strong>${inner}</strong>` : '';
  if (tag === 'EM' || tag === 'I') return inner ? `<em>${inner}</em>` : '';
  if (tag === 'U') return inner ? `<u>${inner}</u>` : '';
  if (tag === 'SPAN' && node.classList.contains('text-emphasis')) {
    return inner ? '<span class="text-emphasis">' + inner + '</span>' : '';
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
  if (root instanceof Element && (root.tagName === 'P' || root.tagName === 'DIV')
    && root.childNodes.length === 1 && root.firstChild instanceof Element
    && root.firstChild.tagName === 'BR') return '';
  return [...root.childNodes].map(serializeNode).join('');
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
