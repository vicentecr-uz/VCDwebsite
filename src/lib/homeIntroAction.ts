import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

type HtmlNode = DefaultTreeAdapterMap['node'];

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
      const sourceLabel = {
        nodeName: 'span',
        tagName: 'span',
        attrs: [{ name: 'data-home-intro-source-label', value: 'true' }],
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        childNodes: [{ nodeName: '#text', value, parentNode: null as unknown as HtmlNode }],
        parentNode: node,
      } as unknown as HtmlNode;
      sourceLabel.childNodes[0].parentNode = sourceLabel;
      const desktopLabel = {
        nodeName: 'span',
        tagName: 'span',
        attrs: [{ name: 'data-home-intro-desktop-label', value: 'true' }],
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        childNodes: [{ nodeName: '#text', value: 'Enter', parentNode: null as unknown as HtmlNode }],
        parentNode: node,
      } as unknown as HtmlNode;
      desktopLabel.childNodes[0].parentNode = desktopLabel;
      node.childNodes = [sourceLabel, desktopLabel];
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(fragment);
  return serialize(fragment);
}
