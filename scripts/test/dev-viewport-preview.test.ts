import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { followEditViewport } from '../../src/lib/editViewportFollow';

const source = readFileSync(new URL('../../src/components/DevViewportPreview.astro', import.meta.url), 'utf8');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.split('<script>')[1].split('</script>')[0]
  .replace(/^\s*import .*;$/gm, '').replace('import.meta.hot?.dispose(dispose);', 'return dispose;'));

function fixture(canvasMode = false) {
  const window = new Window({ url: 'http://localhost:4358/' });
  const document = window.document;
  document.documentElement.classList.add('is-dev-mode');
  document.body.innerHTML = '<main></main><div data-viewport-width-panel></div>';
  const posts: Record<string, unknown>[] = [];
  window.postMessage = (data: Record<string, unknown>) => { posts.push(data); };
  const parent = { postMessage: (data: Record<string, unknown>) => posts.push(data) };
  if (canvasMode) {
    Object.defineProperty(window, 'parent', { value: parent });
    window.name = 'vcd-canvas';
  }
  let reloads = 0;
  Object.defineProperty(window.location, 'reload', { value: () => reloads++ });
  const cleanups: Array<() => void> = [];
  const scope = {
    listen(target: EventTarget, event: string, listener: EventListener, options?: boolean) {
      target.addEventListener(event, listener, options);
      cleanups.push(() => target.removeEventListener(event, listener, options));
    },
    frame(callback: () => void) { callback(); },
    add(callback: () => void) { cleanups.push(callback); },
    destroy() { cleanups.reverse().forEach(fn => fn()); },
  };
  const follow = new Function('window', 'document', `return (${followEditViewport.toString()});`)(window, document);
  const dispose = new Function('window', 'document', 'HTMLElement', 'Element', 'location', 'CustomEvent', 'Event', 'createPageScope', 'onPageLoad', 'followEditViewport', 'hoistCanvasChrome', script)(
    window, document, window.HTMLElement, window.Element, window.location, window.CustomEvent, window.Event,
    () => scope, (mount: () => () => void) => mount(), follow, () => {},
  );
  const request = (preset: string) => window.dispatchEvent(new window.CustomEvent('vcd:edit-viewport-request', { detail: { preset } }));
  const message = (type: string, extra = {}) => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: window, data: { type, ...extra } }));
  const parentMessage = (type: string, extra = {}) => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: parent, data: { type, ...extra } }));
  return { window, document, posts, request, message, parentMessage, reloads: () => reloads,
    dispose: async () => { dispose(); await window.happyDOM.abort(); } };
}

test('plain page removes the width panel and leaves device shortcuts and messaging inactive', async () => {
  const f = fixture();
  try {
    expect(f.document.querySelector('[data-viewport-width-panel]')).toBeNull();
    const key = new f.window.KeyboardEvent('keydown', { code: 'Digit3', altKey: true, cancelable: true, bubbles: true });
    f.document.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    f.request('mobile');
    expect(f.posts).toEqual([]);
  } finally { await f.dispose(); }
});

test('canvas reports location and Edit state with no warm preview or save reload', async () => {
  const f = fixture(true);
  try {
    expect(f.posts).toEqual([
      { type: 'vcd-canvas-location', href: f.window.location.href, title: f.document.title },
      { type: 'vcd-canvas-dev-mode', active: true },
    ]);
    for (const name of ['popstate', 'hashchange']) f.window.dispatchEvent(new f.window.Event(name));
    f.document.dispatchEvent(new f.window.Event('astro:page-load'));
    expect(f.posts.filter((post) => post.type === 'vcd-canvas-location')).toHaveLength(4);
    f.document.documentElement.classList.remove('is-dev-mode');
    f.window.dispatchEvent(new f.window.Event('vcd:dev-mode-change'));
    expect(f.posts.at(-1)).toEqual({ type: 'vcd-canvas-dev-mode', active: false });
    f.window.dispatchEvent(new f.window.Event('vcd:dev-content-written'));
    expect(f.reloads()).toBe(0);
  } finally { await f.dispose(); }
});

test('canvas routes presets, leaves Escape to Edit, and removes frame state on cleanup', async () => {
  const f = fixture(true);
  try {
    const key = new f.window.KeyboardEvent('keydown', { code: 'Digit3', altKey: true, cancelable: true, bubbles: true });
    f.document.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(f.posts.at(-1)).toEqual({ type: 'vcd-canvas-request-preset', preset: 'mobile' });
    f.request('tablet');
    expect(f.posts.at(-1)).toEqual({ type: 'vcd-canvas-request-preset', preset: 'tablet' });
    f.message('vcd-canvas-preset', { preset: 'mobile' });
    expect(f.document.documentElement.hasAttribute('data-edit-viewport-frame')).toBe(false);
    const changes: string[] = [];
    f.window.addEventListener('vcd:edit-viewport-change', ((event: CustomEvent) => changes.push(event.detail.preset)) as EventListener);
    f.parentMessage('vcd-canvas-preset', { preset: 'tablet' });
    expect(changes).toEqual(['tablet']);
    expect(f.document.documentElement.hasAttribute('data-edit-viewport-frame')).toBe(true);
    const count = f.posts.length;
    f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(f.posts.length).toBe(count);
    f.window.dispatchEvent(new f.window.CustomEvent('vcd:edit-viewport-request', { detail: { preset: 'desktop' } }));
    expect(f.posts.at(-1)).toEqual({ type: 'vcd-canvas-request-preset', preset: 'desktop' });
    f.parentMessage('vcd-canvas-preset', { preset: 'desktop' });
    expect(f.document.documentElement.hasAttribute('data-edit-viewport-frame')).toBe(false);
    f.parentMessage('vcd-canvas-preset', { preset: 'mobile' });
  } finally { await f.dispose(); }
  expect(f.document.documentElement.hasAttribute('data-edit-viewport-frame')).toBe(false);
});

test('canvas flux suppresses page resize reactions and releases them once without posting', async () => {
  const f = fixture(true);
  try {
    const posts = [...f.posts];
    const events: string[] = [];
    f.window.addEventListener('resize', () => events.push('resize'));
    f.window.addEventListener('vcd:viewport-flux-end', () => events.push('end'));
    f.message('vcd-canvas-flux', { active: true });
    expect(f.document.documentElement.hasAttribute('data-viewport-flux')).toBe(false);
    f.parentMessage('vcd-canvas-flux', { active: true });
    expect(f.document.documentElement.hasAttribute('data-viewport-flux')).toBe(true);
    f.window.dispatchEvent(new f.window.Event('resize'));
    f.parentMessage('vcd-canvas-flux', { active: true });
    f.window.dispatchEvent(new f.window.Event('resize'));
    expect(events).toEqual([]);
    f.parentMessage('vcd-canvas-flux', { active: false });
    expect(f.document.documentElement.hasAttribute('data-viewport-flux')).toBe(false);
    expect(events).toEqual(['end', 'resize']);
    expect(f.posts).toEqual(posts);
    f.parentMessage('vcd-canvas-flux', { active: true });
  } finally { await f.dispose(); }
  expect(f.document.documentElement.hasAttribute('data-viewport-flux')).toBe(false);
});

