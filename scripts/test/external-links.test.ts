import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { bindExternalLinks } from '../../src/lib/externalLinks';

const windows: Window[] = [];
afterEach(() => windows.splice(0).forEach((window) => window.happyDOM.abort()));

function setup(html: string) {
  const window = new Window({ url: 'https://portfolio.example/about' });
  windows.push(window);
  Object.assign(globalThis, {
    window, document: window.document, Element: window.Element,
    HTMLAnchorElement: window.HTMLAnchorElement,
  });
  window.document.body.innerHTML = html;
  bindExternalLinks();
  return window;
}

test('external web links default to a safe new tab and preserve rel tokens', () => {
  const window = setup('<a href="//elsewhere.example" rel="author">Link</a>');
  const anchor = window.document.querySelector('a')!;
  expect(anchor.target).toBe('_blank');
  expect([...anchor.relList]).toEqual(['author', 'noopener', 'noreferrer']);
});

test('internal links, non-web schemes, downloads and explicit targets retain behavior', () => {
  const window = setup([
    '<a href="/work">Internal</a>', '<a href="#section">Hash</a>',
    '<a href="https://portfolio.example/work">Absolute internal</a>',
    '<a href="mailto:hello@example.com">Email</a>', '<a href="tel:123">Phone</a>',
    '<a href="https://elsewhere.example/file" download>Download</a>',
    '<a href="https://elsewhere.example" target="_self">Explicit</a>',
  ].join(''));
  expect([...window.document.querySelectorAll('a')].map((a) => a.target))
    .toEqual(['', '', '', '', '', '', '_self']);
});

for (const type of ['click', 'auxclick', 'contextmenu']) {
  test(`${type} applies defaults to newly inserted links without cancelling navigation`, () => {
    const window = setup('');
    window.document.body.innerHTML = '<a href="https://elsewhere.example"><span>New</span></a>';
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true });
    window.document.querySelector('span')!.dispatchEvent(event);
    expect(window.document.querySelector('a')!.target).toBe('_blank');
    expect(event.defaultPrevented).toBe(false);
  });
}

test('editing a link between external and internal restores the appropriate target', () => {
  const window = setup('<a href="https://elsewhere.example">Link</a>');
  const anchor = window.document.querySelector('a')!;
  anchor.href = '/work';
  anchor.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  expect(anchor.target).toBe('');
  anchor.href = 'https://elsewhere.example/new';
  anchor.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  expect(anchor.target).toBe('_blank');
  anchor.target = '_self';
  anchor.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  expect(anchor.target).toBe('_self');
});
