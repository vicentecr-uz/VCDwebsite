import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const source = readFileSync(new URL('../../src/components/DevImageDescriptions.astro', import.meta.url), 'utf8');
const transpile = (value: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(value);

function installGlobals(window: Window, fetch: typeof globalThis.fetch) {
  const Option = function (label: string, value: string) {
    const option = window.document.createElement('option');
    option.textContent = label;
    option.value = value;
    return option;
  };
  const values = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLImageElement: window.HTMLImageElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    Option,
    fetch,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }));
  return () => previous.forEach((descriptor, key) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
}

test('cloned image mode controls keep island triggers and save native auto intent', async () => {
  const window = new Window({ url: 'http://localhost:4322/' });
  const rows = [
    { key: 'home:sections.0', document: 'home', title: 'Home', path: ['sections', 0], pathLabel: 'Hero', src: 'hero.png', alt: '', intent: 'manual', description: '', status: 'Manual', baseToken: 'one' },
    { key: 'home:sections.1', document: 'home', title: 'Home', path: ['sections', 1], pathLabel: 'Second', src: 'second.png', alt: '', intent: 'auto', description: '', status: 'Waiting for publication', baseToken: 'two' },
  ];
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    if (body) posts.push({ url, body });
    if (url.endsWith('/api/image-description-save')) {
      const saved = { ...rows[0], intent: body?.intent, description: body?.alt, status: 'Ready' };
      return response({ ok: true, row: saved });
    }
    return response({ rows, checking: false });
  };
  const restore = installGlobals(window, fetchImpl as typeof globalThis.fetch);
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;
  window.setInterval = (() => 1) as typeof window.setInterval;
  window.clearInterval = (() => {}) as typeof window.clearInterval;
  window.document.body.innerHTML = `<main id="main-content">
    <section data-dev-overlay>
      <div data-dev-image-descriptions>
        <select data-image-descriptions-page><option value="">All pages</option></select>
        <p data-image-descriptions-status></p>
        <div data-image-descriptions-rows></div>
        <button data-image-descriptions-check>Check</button>
      </div>
    </section>
  </main>
  <template data-image-descriptions-row-template>
    <article data-image-description-row>
      <img data-image-description-image>
      <strong data-image-description-title></strong><span data-image-description-path></span>
      <textarea data-image-description-text></textarea>
      <label for="image-description-mode">Mode</label>
      <select data-image-description-intent>
        <option value="manual">Manual</option><option value="auto">Automatic</option>
      </select>
      <astro-island props='{"triggerId":[0,"image-description-mode"]}'><button id="image-description-mode"></button></astro-island>
      <span data-image-description-status></span>
      <button data-image-description-save>Save</button>
      <button data-image-description-retry>Retry</button>
      <button data-image-description-refresh>Refresh</button>
      <button data-image-description-revert>Revert</button>
    </article>
  </template>`;
  const script = source.slice(source.indexOf('<script>') + '<script>'.length, source.indexOf('</script>'))
    .replace(/^\s*import .*;$/gm, '')
    .replace(/\s*import\.meta\.hot\?\.dispose\(dispose\);\s*$/, '\nreturn dispose;');
  let dispose: (() => void) | undefined;
  try {
    dispose = new Function('onPageLoad', 'createPageScope', transpile(script))(onPageLoad, createPageScope);
    await Promise.resolve();
    await Promise.resolve();
    const articles = [...window.document.querySelectorAll<HTMLElement>('[data-image-description-row]')];
    assert.equal(articles.length, 2);
    for (const article of articles) {
      const select = article.querySelector<HTMLSelectElement>('[data-image-description-intent]')!;
      const label = article.querySelector('label')!;
      const button = article.querySelector<HTMLButtonElement>('astro-island button')!;
      const props = JSON.parse(article.querySelector('astro-island')!.getAttribute('props')!);
      assert.equal(label.getAttribute('for'), button.id);
      assert.deepEqual(props.triggerId, [0, button.id]);
      assert.notEqual(button.id, 'image-description-mode');
    }
    assert.equal(new Set(articles.map((article) => article.querySelector('astro-island button')!.id)).size, 2);
    const first = articles[0];
    const select = first.querySelector<HTMLSelectElement>('[data-image-description-intent]')!;
    select.value = 'auto';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    first.querySelector<HTMLButtonElement>('[data-image-description-save]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    const save = posts.find((post) => post.url.endsWith('/api/image-description-save'));
    assert.deepEqual(save?.body, { key: rows[0].key, baseToken: rows[0].baseToken, alt: '', intent: 'auto' });
  } finally {
    dispose?.();
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    restore();
    await window.happyDOM.close();
  }
});
