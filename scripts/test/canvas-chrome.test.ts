import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { hoistCanvasChrome } from '../../src/lib/canvasChrome';
import { clampToViewport } from '../../src/lib/floatingLayer';

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
  document.body.innerHTML = '<main><div class="dev-text-action-stack"><button>Save</button></div><p>Page</p></main><div class="site-draw-launcher"><button>Draw</button></div><section data-dev-overlay id="image-panel" hidden><button>Image</button><input></section><div class="dev-shortcuts-help" style="position: fixed" hidden>Shortcuts</div>';
  shell.document.documentElement.setAttribute('data-canvas-shell', '');
  shell.document.documentElement.setAttribute('data-theme', 'light');
  shell.document.documentElement.className = 'shell';
  shell.document.head.innerHTML = '<style id="original">body { margin: 0 }</style>';
  shell.document.body.innerHTML = '<div data-canvas-chrome></div>';
  // Browsers route dispatch from the dispatch target internally. Happy DOM instead
  // calls the public composedPath(), which this bridge deliberately overrides.
  const dispatch = document.body.dispatchEvent.bind(document.body);
  document.body.dispatchEvent = (event) => {
    if (event.eventPhase === 0 && Object.hasOwn(event, 'composedPath')) {
      const originalPath = event.composedPath.bind(event);
      let routing = true;
      Object.defineProperty(event, 'composedPath', { configurable: true, value: () => {
        if (!routing) return originalPath();
        routing = false;
        return [document.body, document.documentElement, document, frame];
      } });
    }
    return dispatch(event);
  };
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
    expect(frameClicks).toBe(2);
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


test('hoists hidden panels, fixed shortcuts and later panels, restoring original positions', async () => {
  const f = fixture();
  try {
    const panel = f.document.getElementById('image-panel')!;
    expect(panel.ownerDocument).toBe(f.shell.document);
    expect(panel.hidden).toBe(true);
    expect(f.document.querySelector('.dev-shortcuts-help')!.ownerDocument).toBe(f.shell.document);
    const late = f.document.createElement('section');
    late.setAttribute('data-dev-overlay', '');
    f.document.body.append(late);
    await flush();
    expect(late.ownerDocument).toBe(f.shell.document);
    f.cleanup();
    expect(panel.ownerDocument).toBe(f.document);
    expect(late.parentNode).toBe(f.document.body);
    late.remove();
    expect(f.document.body.innerHTML).toBe(f.original);
  } finally { await f.dispose(); }
});

test('bridges delegated clicks once, preserves target/path/init and cancellation without replaying element listeners', async () => {
  const f = fixture();
  try {
    const panel = f.document.getElementById('image-panel')!;
    const button = panel.querySelector('button')!;
    let elementClicks = 0;
    let delegatedClicks = 0;
    button.addEventListener('click', () => elementClicks++);
    let received: any;
    f.document.addEventListener('click', (event) => {
      delegatedClicks++;
      received = { event, target: event.target, srcElement: event.srcElement, path: event.composedPath(),
        clientX: event.clientX, ctrlKey: event.ctrlKey };
      event.preventDefault();
    });
    const event = new f.shell.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 123, ctrlKey: true });
    button.dispatchEvent(event);
    expect(elementClicks).toBe(1);
    expect(delegatedClicks).toBe(1);
    expect(received.event).toBeInstanceOf(f.frame.MouseEvent);
    expect(received.target).toBe(button);
    expect(received.srcElement).toBe(button);
    expect(received.path.includes(panel)).toBe(true);
    expect(received.path.includes(f.shell.document)).toBe(true);
    expect(received.clientX).toBe(123);
    expect(received.ctrlKey).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  } finally { await f.dispose(); }
});

test('bridges shell drag moves until the matching pointer ends, including release outside chrome', async () => {
  const f = fixture();
  try {
    const button = f.document.getElementById('image-panel')!.querySelector('button')!;
    const moves: number[] = [];
    f.frame.addEventListener('pointermove', (event) => {
      expect(event).toBeInstanceOf(f.frame.PointerEvent);
      moves.push(event.clientX);
    });
    let releases = 0;
    f.frame.addEventListener('pointerup', () => releases++);
    const pointer = (type: string, pointerId = 7, clientX = 42) => new f.shell.PointerEvent(type, { bubbles: true, pointerId, clientX });
    button.dispatchEvent(pointer('pointerdown'));
    f.shell.document.dispatchEvent(pointer('pointermove'));
    f.shell.document.dispatchEvent(pointer('pointerup', 8));
    f.shell.document.dispatchEvent(pointer('pointermove', 7, 43));
    f.shell.document.dispatchEvent(pointer('pointerup'));
    f.shell.document.dispatchEvent(pointer('pointermove'));
    expect(moves).toEqual([42, 43]);
    expect(releases).toBe(1);
    button.dispatchEvent(pointer('pointerdown'));
    f.shell.document.dispatchEvent(pointer('pointercancel'));
    f.shell.document.dispatchEvent(pointer('pointermove'));
    expect(moves).toEqual([42, 43]);
  } finally { await f.dispose(); }
});

test('document lookup wrappers combine frame then shell matches and restore exact own descriptors', async () => {
  const f = fixture();
  try {
    const panel = f.document.getElementById('image-panel')!;
    expect(f.document.querySelector('[data-dev-overlay]')).toBe(panel);
    const buttons = f.document.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect(buttons.item(2)).toBe(panel.querySelector('button'));
    expect(buttons.item(99)).toBeNull();
    expect([...buttons]).toHaveLength(3);
    buttons.forEach((node, index, list) => { expect(list).toBe(buttons); expect(node).toBe(buttons[index]); });
    const shellOnly = f.shell.document.createElement('div');
    shellOnly.id = 'shell-only';
    shellOnly.setAttribute('data-dev-overlay', '');
    f.shell.document.querySelector('[data-canvas-chrome]')!.append(shellOnly);
    expect(f.document.getElementById('shell-only')).toBe(shellOnly);
    f.cleanup();
    expect(f.document.getElementById('shell-only')).toBeNull();
    expect([...f.document.querySelectorAll('[data-dev-overlay]')]).toEqual([panel]);
    for (const name of ['querySelector', 'querySelectorAll', 'getElementById']) expect(Object.hasOwn(f.document, name)).toBe(false);
  } finally { await f.dispose(); }
});

test('clampToViewport measures a hoisted node against the shell viewport', async () => {
  const f = fixture();
  try {
    Object.defineProperties(f.frame, { innerWidth: { value: 390 }, innerHeight: { value: 844 } });
    Object.defineProperties(f.shell, { innerWidth: { value: 1200 }, innerHeight: { value: 900 } });
    const panel = f.document.getElementById('image-panel')!;
    Object.defineProperties(panel, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 } });
    clampToViewport(panel as any, 1100, 850);
    expect(panel.style.left).toBe('992px');
    expect(panel.style.top).toBe('792px');
  } finally { await f.dispose(); }
});

test('bridges focused fields without moving focus back into the frame', async () => {
  const f = fixture();
  try {
    const panel = f.document.getElementById('image-panel')!;
    panel.hidden = false;
    const input = panel.querySelector('input')!;
    let keys = 0;
    f.document.addEventListener('keydown', (event) => { keys++; expect(event.target).toBe(input); });
    input.focus();
    input.dispatchEvent(new f.shell.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(keys).toBe(1);
    expect(f.shell.document.activeElement).toBe(input);
  } finally { await f.dispose(); }
});

test('hoists body popovers opened from chrome and restores them on close', async () => {
  const f = fixture();
  try {
    f.document.getElementById('image-panel')!.querySelector('button')!.dispatchEvent(new f.shell.PointerEvent('pointerdown', { bubbles: true }));
    const popup = f.document.createElement('div');
    popup.setAttribute('popover', 'manual');
    let open = true;
    const matches = popup.matches.bind(popup);
    popup.matches = (selector) => selector.includes(':popover-open') ? open : matches(selector);
    popup.showPopover = () => { open = true; };
    f.document.body.append(popup);
    await flush();
    expect(popup.ownerDocument).toBe(f.shell.document);
    open = false;
    const closed = new f.shell.Event('toggle');
    Object.defineProperty(closed, 'newState', { value: 'closed' });
    popup.dispatchEvent(closed);
    expect(popup.parentNode).toBe(f.document.body);
    await flush();
    expect(popup.parentNode).toBe(f.document.body);
  } finally { await f.dispose(); }
});


test('the shell generic key forwarder skips hoisted buttons, so Escape reaches the frame exactly once', async () => {
  const f = fixture();
  try {
    const source = readFileSync(new URL('../../src/pages/dev/canvas-shell.astro', import.meta.url), 'utf8');
    const start = source.indexOf('  const forwardKey =');
    const end = source.indexOf("  scope.listen(document, 'keydown', forwardKey);", start);
    const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end));
    let transitions = 0;
    const forwardKey = new Function('HTMLElement', 'Element', 'frame', 'transition', 'preset', `${script}; return forwardKey;`)(
      f.shell.HTMLElement, f.shell.Element, { contentDocument: f.document, contentWindow: f.frame }, () => transitions++, 'mobile',
    );
    f.shell.document.addEventListener('keydown', forwardKey);
    f.shell.document.addEventListener('keyup', forwardKey);
    const types: string[] = [];
    f.document.addEventListener('keydown', () => types.push('keydown'));
    f.document.addEventListener('keyup', () => types.push('keyup'));
    const button = f.document.getElementById('image-panel')!.querySelector('button')!;
    for (const type of ['keydown', 'keyup']) button.dispatchEvent(new f.shell.KeyboardEvent(type, { key: 'Escape', bubbles: true }));
    expect(types).toEqual(['keydown', 'keyup']);
    expect(transitions).toBe(0);
  } finally { await f.dispose(); }
});
