import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlElement = DefaultTreeAdapterMap['element'];

const labelText = (node: HtmlNode): string => {
  if ('value' in node) return node.value;
  if ('tagName' in node && ['script', 'style', 'template'].includes(node.tagName)) return '';
  return 'childNodes' in node ? node.childNodes.map(labelText).join('') : '';
};

export function renderHomeIntroAction(html: string): string {
  if (!html.includes('data-home-intro-okay')) return html;
  const fragment = parseFragment(html);
  const visit = (node: HtmlNode) => {
    if ('tagName' in node && node.tagName === 'span'
      && node.attrs.some(({ name, value }) => name === 'data-home-intro-okay' && value === 'true')) {
      const value = labelText(node);
      node.nodeName = node.tagName = 'button';
      node.attrs = [{ name: 'type', value: 'button' }, { name: 'data-home-intro-okay', value: 'true' }];
      const sourceLabel: HtmlElement = {
        nodeName: 'span',
        tagName: 'span',
        attrs: [{ name: 'data-home-intro-source-label', value: 'true' }],
        namespaceURI: node.namespaceURI,
        childNodes: [],
        parentNode: node,
      };
      sourceLabel.childNodes = [{ nodeName: '#text', value, parentNode: sourceLabel }];
      const desktopLabel: HtmlElement = {
        nodeName: 'span',
        tagName: 'span',
        attrs: [{ name: 'data-home-intro-desktop-label', value: 'true' }],
        namespaceURI: node.namespaceURI,
        childNodes: [],
        parentNode: node,
      };
      desktopLabel.childNodes = [{ nodeName: '#text', value: 'Enter', parentNode: desktopLabel }];
      node.childNodes = [sourceLabel, desktopLabel];
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(fragment);
  return serialize(fragment);
}
