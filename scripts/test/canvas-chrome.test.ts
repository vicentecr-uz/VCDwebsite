import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { hoistCanvasChrome } from '../../src/lib/canvasChrome';

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
function fixture(cookies = 'both', editing = true) {
  const frame = new Window({ url: 'http://localhost:4360/' });
  const shell = new Window({ url: 'http://localhost:4360/' });
  frame.name = 'vcd-canvas';
  Object.defineProperty(frame, 'parent', { value: shell });
  const document = frame.document;
  if (cookies !== 'none') document.cookie = 'vcd-canvas=1';
  if (cookies === 'both' || cookies === 'chrome-only') document.cookie = 'vcd-canvas-chrome=1';
  if (cookies === 'chrome-only') document.cookie = 'vcd-canvas=; Max-Age=0';
  document.documentElement.className = editing ? 'is-dev-mode' : '';
  document.documentElement.setAttribute('data-theme', 'dark');
  document.head.innerHTML = '<style>.save { color: red }</style><link rel="stylesheet" href="/chrome.css">';
  document.body.innerHTML = '<main><div class="dev-text-action-stack"><button>Save</button></div><p>Page</p></main><div class="site-draw-launcher"><button>Draw</button></div>';
  shell.document.documentElement.setAttribute('data-canvas-shell', '');
  shell.document.documentElement.setAttribute('data-theme', 'light');
  shell.document.documentElement.className = 'shell';
  shell.document.head.innerHTML = '<style id="original">body { margin: 0 }</style>';
  shell.document.body.innerHTML = '<div data-canvas-chrome></div>';
  const original = document.body.innerHTML;
  const roots = [...document.querySelectorAll('.dev-text-action-stack, .site-draw-launcher')];
  const cleanups: Array<() => void> = [];
  const scope = {
    add(fn: () => void) { cleanups.push(fn); },
    listen(target: EventTarget, type: string, fn: EventListener) {
      target.addEventListener(type, fn);
      cleanups.push(() => target.removeEventListener(type, fn));
    },
  };
  new Function('window', 'document', 'MutationObserver', `return (${hoistCanvasChrome.toString()});`)(frame, document, frame.MutationObserver)(scope);
  const cleanup = () => cleanups.splice(0).reverse().forEach((fn) => fn());
  return { frame, shell, document, roots, original, cleanup,
    async dispose() { cleanup(); await frame.happyDOM.abort(); await shell.happyDOM.abort(); } };
}

test('moves both actual roots, preserves element listeners, restores exact positions and re-enters Edit', async () => {
  const f = fixture('both', false);
  try {
    let clicks = 0;
    let frameClicks = 0;
    let shellClicks = 0;
    f.document.addEventListener('click', () => frameClicks++);
    f.shell.document.addEventListener('click', () => shellClicks++);
    f.roots.forEach((root) => root.addEventListener('click', () => clicks++));
    f.document.documentElement.classList.add('is-dev-mode');
    await flush();
    for (const root of f.roots) {
      expect(root.ownerDocument).toBe(f.shell.document);
      expect(root.parentElement).toBe(f.shell.document.querySelector('[data-canvas-chrome]'));
      (root.firstElementChild as any).click();
    }
    expect(clicks).toBe(2);
    expect(frameClicks).toBe(0);
    expect(shellClicks).toBe(2);
    f.document.documentElement.classList.remove('is-dev-mode');
    await flush();
    expect(f.document.body.innerHTML).toBe(f.original);
    expect(f.shell.document.querySelectorAll('[data-canvas-mirrored]')).toHaveLength(0);
    expect(f.shell.document.documentElement.className).toBe('shell');
    f.document.documentElement.classList.add('is-dev-mode');
    await flush();
    expect(f.roots[0].ownerDocument).toBe(f.shell.document);
    f.cleanup();
    expect(f.document.body.innerHTML).toBe(f.original);
  } finally { await f.dispose(); }
});

test('mirrors style additions, removals, text HMR, link attributes and root state; cleanup preserves shell state', async () => {
  const f = fixture();
  try {
    const host = f.shell.document;
    expect(host.querySelectorAll('[data-canvas-mirrored]')).toHaveLength(2);
    expect(host.documentElement.className).toBe('is-dev-mode');
    expect(host.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(host.documentElement.hasAttribute('data-canvas-shell')).toBe(true);
    f.document.head.querySelector('style')!.firstChild!.textContent = '.save { color: blue }';
    f.document.head.querySelector('link')!.setAttribute('href', '/updated.css');
    f.document.head.append(f.document.createElement('style'));
    f.document.documentElement.setAttribute('data-drawing', 'yes');
    await flush();
    expect(host.querySelectorAll('[data-canvas-mirrored]')).toHaveLength(3);
    expect(host.querySelector('style[data-canvas-mirrored]')!.textContent).toContain('blue');
    expect(host.querySelector('link[data-canvas-mirrored]')!.getAttribute('href')).toBe('/updated.css');
    expect(host.documentElement.getAttribute('data-drawing')).toBe('yes');
    f.document.documentElement.removeAttribute('data-drawing');
    f.document.head.querySelector('style')!.remove();
    await flush();
    expect(host.querySelectorAll('[data-canvas-mirrored]')).toHaveLength(2);
    expect(host.documentElement.hasAttribute('data-drawing')).toBe(false);
    f.cleanup();
    expect(host.head.innerHTML).toBe('<style id="original">body { margin: 0 }</style>');
    expect(host.documentElement.className).toBe('shell');
    expect(host.documentElement.getAttribute('data-theme')).toBe('light');
    expect(host.documentElement.hasAttribute('data-canvas-shell')).toBe(true);
  } finally { await f.dispose(); }
});

for (const cookies of ['none', 'canvas-only', 'chrome-only']) test(`does nothing with ${cookies} cookies`, async () => {
  const f = fixture(cookies);
  try {
    expect(f.document.body.innerHTML).toBe(f.original);
    expect(f.shell.document.querySelectorAll('[data-canvas-mirrored]')).toHaveLength(0);
    expect(f.shell.document.documentElement.className).toBe('shell');
  } finally { await f.dispose(); }
});

for (const type of ['pagehide', 'astro:before-swap']) test(`${type} restores roots and stops mirroring`, async () => {
  const f = fixture();
  try {
    (type === 'pagehide' ? f.frame : f.document).dispatchEvent(new f.frame.Event(type));
    expect(f.document.body.innerHTML).toBe(f.original);
    expect(f.shell.document.querySelectorAll('[data-canvas-mirrored]')).toHaveLength(0);
    f.document.documentElement.setAttribute('data-later', 'true');
    await flush();
    expect(f.shell.document.documentElement.hasAttribute('data-later')).toBe(false);
    expect(f.roots[0].ownerDocument).toBe(f.document);
  } finally { await f.dispose(); }
});

test('hoists a launcher created after Edit starts', async () => {
  const f = fixture();
  try {
    const launcher = f.document.createElement('div');
    launcher.className = 'site-draw-launcher';
    f.document.body.append(launcher);
    await flush();
    expect(launcher.ownerDocument).toBe(f.shell.document);
    f.cleanup();
    expect(launcher.parentElement).toBe(f.document.body);
  } finally { await f.dispose(); }
});
