import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const source = readFileSync(new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
const scriptStart = source.lastIndexOf('<script>', source.indexOf('const disposeBrowserTheme'));
const scriptEnd = source.indexOf('</script>', scriptStart);
const script = source.slice(scriptStart + '<script>'.length, scriptEnd)
  .replace(/^\s*import .*;$/gm, '')
  .replace('if (import.meta.hot) import.meta.hot.dispose(disposeBrowserTheme);', 'return disposeBrowserTheme;');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script);
const resolverSource = source.slice(
  source.indexOf('type TokenNode'),
  source.indexOf('const initialThemeColor'),
);
const resolverCompiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${resolverSource}; return resolveToken;`);

test('SSR browser theme color resolves the light token mode before aliases', () => {
  const resolveToken = new Function('designTokens', resolverCompiled)({
    ref: { palette: { custom: { $value: '#112233' } } },
    sys: { color: { srf: {
      $value: '#aabbcc',
      $extensions: { modes: { light: '{ref.palette.custom}' } },
    } } },
  }) as (path: string) => string;
  expect(resolveToken('sys.color.srf')).toBe('#112233');
});

test('browser chrome follows the rendered surface and theme through page swaps', async () => {
  const window = new Window({ url: 'http://localhost:4322/' });
  const values = { background: 'rgb(12, 34, 56)', scheme: 'light' };
  window.document.head.innerHTML = '<meta name="color-scheme" content="light"><meta name="theme-color" content="#000000">';
  window.document.body.innerHTML = '<main id="main-content"></main>';
  window.matchMedia = () => new window.EventTarget() as MediaQueryList;
  const restore = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window,
    document: window.document,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: () => ({
      backgroundColor: values.background,
      colorScheme: values.scheme,
      getPropertyValue: (name: string) => name === 'color-scheme' ? values.scheme : '',
    }),
  };
  Object.entries(globals).forEach(([key, value]) => {
    restore.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  });
  try {
    const dispose = new Function('createPageScope', 'onPageLoad', compiled)(createPageScope, onPageLoad) as () => void;
    expect(window.document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(values.background);
    expect(window.document.querySelector('meta[name="color-scheme"]')!.getAttribute('content')).toBe('light');

    values.background = 'rgb(90, 80, 70)';
    values.scheme = 'dark';
    window.document.documentElement.setAttribute('data-theme', 'dark');
    await window.happyDOM.whenAsyncComplete();
    expect(window.document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(values.background);
    expect(window.document.querySelector('meta[name="color-scheme"]')!.getAttribute('content')).toBe('dark');

    values.background = 'rgb(70, 60, 50)';
    window.document.documentElement.setAttribute('style', 'background: var(--sys-color-srf)');
    await window.happyDOM.whenAsyncComplete();
    expect(window.document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(values.background);

    values.background = 'rgb(1, 2, 3)';
    window.document.dispatchEvent(new window.Event('astro:before-swap'));
    window.document.body.innerHTML = '<main id="main-content"></main>';
    window.document.dispatchEvent(new window.Event('astro:page-load'));
    await window.happyDOM.whenAsyncComplete();
    expect(window.document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(values.background);

    dispose();
    values.background = 'rgb(4, 5, 6)';
    window.document.documentElement.setAttribute('style', 'background: red');
    await window.happyDOM.whenAsyncComplete();
    expect(window.document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('rgb(1, 2, 3)');
  } finally {
    restore.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
    await window.happyDOM.close();
  }
});
