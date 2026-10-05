import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { swapPageContent, supportsPersistentPage } from '../../src/lib/persistentPageSwap';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';

const windows: Window[] = [];
const globals = ['window', 'document', 'Element', 'Node', 'HTMLElement', 'HTMLDetailsElement', 'HTMLInputElement', 'HTMLFormElement', 'Event', 'CustomEvent', 'AbortController', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getComputedStyle'];
let originals: Map<string, PropertyDescriptor | undefined>;
function fixture() {
  originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = new Window({ url: 'https://vcd.test/about' }); windows.push(win);
  for (const key of ['window', 'document', 'Element', 'Node', 'HTMLElement', 'HTMLDetailsElement', 'HTMLInputElement', 'HTMLFormElement', 'Event', 'CustomEvent', 'AbortController', 'MutationObserver', 'ResizeObserver']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? win : (win as any)[key] });
  }
  Object.assign(globalThis, { requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win), matchMedia: win.matchMedia.bind(win), getComputedStyle: win.getComputedStyle.bind(win) });
  return win;
}
afterEach(async () => {
  await Promise.all(windows.splice(0).map((win) => win.happyDOM.close()));
  for (const [key, descriptor] of originals ?? []) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const html = (name: string) => `<body><div id="transition-overlay"></div><dialog data-image-lightbox>${name}</dialog><div id="site-wrapper" style="--page-header-width: ${name === 'Home' ? 40 : 50}em"><div data-page-shell class="${name}" ${name === 'Home' ? 'data-home-page' : ''}><div class="header-menu-backdrop"></div><div class="site-header-slot"><header><span class="live-letter" style="animation: title-in 1s both">${name}</span></header></div><main id="main-content">${name}</main><footer>${name}</footer></div><section data-home-intro>${name}</section></div><script data-page-script>${name}</script></body>`;

test('swaps page and body siblings while header, letters and every ancestor remain continuously attached', () => {
  const win = fixture(); const doc = win.document;
  doc.write(html('About'));
  const incoming = new win.DOMParser().parseFromString(html('Home'), 'text/html');
  const stable = [doc.body, doc.getElementById('site-wrapper'), doc.querySelector('[data-page-shell]'), doc.querySelector('.site-header-slot'), doc.querySelector('header'), doc.querySelector('.live-letter'), doc.querySelector('.header-menu-backdrop'), doc.getElementById('transition-overlay')];
  const oldMain = doc.getElementById('main-content');
  const observer = new win.MutationObserver(() => {});
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  swapPageContent(doc as any, incoming as any);
  const removed = observer.takeRecords().flatMap((record) => [...record.removedNodes]);
  expect(stable.every((node) => node?.isConnected)).toBe(true);
  expect(removed.some((node) => stable.includes(node as any))).toBe(false);
  expect(doc.querySelector('.live-letter')).toBe(stable[5]);
  expect((stable[5] as any).style.animation).toBe('title-in 1s both');
  expect(oldMain?.isConnected).toBe(false);
  expect(doc.getElementById('main-content')?.textContent).toBe('Home');
  expect(doc.querySelector('dialog')?.textContent).toBe('Home');
  expect(doc.querySelector('[data-page-shell]')?.hasAttribute('data-home-page')).toBe(true);
  expect(doc.getElementById('site-wrapper')?.getAttribute('style')).toContain('40em');
  expect(doc.querySelectorAll('header').length).toBe(1);
  observer.disconnect();
});

test('page mounts once per main and releases global listeners, observers, timers and frames before removal', async () => {
  const win = fixture(); const doc = win.document;
  doc.body.innerHTML = '<main id="main-content"></main>';
  let mounts = 0, calls = 0, disconnected = 0;
  const dispose = onPageLoad(() => {
    mounts++;
    const scope = createPageScope();
    scope.listen(win as any, 'resize', () => calls++);
    const observer = new win.MutationObserver(() => calls++);
    observer.observe(doc.getElementById('main-content')!, { childList: true });
    scope.add(() => { observer.disconnect(); disconnected++; });
    scope.frame(() => calls++); scope.timeout(() => calls++, 10);
    return scope.destroy;
  });
  doc.dispatchEvent(new win.Event('astro:page-load'));
  expect(mounts).toBe(1);
  doc.dispatchEvent(new win.Event('astro:before-swap'));
  win.dispatchEvent(new win.Event('resize'));
  doc.getElementById('main-content')!.append('old');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toBe(0); expect(disconnected).toBe(1);
  doc.body.innerHTML = '<main id="main-content">next</main>';
  doc.dispatchEvent(new win.Event('astro:page-load'));
  doc.dispatchEvent(new win.Event('astro:page-load'));
  expect(mounts).toBe(2);
  dispose(); expect(disconnected).toBe(2);
});

function componentScript(path: string) {
  const source = readFileSync(new URL(`../../src/components/${path}.astro`, import.meta.url), 'utf8');
  const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, '').replaceAll('import.meta.hot', 'undefined').replaceAll('import.meta.env.DEV', 'false'));
}

test('sidebar teardown removes window listeners and remounts the new sidebar once', () => {
  const win = fixture(); const doc = win.document;
  const markup = '<main id="main-content"><section id="first" class="section-block"></section></main><nav class="section-sidebar-nav"><div data-section-sidebar-scroll><ul data-section-sidebar-list><li><a href="#first" class="section-sidebar-nav__link">First</a></li></ul></div></nav>';
  doc.body.innerHTML = markup;
  let reads = 0;
  const oldNav = doc.querySelector('.section-sidebar-nav')!;
  const original = oldNav.querySelectorAll.bind(oldNav);
  oldNav.querySelectorAll = ((selector: string) => { reads++; return original(selector); }) as any;
  new Function('createPageScope', 'onPageLoad', componentScript('SectionSidebarNav'))(createPageScope, onPageLoad);
  expect(oldNav.getAttribute('data-initialized')).toBe('true');
  doc.dispatchEvent(new win.Event('astro:before-swap'));
  const afterDispose = reads;
  doc.body.innerHTML = markup;
  win.dispatchEvent(new win.Event('scroll')); win.dispatchEvent(new win.Event('resize'));
  expect(reads).toBe(afterDispose);
  doc.dispatchEvent(new win.Event('astro:page-load'));
  expect(doc.querySelector('.section-sidebar-nav')?.getAttribute('data-initialized')).toBe('true');
});

test('signup aborts an in-flight request on removal, detaches old form handler, and initializes the destination form', async () => {
  const win = fixture(); const doc = win.document;
  const markup = '<main id="main-content"><form data-project-signup-form><input data-signup-email type="email" value="test@example.com"><button type="submit"></button></form></main>';
  doc.body.innerHTML = markup;
  let requestSignal: AbortSignal | undefined; let requests = 0;
  const source = componentScript('project/ProjectSignup').replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, '');
  const fetch = (_url: string, options: RequestInit) => { requests++; requestSignal = options.signal!; return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('aborted')))); };
  new Function('createPageScope', 'onPageLoad', 'tlds', 'waitForSignupViewportSettlement', 'fetch', source)(createPageScope, onPageLoad, ['com'], () => Promise.resolve(), fetch);
  const oldForm = doc.querySelector('form')!;
  oldForm.dispatchEvent(new win.Event('submit', { cancelable: true }));
  expect(requests).toBe(1);
  doc.dispatchEvent(new win.Event('astro:before-swap'));
  expect(requestSignal?.aborted).toBe(true);
  oldForm.dispatchEvent(new win.Event('submit', { cancelable: true }));
  expect(requests).toBe(1);
  doc.body.innerHTML = markup;
  doc.dispatchEvent(new win.Event('astro:page-load'));
  expect(doc.querySelector('form')?.getAttribute('data-bound')).toBe('true');
  await Promise.resolve();
});

test('body additions from connected custom elements survive the swap and disconnect with their page', () => {
  const win = fixture(); const doc = win.document;
  class Demo extends win.HTMLElement {
    tooltip?: HTMLElement;
    connectedCallback() { this.tooltip = doc.createElement('aside') as any; this.tooltip!.id = 'live-tooltip'; doc.body.append(this.tooltip as any); }
    disconnectedCallback() { this.tooltip?.remove(); }
  }
  win.customElements.define('lifecycle-demo', Demo);
  doc.write(html('About'));
  const next = new win.DOMParser().parseFromString(html('Home').replace('<main id="main-content">', '<main id="main-content"><lifecycle-demo></lifecycle-demo>'), 'text/html');
  swapPageContent(doc as any, next as any);
  expect(doc.querySelectorAll('#live-tooltip').length).toBe(1);
  swapPageContent(doc as any, new win.DOMParser().parseFromString(html('About'), 'text/html') as any);
  expect(doc.querySelector('#live-tooltip')).toBeNull();
});

test('lightbox document handlers dispose before page replacement and rebind exactly once', () => {
  const win = fixture(); const doc = win.document;
  const markup = '<main id="main-content"></main><dialog data-image-lightbox><div data-image-lightbox-viewer><img data-image-lightbox-image><p data-image-lightbox-error></p><select data-image-lightbox-input-mode></select></div></dialog>';
  doc.body.innerHTML = markup;
  const clicks = new Set<EventListenerOrEventListenerObject>();
  const add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
  doc.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: any) => { if (type === 'click') clicks.add(listener); add(type, listener as any, options); }) as any;
  doc.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: any) => { if (type === 'click') clicks.delete(listener); remove(type, listener as any, options); }) as any;
  new Function('onPageLoad', 'IMAGE_LIGHTBOX_MAX_SCALE', componentScript('ImageLightbox'))(onPageLoad, 8);
  expect(clicks.size).toBe(1);
  doc.dispatchEvent(new win.Event('astro:page-load')); expect(clicks.size).toBe(1);
  doc.dispatchEvent(new win.Event('astro:before-swap')); expect(clicks.size).toBe(0);
  doc.body.innerHTML = markup;
  doc.dispatchEvent(new win.Event('astro:page-load')); expect(clicks.size).toBe(1);
  doc.dispatchEvent(new win.Event('astro:before-swap')); expect(clicks.size).toBe(0);
});


test('a fast fetch waiting on the cover is released when a newer navigation kills that cover', async () => {
  const source = readFileSync(new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
  const cover = source.slice(source.indexOf('        cover: () => {'), source.indexOf('        reveal: () => {'));
  let current: { kill: () => void; finish: () => void };
  const gsap = { fromTo(_target: unknown, _from: unknown, options: { onComplete: () => void; onInterrupt: () => void }) {
    current = { kill: options.onInterrupt, finish: options.onComplete }; return current;
  } };
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(`let activeTween; const invalidate = () => activeTween?.kill(); return { ${cover} };`);
  const hooks = new Function('gsap', 'overlay', 'visibleTransition', 'REVEAL_EASE', 'getComputedStyle', script)(gsap, { dataset: {}, removeAttribute(name: string) { delete this.dataset[name]; }, style: {}, hidden: false }, false, 'power1.out', () => ({ opacity: '0' }));
  let firstSettled = false;
  const first = hooks.cover().then(() => { firstSettled = true; });
  await Promise.resolve(); expect(firstSettled).toBe(false);
  const second = hooks.cover();
  await first; expect(firstSettled).toBe(true);
  current!.finish(); await second;
});


test('dev editor islands navigate persistently while unsupported islands remain document surfaces', () => {
  const win = fixture();
  const doc = new win.DOMParser().parseFromString(html('About'), 'text/html');
  const island = doc.createElement('astro-island');
  island.setAttribute('component-url', '/src/components/base-ui/EditorSelect.tsx');
  doc.body.append(island);
  expect(supportsPersistentPage(doc as any)).toBe(false);
  doc.body.setAttribute('data-dev-authoring', '');
  expect(supportsPersistentPage(doc as any)).toBe(true);
  island.setAttribute('component-url', '/src/components/Unknown.tsx');
  expect(supportsPersistentPage(doc as any)).toBe(false);
});

test('dev readiness marker stays attached to the retained transition controller across pages', () => {
  const win = fixture(); const doc = win.document;
  doc.write(html('About'));
  const marker = doc.createElement('output'); marker.id = 'transition-readiness-marker'; doc.body.prepend(marker);
  const incoming = new win.DOMParser().parseFromString(html('Home'), 'text/html');
  const nextMarker = incoming.createElement('output'); nextMarker.id = marker.id; incoming.body.prepend(nextMarker);
  swapPageContent(doc as any, incoming as any);
  expect(doc.getElementById(marker.id)).toBe(marker);
  expect(marker.isConnected).toBe(true);
});


test('unseen Home navigation covers the retained header with the outgoing veil before swapping', () => {
  const win = fixture(); const doc = win.document;
  doc.head.innerHTML = '<meta name="astro-view-transitions-enabled" content="true">';
  doc.body.innerHTML = '<span class="header-trigger__wordmark" aria-hidden="false">Project</span>';
  const source = readFileSync(new URL('../../src/scripts/persistentNavigation.ts', import.meta.url), 'utf8');
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.replace(/^import .*;$/gm, '').replace('export function', 'function'));
  let stored: string | null = null;
  let storageThrows = false;
  const covered: boolean[] = [];
  // The actual title controller also raises the retained header when navigation starts.
  doc.addEventListener('header:navigation-start', () => { doc.documentElement.dataset.headerNavigation = ''; });
  new Function('document', 'sessionStorage', 'CustomEvent', 'hooks', `${script}; installPersistentNavigation(hooks);`)(
    doc, { getItem: () => { if (storageThrows) throw new Error('Unavailable'); return stored; } }, win.CustomEvent,
    { cover: () => { covered.push(doc.documentElement.hasAttribute('data-header-navigation')); return Promise.resolve(); } },
  );
  const prepare = (path: string) => {
    const event = new win.Event('astro:before-preparation', { cancelable: true });
    Object.assign(event, { to: new URL(path, 'https://vcd.test'), signal: new AbortController().signal, loader: async () => {}, sourceElement: { dataset: { headerNavigationTitle: 'Home' } } });
    doc.dispatchEvent(event);
  };
  prepare('/'); expect(covered.at(-1)).toBe(false);
  stored = 'true'; prepare('/'); expect(covered.at(-1)).toBe(true);
  stored = null; prepare('/about'); expect(covered.at(-1)).toBe(true);
  storageThrows = true; prepare('/'); expect(covered.at(-1)).toBe(false);
});
