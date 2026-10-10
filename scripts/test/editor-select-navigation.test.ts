import { expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { swapPageContent } from '../../src/lib/persistentPageSwap';

test('React selectors mount and release their bridge across persistent page swaps', async () => {
  const win = new Window({ url: 'https://vcd.test/play/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLSelectElement', 'HTMLInputElement', 'HTMLIFrameElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'AbortController', 'customElements', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'Astro', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const errors: unknown[] = [];
  const consoleError = spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (!String(message).startsWith('Warning: useLayoutEffect does nothing on the server')) errors.push([message, ...args]);
  });
  try {
    for (const name of names.slice(0, -2)) {
      const value = name === 'window' ? win : (win as any)[name];
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? value.bind(win) : value });
    }
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const { createElement, act } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { default: hydrate } = await import('../../node_modules/@astrojs/react/dist/client.js');
    const { default: EditorSelect } = await import('../../src/components/base-ui/EditorSelect');
    // Supply the modules directly; Astro's real island handles hydration and unmount.
    Object.defineProperty(globalThis, 'Astro', { configurable: true, value: {
      visible: async (_load: unknown, _options: unknown, island: any) => {
        island.Component = EditorSelect;
        island.hydrator = hydrate;
        await island.hydrate();
      },
    } });
    new Function(readFileSync(new URL('../../node_modules/astro/dist/runtime/server/astro-island.js', import.meta.url), 'utf8'))();

    const shell = (content: string) => `<body><div id="transition-overlay"></div><div id="site-wrapper"><div data-page-shell><div class="header-menu-backdrop"></div><div class="site-header-slot"><header>Play</header></div><main id="main-content">${content}</main></div></div></body>`;
    win.document.write(shell('Play'));
    const header = win.document.querySelector('header');
    for (let visit = 0; visit < 3; visit++) {
      const props = { triggerId: `crop-aspect-${visit}`, label: 'Aspect ratio', options: [{ value: '1:1', label: 'Square' }, { value: '4:3', label: 'Landscape' }], value: '1:1' };
      const prefix = `crop-${visit}`;
      const rendered = renderToString(createElement(EditorSelect, props), { identifierPrefix: prefix });
      const encode = (value: any): any => Array.isArray(value) ? [1, value.map(encode)] : [0, value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) : value];
      const encoded = encode(props)[1];
      const content = `<div class="dev-field"><select data-dev-editor-select><option value="1:1">Square</option><option value="4:3">Landscape</option></select><astro-island component-url="/_astro/EditorSelect.test.js" client="visible" opts='{"name":"EditorSelect","value":true}' prefix="${prefix}" props='${JSON.stringify(encoded)}' ssr>${rendered}</astro-island></div>`;
      const incoming = new win.DOMParser().parseFromString(shell(content), 'text/html');
      await act(async () => {
        swapPageContent(win.document as any, incoming as any);
        win.document.dispatchEvent(new win.Event('astro:after-swap'));
      });
      const island = win.document.querySelector('astro-island')!;
      const select = win.document.querySelector('select')!;
      expect(island.hasAttribute('ssr')).toBe(false);
      expect(Object.hasOwn(select, 'value')).toBe(true);
      await act(async () => { select.value = '4:3'; });
      expect(island.querySelector('[data-editor-select-trigger]')?.textContent).toContain('Landscape');
      await act(async () => {
        swapPageContent(win.document as any, new win.DOMParser().parseFromString(shell('Play'), 'text/html') as any);
        win.document.dispatchEvent(new win.Event('astro:after-swap'));
      });
      expect(island.isConnected).toBe(false);
      expect(island.childElementCount).toBe(0);
      expect(Object.hasOwn(select, 'value')).toBe(false);
      expect(Object.hasOwn(select, 'selectedIndex')).toBe(false);
      expect(win.document.querySelector('header')).toBe(header);
    }
    expect(errors).toEqual([]);
  } finally {
    consoleError.mockRestore();
    await win.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
