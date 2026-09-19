import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { normalizeTextWrap } from './devTextDom';

type HtmlNode = DefaultTreeAdapterMap['node'];

export const resolveTextWrapHtml = (html: string, legacyBalance = false) => {
  const fragment = parseFragment(html);
  const first = fragment.childNodes.find((node) => 'tagName' in node);
  const explicit = first && 'tagName' in first && first.tagName === 'span'
    ? normalizeTextWrap(first.attrs.find((attr) => attr.name === 'data-text-wrap')?.value)
    : null;
  if (explicit && explicit !== 'auto') return explicit;
  if (!explicit && legacyBalance) return 'balance';
  let hasText = false;
  let allEmphasized = true;
  const visit = (node: HtmlNode, emphasized = false) => {
    if ('value' in node && node.value.trim()) {
      hasText = true;
      if (!emphasized) allEmphasized = false;
    }
    if ('tagName' in node) {
      if (['script', 'style', 'template', 'iframe', 'object', 'embed'].includes(node.tagName)) return;
      const classes = node.attrs.find((attr) => attr.name === 'class')?.value.split(/\s+/) ?? [];
      if (classes.includes('text-subtle')) emphasized = false;
      else if (classes.includes('text-emphasis')) emphasized = true;
    }
    if ('childNodes' in node) node.childNodes.forEach((child) => visit(child, emphasized));
  };
  fragment.childNodes.forEach((node) => visit(node));
  return hasText && allEmphasized ? 'balance' : 'normal';
};
